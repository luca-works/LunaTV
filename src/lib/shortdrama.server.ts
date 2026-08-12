/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { getConfig } from './config';
import { DEFAULT_USER_AGENT } from './user-agent';
import { ShortDramaItem, ShortDramaParseResult } from './types';

// 短剧相关分类关键词（父分类 + 子分类标签）
const SHORT_DRAMA_KEYWORDS = ['短剧', '女频恋爱', '反转爽剧', '古装仙侠', '年代穿越', '脑洞悬疑', '现代都市'];
const DEFAULT_SHORT_DRAMA_API = 'https://tyyszyapi.com/api.php/provide/vod';

function appendQueryParams(api: string, params: Record<string, string | number>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    searchParams.set(key, String(value));
  });

  const separator = api.includes('?')
    ? (api.endsWith('?') || api.endsWith('&') ? '' : '&')
    : '?';

  return `${api}${separator}${searchParams.toString()}`;
}

function getUniqueApis(apis: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      apis
        .map(api => api?.trim())
        .filter((api): api is string => !!api)
    )
  );
}

function parseEpisodeCount(item: any, fallback = 1): number {
  const total = Number.parseInt(String(item?.vod_total || ''), 10);
  if (Number.isFinite(total) && total > 0) return total;

  const remarksCount = Number.parseInt(String(item?.vod_remarks || '').replace(/[^\d]/g, ''), 10);
  if (Number.isFinite(remarksCount) && remarksCount > 0) return remarksCount;

  return fallback > 0 ? fallback : 1;
}

function parsePlayEntries(playUrl: string): Array<{ label: string; url: string }> {
  const groups = String(playUrl || '')
    .split('$$$')
    .map(group => group.trim())
    .filter(Boolean);

  let bestEntries: Array<{ label: string; url: string }> = [];

  groups.forEach(group => {
    const entries = group
      .split('#')
      .map((entry, index) => {
        const trimmed = entry.trim();
        const separatorIndex = trimmed.indexOf('$');
        const label = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : `第${index + 1}集`;
        const rawUrl = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : trimmed;
        const url = rawUrl.replace(/^http:\/\//i, 'https://');

        return { label: label || `第${index + 1}集`, url };
      })
      .filter(entry => /^https?:\/\//i.test(entry.url));

    if (entries.length > bestEntries.length) {
      bestEntries = entries;
    }
  });

  return bestEntries;
}

async function getShortDramaApis(sourceKey?: string): Promise<string[]> {
  const config = await getConfig();
  if (sourceKey) {
    const selected = config.SourceConfig.find(
      source => source.key === sourceKey && source.type === 'shortdrama' && !source.disabled
    );
    if (selected) return [selected.api];
  }
  const configuredApis = config.SourceConfig
    .filter(source => source.type === 'shortdrama' && !source.disabled)
    .map(source => source.api);

  return getUniqueApis([
    ...configuredApis,
    config.ShortDramaConfig?.primaryApiUrl,
    DEFAULT_SHORT_DRAMA_API,
  ]);
}

async function parseWithPrimarySource(
  api: string,
  id: number,
  episode: number,
  useProxy: boolean
): Promise<ShortDramaParseResult> {
  const detailUrl = appendQueryParams(api, { ac: 'detail', ids: id });
  const response = await fetch(detailUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const list = Array.isArray(data?.list) ? data.list : [];
  const item = list.find((entry: any) => Number(entry?.vod_id) === id) || list[0];

  if (!item) {
    return { code: 1, msg: '未找到该短剧' };
  }

  const entries = parsePlayEntries(item.vod_play_url || '');
  if (entries.length === 0) {
    return { code: 1, msg: '该短剧暂无可用播放地址' };
  }

  const episodeIndex = Math.max(0, Math.floor(episode));
  if (episodeIndex >= entries.length) {
    return { code: 1, msg: `集数 ${episode + 1} 不存在（共${entries.length}集）` };
  }

  const current = entries[episodeIndex];
  const proxyUrl = useProxy
    ? `/api/proxy/shortdrama?url=${encodeURIComponent(current.url)}`
    : current.url;
  const totalEpisodes = Math.max(entries.length, parseEpisodeCount(item, entries.length));

  return {
    code: 0,
    data: {
      videoId: Number(item.vod_id) || id,
      videoName: item.vod_name || '',
      currentEpisode: episodeIndex + 1,
      totalEpisodes,
      parsedUrl: proxyUrl,
      proxyUrl,
      cover: item.vod_pic || '',
      description: item.vod_content || item.vod_blurb || '',
      episode: {
        index: episodeIndex + 1,
        label: current.label || `第${episodeIndex + 1}集`,
        parsedUrl: proxyUrl,
        proxyUrl,
        title: current.label || `第${episodeIndex + 1}集`,
      },
    },
    metadata: {
      author: item.vod_actor || '',
      backdrop: item.vod_pic_slide || item.vod_pic || '',
      vote_average: parseFloat(item.vod_score) || 0,
      tmdb_id: item.vod_douban_id ? Number(item.vod_douban_id) : undefined,
    },
  };
}

async function parseWithAlternativeApi(
  dramaName: string,
  episode: number,
  alternativeApiUrl: string
): Promise<ShortDramaParseResult> {
  try {
    const alternativeApiBase = alternativeApiUrl.replace(/\/+$/, '');
    if (!alternativeApiBase) {
      return { code: -1, msg: '备用API未启用' };
    }

    const searchUrl = `${alternativeApiBase}/api/v1/drama/dl?dramaName=${encodeURIComponent(dramaName)}`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!searchResponse.ok) {
      throw new Error(`Search failed: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    if (!searchData?.data || !Array.isArray(searchData.data) || searchData.data.length === 0) {
      return { code: 1, msg: `未找到短剧"${dramaName}"` };
    }

    const firstDrama = searchData.data[0];
    if (!firstDrama?.id) {
      return { code: 1, msg: '备用API返回的短剧数据不完整' };
    }

    const episodesUrl = `${alternativeApiBase}/api/v1/drama/dramas?dramaId=${firstDrama.id}`;
    const episodesResponse = await fetch(episodesUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!episodesResponse.ok) {
      throw new Error(`Episodes fetch failed: ${episodesResponse.status}`);
    }

    const episodesData = await episodesResponse.json();
    if (!episodesData?.data || !Array.isArray(episodesData.data) || episodesData.data.length === 0) {
      return { code: 1, msg: '该短剧暂无可用集数' };
    }

    const episodeIndex = Math.max(0, Math.floor(episode));
    const targetEpisode = episodesData.data[episodeIndex];
    if (!targetEpisode?.id) {
      return { code: 1, msg: `集数 ${episode + 1} 不存在（共${episodesData.data.length}集）` };
    }

    const directUrl = `${alternativeApiBase}/api/v1/drama/direct?episodeId=${targetEpisode.id}`;
    const directResponse = await fetch(directUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!directResponse.ok) {
      throw new Error(`Direct fetch failed: ${directResponse.status}`);
    }

    const directData = await directResponse.json();
    if (!directData?.url) {
      return { code: 1, msg: '该集暂时无法播放，请尝试其他集数' };
    }

    const videoUrl = String(directData.url).replace(/^http:\/\//i, 'https://');
    const proxyUrl = `/api/proxy/shortdrama?url=${encodeURIComponent(videoUrl)}`;
    const currentEpisode = episodeIndex + 1;

    return {
      code: 0,
      data: {
        videoId: firstDrama.id,
        videoName: firstDrama.name,
        currentEpisode,
        totalEpisodes: episodesData.data.length,
        parsedUrl: proxyUrl,
        proxyUrl,
        cover: directData.pic || firstDrama.pic || '',
        description: firstDrama.overview || '',
        episode: {
          index: currentEpisode,
          label: `第${currentEpisode}集`,
          parsedUrl: proxyUrl,
          proxyUrl,
          title: directData.title || `第${currentEpisode}集`,
        },
      },
      metadata: {
        author: firstDrama.author || '',
        backdrop: firstDrama.backdrop || firstDrama.pic || '',
        vote_average: firstDrama.vote_average || 0,
        tmdb_id: firstDrama.tmdb_id || undefined,
      },
    };
  } catch (error) {
    console.error('备用API解析失败:', error);
    return { code: -1, msg: '视频源暂时不可用，请稍后再试' };
  }
}

export async function parseShortDramaEpisodeServer(
  id: number,
  episode: number,
  useProxy = true,
  dramaName?: string,
  alternativeApiUrl?: string,
  sourceKey?: string
): Promise<ShortDramaParseResult> {
  let lastError: unknown = null;

  try {
    const apis = await getShortDramaApis(sourceKey);
    for (const api of apis) {
      try {
        const result = await parseWithPrimarySource(api, id, episode, useProxy);
        if (result.code === 0) return result;
        lastError = result.msg;
      } catch (error) {
        lastError = error;
      }
    }
  } catch (error) {
    lastError = error;
  }

  if (dramaName && alternativeApiUrl) {
    const fallback = await parseWithAlternativeApi(dramaName, episode, alternativeApiUrl);
    if (fallback.code === 0) return fallback;
    lastError = fallback.msg;
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError || '解析失败');
  return { code: 1, msg: message };
}

// 从单个短剧源获取数据（通过分类名称查找）
async function fetchFromShortDramaSource(
  api: string,
  size: number,
  sourceKey?: string
): Promise<ShortDramaItem[]> {
  // Step 1: 获取分类列表，找到短剧相关分类的ID
  const listUrl = `${api}?ac=list`;

  const listResponse = await fetch(listUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!listResponse.ok) {
    throw new Error(`HTTP error! status: ${listResponse.status}`);
  }

  const listData = await listResponse.json();
  const categories = listData.class || [];

  // 查找短剧相关分类（父分类"短剧"或子分类标签）
  const shortDramaCategories = categories.filter((cat: any) =>
    cat.type_name && SHORT_DRAMA_KEYWORDS.some((kw: string) => cat.type_name.includes(kw))
  );

  if (shortDramaCategories.length === 0) {
    console.log(`该源没有短剧分类`);
    return [];
  }

  // 优先用父分类"短剧"，没有则用第一个匹配的子分类
  const primaryCategory = shortDramaCategories.find((cat: any) => cat.type_name === '短剧')
    || shortDramaCategories[0];
  const categoryId = primaryCategory.type_id;
  console.log(`找到短剧分类ID: ${categoryId} (${primaryCategory.type_name})`);

  // Step 2: 获取该分类的短剧列表
  const apiUrl = `${api}?ac=detail&t=${categoryId}&pg=1`;

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const items = data.list || [];

  return items.slice(0, size).map((item: any) => ({
    id: item.vod_id,
    name: item.vod_name,
    cover: item.vod_pic || '',
    update_time: item.vod_time || new Date().toISOString(),
    score: parseFloat(item.vod_score) || 0,
    episode_count: parseInt(item.vod_remarks?.replace(/[^\d]/g, '') || '1'),
    description: item.vod_content || item.vod_blurb || '',
    author: item.vod_actor || '',
    backdrop: item.vod_pic_slide || item.vod_pic || '',
    vote_average: parseFloat(item.vod_score) || 0,
    source_key: sourceKey,
  }));
}

// 服务端专用函数，从所有短剧源聚合数据
export async function getRecommendedShortDramas(
  category?: number,
  size = 10
): Promise<ShortDramaItem[]> {
  try {
    // 获取配置
    const config = await getConfig();

    // 筛选出所有启用的短剧源
    const shortDramaSources = config.SourceConfig.filter(
      source => source.type === 'shortdrama' && !source.disabled
    );

    console.log(`📺 找到 ${shortDramaSources.length} 个配置的短剧源`);

    // 如果没有配置短剧源，使用默认源
    if (shortDramaSources.length === 0) {
      console.log('📺 使用默认短剧源');
      return await fetchFromShortDramaSource(
        'https://tyyszyapi.com/api.php/provide/vod',
        size
      );
    }

    // 有配置短剧源，聚合所有源的数据
    console.log('📺 聚合多个短剧源的数据');
    const results = await Promise.allSettled(
      shortDramaSources.map(source => {
        console.log(`🔄 请求短剧源: ${source.name}`);
        return fetchFromShortDramaSource(source.api, size, source.key);
      })
    );

    // 合并所有成功的结果
    const allItems: ShortDramaItem[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        console.log(`✅ ${shortDramaSources[index].name}: 获取到 ${result.value.length} 条数据`);
        allItems.push(...result.value);
      } else {
        console.error(`❌ ${shortDramaSources[index].name}: 请求失败`, result.reason);
      }
    });

    // 去重（根据名称）
    const uniqueItems = Array.from(
      new Map(allItems.map(item => [item.name, item])).values()
    );

    // 按更新时间排序
    uniqueItems.sort((a, b) =>
      new Date(b.update_time).getTime() - new Date(a.update_time).getTime()
    );

    // 返回指定数量
    const finalItems = uniqueItems.slice(0, size);
    console.log(`📊 最终返回 ${finalItems.length} 条短剧数据`);

    return finalItems;
  } catch (error) {
    console.error('获取短剧推荐失败:', error);
    // 出错时fallback到默认源
    try {
      console.log('⚠️ 出错，fallback到默认源');
      return await fetchFromShortDramaSource(
        'https://tyyszyapi.com/api.php/provide/vod',
        size
      );
    } catch (fallbackError) {
      console.error('默认源也失败:', fallbackError);
      return [];
    }
  }
}
