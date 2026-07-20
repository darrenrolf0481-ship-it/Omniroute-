import React, { useState, useRef, useMemo, useEffect } from 'react';

interface VirtualizedTextProps {
  text: string;
  keywords: string[];
  isRegex?: boolean;
  lineHeight?: number;
  className?: string;
  showLineNumbers?: boolean;
}

export const HighlightedLine: React.FC<{
  line: string;
  keywords: string[];
  isRegex?: boolean;
}> = React.memo(({ line, keywords, isRegex }) => {
  if (!line) return <span>&nbsp;</span>;
  if (!keywords || keywords.length === 0) return <span>{line}</span>;

  try {
    if (isRegex) {
      const regex = new RegExp(keywords[0], 'gi');
      const matches = Array.from(line.matchAll(regex));
      if (matches.length === 0) return <span>{line}</span>;

      const nodes: React.ReactNode[] = [];
      let lastIndex = 0;
      matches.forEach((match, i) => {
        if (match.index !== undefined) {
          nodes.push(<span key={`t-${i}`}>{line.substring(lastIndex, match.index)}</span>);
          nodes.push(
            <mark key={`m-${i}`} className="bg-blue-500/30 text-blue-400 font-medium px-1 rounded-sm ring-1 ring-blue-500/50">
              {match[0]}
            </mark>
          );
          lastIndex = match.index + match[0].length;
        }
      });
      nodes.push(<span key="t-end">{line.substring(lastIndex)}</span>);
      return <span>{nodes}</span>;
    } else {
      const regex = new RegExp(`(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
      const parts = line.split(regex);
      return (
        <span>
          {parts.map((part, i) => {
            const isMatch = keywords.some(k => k.toLowerCase() === part.toLowerCase());
            return isMatch ? (
              <mark key={i} className="bg-blue-500/30 text-blue-400 font-medium px-1 rounded-sm ring-1 ring-blue-500/50">
                {part}
              </mark>
            ) : (
              <span key={i}>{part}</span>
            );
          })}
        </span>
      );
    }
  } catch {
    return <span>{line}</span>;
  }
});

export const VirtualizedText: React.FC<VirtualizedTextProps> = ({
  text,
  keywords,
  isRegex = false,
  lineHeight = 22,
  className = "",
  showLineNumbers = true
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  const lines = useMemo(() => text.split('\n'), [text]);
  const maxLineDigits = Math.max(3, lines.length.toString().length);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      setScrollTop(el.scrollTop);
    };

    const handleResize = () => {
      setContainerHeight(el.clientHeight);
    };

    setContainerHeight(el.clientHeight);
    el.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      el.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const totalHeight = lines.length * lineHeight;
  const overscan = 15;
  const startIndex = Math.max(0, Math.floor(scrollTop / lineHeight) - overscan);
  const endIndex = Math.min(lines.length, Math.ceil((scrollTop + containerHeight) / lineHeight) + overscan);

  const visibleLines = useMemo(() => {
    return lines.slice(startIndex, endIndex).map((line, idx) => ({
      index: startIndex + idx,
      line
    }));
  }, [lines, startIndex, endIndex]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-y-auto h-full w-full font-mono text-[13px] leading-[22px] ${className}`}
    >
      <div style={{ height: totalHeight, width: '100%', position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: startIndex * lineHeight,
            left: 0,
            right: 0,
          }}
        >
          {visibleLines.map(({ index, line }) => (
            <div
              key={index}
              style={{ height: lineHeight, whiteSpace: 'pre' }}
              className="flex items-center hover:bg-white/[0.03] transition-colors group"
            >
              {showLineNumbers && (
                <span
                  style={{ minWidth: `${maxLineDigits * 8 + 16}px` }}
                  className="pr-3 text-right select-none text-white/20 group-hover:text-blue-400/60 font-mono text-[11px] shrink-0 border-r border-white/5 mr-3"
                >
                  {index + 1}
                </span>
              )}
              <span className="truncate flex-1 text-white/80">
                <HighlightedLine line={line} keywords={keywords} isRegex={isRegex} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
