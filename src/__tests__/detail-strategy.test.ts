import type { ApiSite } from '@/lib/config';

jest.mock('@/lib/config', () => ({
  API_CONFIG: {
    search: {
      path: '?ac=videolist&wd=',
      pagePath: '?ac=videolist&wd={query}&pg={page}',
      headers: { Accept: 'application/json' },
    },
    detail: {
      path: '?ac=videolist&ids=',
      headers: { Accept: 'application/json' },
    },
  },
  getConfig: jest.fn(),
}));

jest.mock(
  'switch-chinese',
  () => ({
    __esModule: true,
    default: () => ({
      detect: (value: string) => value,
      simplized: (value: string) => value,
      traditionalized: (value: string) => value,
    }),
    ChineseType: { SIMPLIFIED: 'simplified' },
  }),
  { virtual: true }
);

import { getDetailFromApi } from '@/lib/downstream';

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

function htmlResponse(html: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockRejectedValue(new Error('not json')),
    text: jest.fn().mockResolvedValue(html),
  } as unknown as Response;
}

function apiDetail(playUrl = '第1集$https://media.example.com/1.m3u8') {
  return {
    code: 1,
    list: [
      {
        vod_id: '1',
        vod_name: '测试影片',
        vod_pic: '',
        vod_play_url: playUrl,
        vod_content: '测试简介',
      },
    ],
  };
}

const baseSite: ApiSite = {
  key: 'test',
  name: '测试源',
  api: 'https://api.example.com/api.php/provide/vod',
  detail: 'https://detail.example.com',
};

describe('detail_mode 详情策略', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('auto 模式优先使用有效的 JSON 详情', async () => {
    fetchMock.mockResolvedValue(jsonResponse(apiDetail()));

    const result = await getDetailFromApi(
      { ...baseSite, detail_mode: 'auto' },
      '1'
    );

    expect(result.episodes).toEqual(['https://media.example.com/1.m3u8']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('?ac=videolist&ids=1');
  });

  it('auto 模式在 JSON 无剧集时回退网页详情', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 1, list: [] }))
      .mockResolvedValueOnce(
        htmlResponse('<h1>网页影片</h1>$https://media.example.com/html.m3u8')
      );

    const result = await getDetailFromApi(
      { ...baseSite, detail_mode: 'auto' },
      '1'
    );

    expect(result.title).toBe('网页影片');
    expect(result.episodes).toEqual(['https://media.example.com/html.m3u8']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('html 模式在网页失败时回退 JSON 详情', async () => {
    fetchMock
      .mockResolvedValueOnce(htmlResponse('Not found', 404))
      .mockResolvedValueOnce(jsonResponse(apiDetail()));

    const result = await getDetailFromApi(
      { ...baseSite, detail_mode: 'html' },
      '1'
    );

    expect(result.episodes).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/index.php/vod/detail/id/1.html');
    expect(fetchMock.mock.calls[1][0]).toContain('?ac=videolist&ids=1');
  });

  it('api 模式不请求网页详情', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 1, list: [] }));

    await expect(
      getDetailFromApi({ ...baseSite, detail_mode: 'api' }, '1')
    ).rejects.toThrow(/JSON 详情失败/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('?ac=videolist&ids=1');
  });

  it('两条详情路径都失败时保留分阶段错误', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 1, list: [] }))
      .mockResolvedValueOnce(htmlResponse('<h1>无播放地址</h1>'));

    await expect(
      getDetailFromApi({ ...baseSite, detail_mode: 'auto' }, '1')
    ).rejects.toThrow(/JSON 详情失败.*HTML 详情未返回可播放剧集/);
  });
});
