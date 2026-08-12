/**
 * @jest-environment node
 */

import {
  readArrayBufferLimited,
  readTextLimited,
  validateProxyTargetUrl,
} from '@/lib/proxy-security';
import type { SearchResult } from '@/lib/types';
import {
  buildResolutionFilterFromSearchParams,
  decorateSearchResultQuality,
  filterSearchResultsByResolution,
} from '@/lib/video-quality';

jest.mock('cacheable-lookup', () => ({
  __esModule: true,
  default: class MockCacheableLookup {
    lookupAsync() {
      return Promise.resolve([]);
    }
  },
}));

describe('upstream security and quality optimizations', () => {
  it('rejects loopback proxy targets before they can be stored or fetched', async () => {
    await expect(validateProxyTargetUrl('http://127.0.0.1/internal')).rejects.toThrow(
      /blocked/i
    );
  });

  it('stops reading oversized text and binary responses', async () => {
    await expect(readTextLimited(new Response('12345'), 4)).rejects.toThrow(
      /exceeds 4 byte limit/
    );
    await expect(
      readArrayBufferLimited(new Response(new Uint8Array([1, 2, 3])), 2)
    ).rejects.toThrow(/exceeds 2 byte limit/);
  });

  it('infers and filters source quality without discarding unknown sources by default', () => {
    const base: SearchResult = {
      id: '1',
      title: '示例影片 4K',
      poster: '',
      episodes: ['https://example.com/video.m3u8'],
      episodes_titles: ['第1集'],
      source: 'test',
      source_name: '测试源',
      year: '2026',
    };
    const decorated = decorateSearchResultQuality(base);
    expect(decorated.resolution_level).toBe(2160);
    expect(decorated.resolution).toBe('4K');

    const filter = buildResolutionFilterFromSearchParams(
      new URLSearchParams('minResolution=1080')
    );
    expect(filterSearchResultsByResolution([decorated, { ...base, id: '2', title: '未知' }], filter))
      .toHaveLength(2);
  });
});
