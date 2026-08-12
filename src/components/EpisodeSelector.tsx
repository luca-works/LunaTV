/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Gauge, RefreshCw, Wifi } from 'lucide-react';

import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl, VideoSourceTestResult } from '@/lib/utils';

// 使用统一的视频测试结果类型
type VideoInfo = VideoSourceTestResult;

// 延迟容差：延迟差距小于此值时，优先比较速度（避免因微小延迟差异导致排序抖动）
const RESPONSE_TIE_BREAKER_MS = 300;

interface EpisodeSelectorProps {
  /** 总集数 */
  totalEpisodes: number;
  /** 剧集标题 */
  episodes_titles: string[];
  /** 每页显示多少集，默认 50 */
  episodesPerPage?: number;
  /** 当前选中的集数（1 开始） */
  value?: number;
  /** 用户点击选集后的回调 */
  onChange?: (episodeNumber: number) => void;
  /** 换源相关 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 预计算的测速结果，避免重复测速 */
  precomputedVideoInfo?: Map<string, VideoInfo>;
}

/**
 * 选集组件，支持分页、自动滚动聚焦当前分页标签，以及换源功能。
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // 存储每个源的视频信息
  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map()
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );

  // 手动测速相关状态
  const [manualTesting, setManualTesting] = useState(false);
  const [manualProgress, setManualProgress] = useState({ done: 0, total: 0 });
  const [testingSourceKeys, setTestingSourceKeys] = useState<Set<string>>(new Set());

  // 排序模式状态：'original' | 'speed' | 'name'
  const [sortMode, setSortMode] = useState<'original' | 'speed' | 'name'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('episodeSelectorSortMode');
      if (saved === 'speed' || saved === 'name' || saved === 'original') {
        return saved;
      }
    }
    return 'original';
  });
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);

  // 使用 ref 来避免闭包问题
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  // 同步状态到 ref
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  // 主要的 tab 状态：'episodes' 或 'sources'
  // 当只有一集时默认展示 "换源"，并隐藏 "选集" 标签
  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources'
  );

  // 当前分页索引（0 开始）
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // 是否倒序显示
  const [descending, setDescending] = useState<boolean>(false);

  // 根据 descending 状态计算实际显示的分页索引
  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  // 获取视频信息的函数 - 移除 attemptedSources 依赖避免不必要的重新创建
  const getVideoInfo = useCallback(async (source: SearchResult) => {
    const sourceKey = `${source.source}-${source.id}`;

    // 使用 ref 获取最新的状态，避免闭包问题
    if (attemptedSourcesRef.current.has(sourceKey)) {
      return;
    }

    // 获取第一集的URL
    if (!source.episodes || source.episodes.length === 0) {
      return;
    }
    const episodeUrl =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

    // 标记为已尝试
    setAttemptedSources((prev) => new Set(prev).add(sourceKey));

    try {
      const info = await getVideoResolutionFromM3u8(episodeUrl);
      setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
    } catch (error) {
      // 失败时保存错误状态
      setVideoInfoMap((prev) =>
        new Map(prev).set(sourceKey, {
          quality: '错误',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
          status: 'failed',
          message: error instanceof Error ? error.message : '测速失败',
          playable: false,
          testedAt: Date.now(),
        })
      );
    }
  }, []);

  // 当有预计算结果时，先合并到videoInfoMap中
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      // 原子性地更新两个状态，避免时序问题
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => {
          newMap.set(key, value);
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((info, key) => {
          if (!info.hasError) {
            newSet.add(key);
          }
        });
        return newSet;
      });

      // 同步更新 ref，确保 getVideoInfo 能立即看到更新
      precomputedVideoInfo.forEach((info, key) => {
        if (!info.hasError) {
          attemptedSourcesRef.current.add(key);
        }
      });
    }
  }, [precomputedVideoInfo]);

  // 读取本地"优选和测速"开关，默认开启
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return false;
  });

  // 手动测速函数
  const handleManualSpeedTest = useCallback(async () => {
    if (manualTesting || availableSources.length === 0) return;

    setManualTesting(true);
    setManualProgress({ done: 0, total: availableSources.length });

    // 清空之前的测速结果
    setVideoInfoMap(new Map());
    setAttemptedSources(new Set());
    attemptedSourcesRef.current = new Set();
    videoInfoMapRef.current = new Map();

    const batchSize = 3; // 每批测试3个源
    let completed = 0;

    for (let i = 0; i < availableSources.length; i += batchSize) {
      const batch = availableSources.slice(i, i + batchSize);

      // 标记正在测试的源
      batch.forEach(source => {
        const sourceKey = `${source.source}-${source.id}`;
        setTestingSourceKeys(prev => new Set(prev).add(sourceKey));
      });

      await Promise.all(
        batch.map(async (source) => {
          const sourceKey = `${source.source}-${source.id}`;

          if (!source.episodes || source.episodes.length === 0) {
            completed++;
            setManualProgress({ done: completed, total: availableSources.length });
            setTestingSourceKeys(prev => {
              const next = new Set(prev);
              next.delete(sourceKey);
              return next;
            });
            return;
          }

          const episodeUrl = source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

          try {
            const info = await getVideoResolutionFromM3u8(episodeUrl);
            setVideoInfoMap(prev => new Map(prev).set(sourceKey, info));
            setAttemptedSources(prev => new Set(prev).add(sourceKey));
            attemptedSourcesRef.current.add(sourceKey);
          } catch (error) {
            setVideoInfoMap(prev =>
              new Map(prev).set(sourceKey, {
                quality: '错误',
                loadSpeed: '未知',
                pingTime: 9999,
                hasError: true,
                status: 'failed',
                message: error instanceof Error ? error.message : '测速失败',
                playable: false,
                testedAt: Date.now(),
              })
            );
            setAttemptedSources(prev => new Set(prev).add(sourceKey));
            attemptedSourcesRef.current.add(sourceKey);
          } finally {
            completed++;
            setManualProgress({ done: completed, total: availableSources.length });
            setTestingSourceKeys(prev => {
              const next = new Set(prev);
              next.delete(sourceKey);
              return next;
            });
          }
        })
      );
    }

    setManualTesting(false);
    setTestingSourceKeys(new Set());

    // 测速完成后自动切换到速度排序
    setSortMode('speed');
    localStorage.setItem('episodeSelectorSortMode', 'speed');
  }, [manualTesting, availableSources]);

  // 当切换到换源tab并且有源数据时，异步获取视频信息 - 移除 attemptedSources 依赖避免循环触发
  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (
        !optimizationEnabled || // 若关闭测速则直接退出
        activeTab !== 'sources' ||
        availableSources.length === 0
      )
        return;

      // 筛选出尚未测速的播放源
      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        return !attemptedSourcesRef.current.has(sourceKey);
      });

      if (pendingSources.length === 0) return;

      const batchSize = Math.ceil(pendingSources.length / 2);

      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }
    };

    fetchVideoInfosInBatches();
    // 依赖项保持与之前一致
  }, [activeTab, availableSources, getVideoInfo, optimizationEnabled]);

  // 升序分页标签
  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  // 根据 descending 状态决定分页标签的排序和内容
  const categories = useMemo(() => {
    if (descending) {
      // 倒序时，label 也倒序显示
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 添加鼠标悬停状态管理
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);

  // 阻止页面竖向滚动
  const preventPageScroll = useCallback((e: WheelEvent) => {
    if (isCategoryHovered) {
      e.preventDefault();
    }
  }, [isCategoryHovered]);

  // 处理滚轮事件，实现横向滚动
  const handleWheel = useCallback((e: WheelEvent) => {
    if (isCategoryHovered && categoryContainerRef.current) {
      e.preventDefault(); // 阻止默认的竖向滚动

      const container = categoryContainerRef.current;
      const scrollAmount = e.deltaY * 2; // 调整滚动速度

      // 根据滚轮方向进行横向滚动
      container.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
    }
  }, [isCategoryHovered]);

  // 添加全局wheel事件监听器
  useEffect(() => {
    if (isCategoryHovered) {
      // 鼠标悬停时阻止页面滚动
      document.addEventListener('wheel', preventPageScroll, { passive: false });
      document.addEventListener('wheel', handleWheel, { passive: false });
    } else {
      // 鼠标离开时恢复页面滚动
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    }

    return () => {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [isCategoryHovered, preventPageScroll, handleWheel]);

  // 当分页切换时，将激活的分页标签滚动到视口中间
  useEffect(() => {
    const btn = buttonRefs.current[displayPage];
    if (btn) {
      // 使用原生 scrollIntoView API 自动滚动到视口中央
      btn.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',  // 水平居中显示选中的分页
      });
    }
  }, [displayPage, pageCount]);

  // 处理换源tab点击，只在点击时才搜索
  const handleSourceTabClick = () => {
    setActiveTab('sources');
  };

  const handleCategoryClick = useCallback(
    (index: number) => {
      if (descending) {
        // 在倒序时，需要将显示索引转换为实际索引
        setCurrentPage(pageCount - 1 - index);
      } else {
        setCurrentPage(index);
      }
    },
    [descending, pageCount]
  );

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      onChange?.(episodeNumber);
    },
    [onChange]
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      setSourceSheetOpen(false);
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange]
  );

  const renderSourceQualityBadge = (videoInfo?: VideoInfo, isTesting = false) => {
    if (isTesting) {
      return (
        <div
          data-testid='source-quality-badge'
          className='flex shrink-0 items-center gap-1 bg-blue-500/10 dark:bg-blue-400/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded text-xs'
        >
          <RefreshCw className='w-3 h-3 animate-spin' />
          <span>检测中</span>
        </div>
      );
    }

    if (!videoInfo) return null;

    if (videoInfo.hasError || videoInfo.status === 'failed') {
      return (
        <div
          data-testid='source-quality-badge'
          className='shrink-0 bg-red-500/10 dark:bg-red-400/20 text-red-600 dark:text-red-400 px-2 py-0.5 rounded text-xs min-w-[60px] text-center'
        >
          检测失败
        </div>
      );
    }

    if (videoInfo.quality !== '未知') {
      const is4K = videoInfo.quality === '4K';
      const is2K = videoInfo.quality === '2K';
      const is1080p = videoInfo.quality === '1080p';
      const is720p = videoInfo.quality === '720p';

      let bgColor = 'bg-gray-500/10 dark:bg-gray-400/20';
      let textColor = 'text-gray-600 dark:text-gray-400';

      if (is4K || is2K) {
        bgColor = 'bg-purple-500/10 dark:bg-purple-400/20';
        textColor = 'text-purple-600 dark:text-purple-400';
      } else if (is1080p || is720p) {
        bgColor = 'bg-green-500/10 dark:bg-green-400/20';
        textColor = 'text-green-600 dark:text-green-400';
      } else if (videoInfo.quality === '480p' || videoInfo.quality === 'SD') {
        bgColor = 'bg-yellow-500/10 dark:bg-yellow-400/20';
        textColor = 'text-yellow-600 dark:text-yellow-400';
      }

      return (
        <div
          data-testid='source-quality-badge'
          className={`flex shrink-0 items-center gap-1 ${bgColor} ${textColor} px-2 py-0.5 rounded text-xs font-semibold`}
        >
          <Wifi className='w-3 h-3' />
          <span>{videoInfo.quality}</span>
        </div>
      );
    }

    if (videoInfo.status === 'ok' || videoInfo.playable) {
      return (
        <div
          data-testid='source-quality-badge'
          className='flex shrink-0 items-center gap-1 bg-green-500/10 dark:bg-green-400/20 text-green-600 dark:text-green-400 px-2 py-0.5 rounded text-xs'
        >
          <Wifi className='w-3 h-3' />
          <span>已连通</span>
        </div>
      );
    }

    return null;
  };

  const getSourceKey = (source: SearchResult) => `${source.source}-${source.id}`;

  const isCurrentSourceItem = useCallback(
    (source: SearchResult) =>
      source.source?.toString() === currentSource?.toString() &&
      source.id?.toString() === currentId?.toString(),
    [currentId, currentSource]
  );

  const sortedSources = useMemo(() => {
    return [...availableSources].sort((a, b) => {
      const aIsCurrent = isCurrentSourceItem(a);
      const bIsCurrent = isCurrentSourceItem(b);

      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;

      if (sortMode === 'speed') {
        const aInfo = videoInfoMap.get(getSourceKey(a));
        const bInfo = videoInfoMap.get(getSourceKey(b));

        if (aInfo && !bInfo) return -1;
        if (!aInfo && bInfo) return 1;

        if (aInfo && bInfo) {
          const aPlayable = aInfo.playable !== false;
          const bPlayable = bInfo.playable !== false;
          if (aPlayable && !bPlayable) return -1;
          if (!aPlayable && bPlayable) return 1;

          if (aPlayable && bPlayable) {
            const pingDiff = (aInfo.pingTime || 0) - (bInfo.pingTime || 0);
            if (Math.abs(pingDiff) > RESPONSE_TIE_BREAKER_MS) {
              return pingDiff;
            }

            const speedDiff = (bInfo.speedKBps || 0) - (aInfo.speedKBps || 0);
            if (speedDiff !== 0) return speedDiff;
            if (pingDiff !== 0) return pingDiff;
          }
        }
      }

      if (sortMode === 'name') {
        return (a.title || '').localeCompare(b.title || '', 'zh-CN');
      }

      return 0;
    });
  }, [availableSources, isCurrentSourceItem, sortMode, videoInfoMap]);

  const measuredSourceCount = useMemo(
    () => availableSources.filter((source) => videoInfoMap.has(getSourceKey(source))).length,
    [availableSources, videoInfoMap]
  );

  const fastestSource = useMemo(() => {
    return sortedSources.find((source) => {
      const info = videoInfoMap.get(getSourceKey(source));
      return info && info.playable !== false && !info.hasError && info.status !== 'failed';
    });
  }, [sortedSources, videoInfoMap]);

  const previewSources = useMemo(() => {
    const result: SearchResult[] = [];
    const current = sortedSources.find(isCurrentSourceItem);
    if (current) {
      result.push(current);
    }

    for (const source of sortedSources) {
      if (current && getSourceKey(source) === getSourceKey(current)) {
        continue;
      }
      result.push(source);
      if (result.length >= 2) {
        break;
      }
    }
    return result.slice(0, 2);
  }, [isCurrentSourceItem, sortedSources]);

  const renderSpeedSummary = (source: SearchResult) => {
    const sourceKey = getSourceKey(source);
    const videoInfo = videoInfoMap.get(sourceKey);
    const isTesting = testingSourceKeys.has(sourceKey);

    if (isTesting) {
      return (
        <div className='flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400'>
          <RefreshCw className='h-3 w-3 animate-spin' />
          正在测速
        </div>
      );
    }

    if (!videoInfo) {
      return <span className='text-xs text-slate-400 dark:text-slate-500'>未测速</span>;
    }

    if (videoInfo.hasError || videoInfo.status === 'failed') {
      return (
        <span className='max-w-[120px] truncate text-xs font-medium text-red-500 dark:text-red-400'>
          {videoInfo.message || '测速失败'}
        </span>
      );
    }

    return (
      <div className='flex items-center gap-2 text-xs font-medium'>
        <span className='text-green-600 dark:text-green-400'>{videoInfo.loadSpeed}</span>
        <span className='text-orange-600 dark:text-orange-400'>{videoInfo.pingTime}ms</span>
      </div>
    );
  };

  const renderSourceRow = (source: SearchResult, index: number, inSheet = false) => {
    const isCurrentSource = isCurrentSourceItem(source);
    const sourceKey = getSourceKey(source);
    const videoInfo = videoInfoMap.get(sourceKey);

    return (
      <button
        key={sourceKey}
        type='button'
        onClick={() => !isCurrentSource && handleSourceClick(source)}
        className={`group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-all duration-200 active:scale-[0.99] ${
          isCurrentSource
            ? 'border-green-400/70 bg-linear-to-r from-green-50 via-emerald-50 to-teal-50 shadow-sm shadow-green-500/10 dark:border-green-400/40 dark:from-green-900/30 dark:via-emerald-900/25 dark:to-teal-900/25'
            : 'border-slate-200/70 bg-white/85 hover:border-blue-300 hover:bg-blue-50/80 dark:border-white/10 dark:bg-white/5 dark:hover:border-blue-400/40 dark:hover:bg-blue-900/20'
        } ${inSheet ? '' : 'min-h-[76px]'}`}
      >
        <div className='h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-200 shadow-sm dark:bg-slate-700'>
          {source.poster && (
            <img
              src={processImageUrl(source.poster)}
              alt={source.title}
              className='h-full w-full object-cover'
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </div>

        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <h3 className='truncate text-sm font-semibold text-slate-900 dark:text-slate-100'>
              {source.title}
            </h3>
            {isCurrentSource && (
              <span className='shrink-0 rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-semibold text-white'>
                当前
              </span>
            )}
          </div>
          <div
            data-testid='source-speed-metrics'
            className='mt-1.5 flex items-center justify-between gap-2'
          >
            <div className='min-w-0'>{renderSpeedSummary(source)}</div>
            {renderSourceQualityBadge(videoInfo)}
          </div>
          {/* 源名称和集数信息 */}
          <div className='mt-1 flex min-w-0 flex-wrap items-center gap-1.5'>
            <span className='max-w-[120px] truncate rounded-md border border-slate-300/80 px-1.5 py-0.5 text-[11px] text-slate-600 dark:border-slate-600 dark:text-slate-300'>
              {source.source_name}
            </span>
            {(source.episodes?.length || 0) > 1 && (
              <span className='text-[11px] text-slate-500 dark:text-slate-400'>
                {source.episodes?.length || 0} 集
              </span>
            )}
          </div>
        </div>

        {!isCurrentSource && (
          <span className='shrink-0 text-xs font-medium text-slate-400 transition-colors group-hover:text-blue-500 dark:text-slate-500'>
            切换
          </span>
        )}
      </button>
    );
  };

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes
  );

  return (
    <div className='md:ml-2 px-4 sm:px-4 py-0 lg:h-full rounded-2xl bg-white/65 dark:bg-white/5 flex flex-col border border-slate-200/70 dark:border-white/15 shadow-sm overflow-visible lg:overflow-hidden'>
      {/* 主要的 Tab 切换 - 美化版本 */}
      <div className='flex mb-3 -mx-4 shrink-0 relative overflow-hidden rounded-t-2xl border-b border-slate-200/70 dark:border-white/10'>
        {totalEpisodes > 1 && (
          <div
            onClick={() => setActiveTab('episodes')}
            className={`group flex-1 py-3 sm:py-3.5 px-4 sm:px-6 text-center cursor-pointer transition-all duration-300 font-semibold relative overflow-hidden active:scale-[0.98] min-h-[44px]
              ${activeTab === 'episodes'
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
              }
            `.trim()}
          >
            {/* 激活态背景光晕 */}
            {activeTab === 'episodes' && (
              <div className='absolute inset-0 bg-linear-to-r from-green-50 via-emerald-50 to-teal-50 dark:from-green-900/20 dark:via-emerald-900/20 dark:to-teal-900/20 -z-10'></div>
            )}
            {/* 非激活态背景 */}
            {activeTab !== 'episodes' && (
              <div className='absolute inset-0 bg-gray-100/50 dark:bg-gray-800/50 group-hover:bg-gray-100 dark:group-hover:bg-gray-800/70 transition-colors duration-300 -z-10'></div>
            )}
            {/* 悬浮光效 */}
            <div className='absolute inset-0 bg-linear-to-r from-transparent via-green-100/0 to-transparent dark:via-green-500/0 group-hover:via-green-100/50 dark:group-hover:via-green-500/10 transition-all duration-300 -z-10'></div>
            <span className='relative z-10 font-bold text-sm sm:text-base'>选集</span>
          </div>
        )}
        <div
          onClick={handleSourceTabClick}
          className={`group flex-1 py-3 sm:py-3.5 px-4 sm:px-6 text-center cursor-pointer transition-all duration-300 font-semibold relative overflow-hidden active:scale-[0.98] min-h-[44px]
            ${activeTab === 'sources'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-gray-700 hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400'
            }
          `.trim()}
        >
          {/* 激活态背景光晕 */}
          {activeTab === 'sources' && (
            <div className='absolute inset-0 bg-linear-to-r from-blue-50 via-cyan-50 to-sky-50 dark:from-blue-900/20 dark:via-cyan-900/20 dark:to-sky-900/20 -z-10'></div>
          )}
          {/* 非激活态背景 */}
          {activeTab !== 'sources' && (
            <div className='absolute inset-0 bg-gray-100/50 dark:bg-gray-800/50 group-hover:bg-gray-100 dark:group-hover:bg-gray-800/70 transition-colors duration-300 -z-10'></div>
          )}
          {/* 悬浮光效 */}
          <div className='absolute inset-0 bg-linear-to-r from-transparent via-blue-100/0 to-transparent dark:via-blue-500/0 group-hover:via-blue-100/50 dark:group-hover:via-blue-500/10 transition-all duration-300 -z-10'></div>
          <span className='relative z-10 font-bold text-sm sm:text-base'>换源</span>
        </div>
      </div>

      {/* 选集 Tab 内容 */}
      {activeTab === 'episodes' && (
        <>
          {/* 分类标签 */}
          <div className='flex items-center gap-2 sm:gap-4 mb-3 sm:mb-4 border-b border-gray-300 dark:border-gray-700 -mx-4 px-4 shrink-0'>
            <div
              className='flex-1 overflow-x-auto scrollbar-hide'
              ref={categoryContainerRef}
              onMouseEnter={() => setIsCategoryHovered(true)}
              onMouseLeave={() => setIsCategoryHovered(false)}
              style={{
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none'
              }}
            >
              <div className='flex gap-2 min-w-max pb-2'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`min-w-[64px] sm:min-w-[80px] relative py-2 sm:py-2.5 px-2 sm:px-3 text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap shrink-0 text-center rounded-t-lg active:scale-95
                        ${isActive
                          ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
                          : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400 hover:bg-gray-50 dark:hover:bg-white/5'
                        }
                      `.trim()}
                    >
                      {label}
                      {isActive && (
                        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400 rounded-full' />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 向上/向下按钮 */}
            <button
              className='shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-all duration-200 hover:scale-105 active:scale-95 transform translate-y-[-4px]'
              onClick={() => {
                // 切换集数排序（正序/倒序）
                setDescending((prev) => !prev);
              }}
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
          </div>

          {/* 集数网格 */}
          <div className='flex flex-wrap gap-2 sm:gap-3 overflow-y-auto flex-1 content-start pb-4'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              const episodes = Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i
              );
              return episodes;
            })().map((episodeNumber) => {
              const isActive = episodeNumber === value;
              return (
                <button
                  key={episodeNumber}
                  onClick={() => handleEpisodeClick(episodeNumber - 1)}
                  className={`group min-h-[40px] sm:min-h-[44px] min-w-[40px] sm:min-w-[44px] px-2 sm:px-3 py-2 flex items-center justify-center text-xs sm:text-sm font-semibold rounded-lg transition-all duration-200 whitespace-nowrap font-mono relative overflow-hidden active:scale-95
                    ${isActive
                      ? 'bg-linear-to-r from-green-500 via-emerald-500 to-teal-500 text-white shadow-lg shadow-green-500/30 dark:from-green-600 dark:via-emerald-600 dark:to-teal-600 dark:shadow-green-500/20 scale-105'
                      : 'bg-linear-to-r from-gray-200 to-gray-100 text-gray-700 hover:from-gray-300 hover:to-gray-200 hover:scale-105 hover:shadow-md dark:from-white/10 dark:to-white/5 dark:text-gray-300 dark:hover:from-white/20 dark:hover:to-white/15'
                    }`.trim()}
                >
                  {/* 激活态光晕效果 */}
                  {isActive && (
                    <div className='absolute inset-0 bg-linear-to-r from-green-400 via-emerald-400 to-teal-400 opacity-30 blur'></div>
                  )}
                  {/* 悬浮态闪光效果 */}
                  {!isActive && (
                    <div className='absolute inset-0 bg-linear-to-r from-transparent via-white/0 to-transparent group-hover:via-white/20 dark:group-hover:via-white/10 transition-all duration-300'></div>
                  )}
                  <span className='relative z-10'>
                    {(() => {
                      const title = episodes_titles?.[episodeNumber - 1];
                      if (!title) {
                        return episodeNumber;
                      }
                      // 如果匹配"第X集"、"第X话"、"X集"、"X话"格式，提取中间的数字
                      const match = title.match(/(?:第)?(\d+)(?:集|话)/);
                      if (match) {
                        return match[1];
                      }
                      return title;
                    })()}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {activeTab === 'sources' && (
        <div className='mt-3 flex flex-col gap-3'>
          <div className='rounded-xl border border-blue-200/80 bg-blue-50/70 p-3 dark:border-blue-700/60 dark:bg-blue-900/20'>
            <div className='flex items-center justify-between gap-3'>
              <div className='min-w-0'>
                <div className='flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100'>
                  <Gauge className='h-4 w-4 text-blue-600 dark:text-blue-400' />
                  <span>测速</span>
                  <span className='text-xs font-medium text-slate-500 dark:text-slate-400'>
                    {measuredSourceCount}/{availableSources.length}
                  </span>
                </div>
                <div className='mt-1 truncate text-xs text-slate-500 dark:text-slate-400'>
                  {fastestSource
                    ? (() => {
                        const info = videoInfoMap.get(getSourceKey(fastestSource));
                        return info && !info.hasError && info.status !== 'failed'
                          ? `最快：${fastestSource.source_name} · ${info.loadSpeed} · ${info.pingTime}ms`
                          : `最快：${fastestSource.source_name}`;
                      })()
                    : manualTesting
                      ? '正在检测可用源'
                      : '按速度排序后优先显示可用源'}
                </div>
              </div>
              <button
                onClick={handleManualSpeedTest}
                disabled={manualTesting || availableSources.length === 0}
                className='flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition-all duration-200 hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-400'
              >
                <RefreshCw className={`h-3.5 w-3.5 ${manualTesting ? 'animate-spin' : ''}`} />
                {manualTesting ? '测速中' : '手动测速'}
              </button>
            </div>
            {manualTesting && (
              <div className='mt-2 flex items-center gap-2'>
                <div className='h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700'>
                  <div
                    className='h-full bg-linear-to-r from-blue-500 to-cyan-500 transition-all duration-300'
                    style={{
                      width: manualProgress.total > 0
                        ? `${(manualProgress.done / manualProgress.total) * 100}%`
                        : '0%',
                    }}
                  />
                </div>
                <span className='font-mono text-xs text-slate-500 dark:text-slate-400'>
                  {manualProgress.done}/{manualProgress.total}
                </span>
              </div>
            )}
          </div>

          <div className='flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide'>
            <span className='shrink-0 text-xs text-slate-500 dark:text-slate-400'>排序</span>
            {[
              { key: 'original', label: '原始' },
              { key: 'speed', label: '速度' },
              { key: 'name', label: '名称' },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  setSortMode(item.key as 'original' | 'speed' | 'name');
                  localStorage.setItem('episodeSelectorSortMode', item.key);
                }}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  sortMode === item.key
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-800 dark:text-blue-400'
                    : 'bg-white/50 text-slate-600 hover:text-slate-900 dark:bg-white/5 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
            {sortMode === 'speed' && (
              <span className='shrink-0 rounded-lg bg-amber-400/15 px-2 py-1 text-xs font-semibold text-amber-600 dark:text-amber-300'>
                最快优先
              </span>
            )}
          </div>

          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='h-8 w-8 animate-spin rounded-full border-b-2 border-green-500'></div>
              <span className='ml-2 text-sm text-slate-600 dark:text-slate-300'>搜索中...</span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <p className='text-sm text-red-600 dark:text-red-400'>{sourceSearchError}</p>
            </div>
          )}

          {!sourceSearchLoading && !sourceSearchError && availableSources.length === 0 && (
            <div className='flex items-center justify-center py-8 text-sm text-slate-600 dark:text-slate-300'>
              暂无可用的换源
            </div>
          )}

          {!sourceSearchLoading && !sourceSearchError && availableSources.length > 0 && (
            <>
              <div className='space-y-2'>
                {previewSources.map((source, index) => renderSourceRow(source, index))}
              </div>
              <button
                type='button'
                onClick={() => setSourceSheetOpen(true)}
                className='flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-blue-400/40 dark:hover:text-blue-300'
              >
                查看全部 {availableSources.length} 个源
              </button>
            </>
          )}

          {sourceSheetOpen && (
            <div className='fixed inset-0 z-50 flex items-end bg-black/35 backdrop-blur-sm lg:items-center lg:justify-center'>
              <div className='max-h-[82dvh] w-full overflow-hidden rounded-t-3xl bg-slate-50 shadow-2xl dark:bg-slate-950 lg:max-w-xl lg:rounded-3xl'>
                <div className='sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 px-4 pb-3 pt-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95'>
                  <div className='mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700' />
                  <div className='flex items-center justify-between gap-3'>
                    <div>
                      <h3 className='text-base font-bold text-slate-900 dark:text-white'>全部视频源</h3>
                      <p className='mt-0.5 text-xs text-slate-500 dark:text-slate-400'>
                        已测 {measuredSourceCount}/{availableSources.length}
                      </p>
                    </div>
                    <button
                      type='button'
                      onClick={() => setSourceSheetOpen(false)}
                      className='h-9 rounded-full bg-slate-200 px-4 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                    >
                      关闭
                    </button>
                  </div>
                </div>
                <div className='max-h-[calc(82dvh-88px)] space-y-2 overflow-y-auto px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+24px)]'>
                  {sortedSources.map((source, index) => renderSourceRow(source, index, true))}
                  <button
                    onClick={() => {
                      if (videoTitle) {
                        router.push(`/search?q=${encodeURIComponent(videoTitle)}`);
                      }
                    }}
                    className='w-full py-3 text-center text-xs text-slate-500 transition-colors hover:text-green-500 dark:text-slate-400 dark:hover:text-green-400'
                  >
                    影片匹配有误？点击去搜索
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
