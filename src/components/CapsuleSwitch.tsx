/* eslint-disable react-hooks/exhaustive-deps */

import React, { useEffect, useRef, useState } from 'react';

interface CapsuleSwitchProps {
  options: { label: string; value: string }[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
}

const CapsuleSwitch: React.FC<CapsuleSwitchProps> = ({
  options,
  active,
  onChange,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const activeIndex = options.findIndex((opt) => opt.value === active);

  // 更新指示器位置
  const updateIndicatorPosition = () => {
    if (
      activeIndex >= 0 &&
      buttonRefs.current[activeIndex] &&
      containerRef.current
    ) {
      const button = buttonRefs.current[activeIndex];
      const container = containerRef.current;
      if (button && container) {
        const buttonRect = button.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (buttonRect.width > 0) {
          setIndicatorStyle({
            left: buttonRect.left - containerRect.left,
            width: buttonRect.width,
          });
        }
      }
    }
  };

  // 组件挂载时立即计算初始位置
  useEffect(() => {
    const timeoutId = setTimeout(updateIndicatorPosition, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // 监听选中项变化
  useEffect(() => {
    const timeoutId = setTimeout(updateIndicatorPosition, 0);
    return () => clearTimeout(timeoutId);
  }, [activeIndex]);

  return (
    <div className="max-w-full overflow-x-auto scrollbar-hide">
      <div
        ref={containerRef}
        className={`relative inline-flex overflow-hidden rounded-2xl border border-white bg-white p-1 dark:border-slate-800 dark:bg-slate-900 ${
          className || ''
        }`}
      >
        {/* 滑动的渐变背景指示器 */}
        {indicatorStyle.width > 0 && (
          <div
            className='absolute top-1 bottom-1 z-0 rounded-xl bg-linear-to-r from-blue-500 to-teal-500 shadow-[0_4px_14px_rgba(14,165,233,0.38)] transition-all duration-300 ease-out dark:from-blue-600 dark:to-teal-500'
            style={{
              left: `${indicatorStyle.left}px`,
              width: `${indicatorStyle.width}px`,
            }}
          />
        )}

        {options.map((opt, index) => {
          const isActive = active === opt.value;
          const separatorHidden = isActive || activeIndex === index - 1;
          return (
            <button
              key={opt.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              onClick={() => onChange(opt.value)}
              className={`relative z-10 min-w-16 px-3 py-1.5 text-xs font-semibold sm:min-w-24 sm:px-5 sm:py-2.5 sm:text-sm rounded-xl transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'text-white dark:text-white'
                  : 'text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              {index > 0 && (
                <span
                  className={`pointer-events-none absolute left-0 top-1/2 h-5 w-px -translate-y-1/2 bg-slate-300/90 transition-opacity duration-200 dark:bg-slate-600/80 ${
                    separatorHidden ? 'opacity-0' : 'opacity-100'
                  }`}
                />
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CapsuleSwitch;
