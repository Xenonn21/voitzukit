// app/components/SearchCommand.tsx
// search component
'use client';

import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../lib/language-context';
import { useTheme } from '../lib/theme-context';
import ScrollThumb from './ScrollThumb';

export interface SearchToolItem {
  name: string;
  desc: string;
  icon: ReactNode;
  href: string;
  soon?: boolean;
}

export interface SearchPageItem {
  name: string;
  desc: string;
  href: string;
}

interface SearchResultItem {
  type: 'tool' | 'page';
  name: string;
  desc: string;
  icon?: ReactNode;
  href: string;
  soon?: boolean;
}

const pageIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2h9l5 5v15a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" />
    <path d="M14 2v5h5" />
    <path d="M8 13h8M8 17h8" />
  </svg>
);

function normalize(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function matches(query: string, item: SearchResultItem) {
  const q = normalize(query);
  return normalize(item.name).includes(q) || normalize(item.desc).includes(q);
}

export default function SearchCommand({ tools, pages }: { tools: SearchToolItem[]; pages: SearchPageItem[] }) {
  const { t } = useLanguage();
  const { accent } = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allItems: SearchResultItem[] = useMemo(
    () => [
      ...tools.map((tool) => ({ type: 'tool' as const, name: tool.name, desc: tool.desc, icon: tool.icon, href: tool.href, soon: tool.soon })),
      ...pages.map((page) => ({ type: 'page' as const, name: page.name, desc: page.desc, href: page.href })),
    ],
    [tools, pages]
  );

  const filtered = useMemo(() => {
    if (query.trim() === '') return allItems;
    return allItems.filter((item) => matches(query, item));
  }, [allItems, query]);

  const toolResults = filtered.filter((i) => i.type === 'tool');
  const pageResults = filtered.filter((i) => i.type === 'page');
  const selectableFlat = filtered.filter((i) => !i.soon);

  function closePalette() {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }

  function openPalette() {
    setOpen(true);
    setActiveIndex(0);
  }

  function goTo(item: SearchResultItem) {
    if (item.soon) return;
    closePalette();
    router.push(item.href);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCombo = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
      if (isCombo) {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) {
            setQuery('');
            setActiveIndex(0);
            return false;
          }
          setActiveIndex(0);
          return true;
        });
        return;
      }
      if (!open) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (selectableFlat.length === 0 ? 0 : (prev + 1) % selectableFlat.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (selectableFlat.length === 0 ? 0 : (prev - 1 + selectableFlat.length) % selectableFlat.length));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = selectableFlat[activeIndex];
        if (item) goTo(item);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectableFlat, activeIndex]);

  useEffect(() => {
    if (open) {
      document.documentElement.setAttribute('data-search-open', 'true');
    } else {
      document.documentElement.removeAttribute('data-search-open');
    }
    return () => document.documentElement.removeAttribute('data-search-open');
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-active="true"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function renderRow(item: SearchResultItem) {
    const flatIndex = selectableFlat.indexOf(item);
    const isActive = !item.soon && flatIndex === activeIndex;
    return (
      <button
        key={`${item.type}-${item.name}`}
        type="button"
        data-active={isActive}
        disabled={item.soon}
        onClick={() => goTo(item)}
        onMouseEnter={() => {
          if (!item.soon) setActiveIndex(flatIndex);
        }}
        className={`flex w-full items-center gap-3 rounded px-3 py-2.5 text-left transition-colors duration-100 ${
          item.soon ? 'cursor-not-allowed opacity-50' : isActive ? 'bg-[color-mix(in_srgb,var(--indigo)_12%,transparent)]' : 'hover:bg-surface-2'
        }`}
      >
        <span className={`flex h-[18px] w-[18px] shrink-0 [&>svg]:h-full [&>svg]:w-full ${isActive ? 'text-indigo' : 'text-text-dim'}`}>
          {item.icon ?? pageIcon}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] font-semibold text-text">{item.name}</span>
          <span className="truncate text-[10.5px] text-text-faint">{item.desc}</span>
        </span>
        {item.soon && (
          <span className="ml-auto shrink-0 rounded-full border border-line px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.06em] text-text-faint">
            {t.search.soon}
          </span>
        )}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-label={t.search.openLabel}
        className="flex items-center gap-2 rounded-full border border-line bg-void px-3 py-[7px] text-text-dim transition-colors duration-150 hover:border-indigo hover:text-indigo active:border-indigo active:text-indigo"
      >
        <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span className="hidden font-mono text-[10.5px] font-bold tracking-[0.04em] sm:inline">{t.search.openLabel}</span>
        <span className="hidden rounded border border-line px-1 py-[1px] font-mono text-[9px] text-text-faint sm:inline">⌘K</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-[var(--overlay)] px-4 pt-[10vh] backdrop-blur-sm"
          onClick={closePalette}
        >
          <div
            className="w-full max-w-[520px] overflow-hidden rounded-lg border border-line bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
              <svg className="h-4 w-4 shrink-0 text-text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.search.placeholder}
                className="w-full bg-transparent text-[13.5px] text-text placeholder:text-text-faint focus:outline-none"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setActiveIndex(0);
                    inputRef.current?.focus();
                  }}
                  aria-label={t.search.clearLabel}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-text-faint transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--indigo)_14%,transparent)] hover:text-indigo active:text-indigo"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <div className="relative">
              <div ref={listRef} className="search-scroll max-h-[52vh] overflow-y-auto p-2 pr-3.5">
                <style jsx>{`
                  .search-scroll {
                    scrollbar-width: none;
                  }
                  .search-scroll::-webkit-scrollbar {
                    display: none;
                  }
                `}</style>
                {filtered.length === 0 && (
                  <div className="px-3 py-8 text-center text-[12.5px] text-text-faint">{t.search.noResults(query)}</div>
                )}

                {toolResults.length > 0 && (
                  <div className="mb-1.5">
                    <div className="px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
                      {t.search.toolsGroup}
                    </div>
                    <div className="flex flex-col gap-0.5">{toolResults.map(renderRow)}</div>
                  </div>
                )}

                {pageResults.length > 0 && (
                  <div>
                    <div className="px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
                      {t.search.pagesGroup}
                    </div>
                    <div className="flex flex-col gap-0.5">{pageResults.map(renderRow)}</div>
                  </div>
                )}
              </div>
              <ScrollThumb accent={accent} target={listRef} thumbHeight={40} width={4} inset={6} className="right-1" />
            </div>

            <div className="hidden items-center gap-3.5 border-t border-line px-4 py-2.5 font-mono text-[9.5px] text-text-faint sm:flex">
              <span className="flex items-center gap-1">
                <span className="rounded border border-line px-1 py-[1px]">↑↓</span> {t.search.navHint}
              </span>
              <span className="flex items-center gap-1">
                <span className="rounded border border-line px-1 py-[1px]">↵</span> {t.search.selectHint}
              </span>
              <span className="flex items-center gap-1">
                <span className="rounded border border-line px-1 py-[1px]">esc</span> {t.search.closeHint}
              </span>
            </div>

            <div className="flex items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 font-mono text-[9.5px] text-text-faint sm:hidden">
              <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11.5V6a1.5 1.5 0 013 0v4.5" />
                <path d="M12 10.5V5a1.5 1.5 0 013 0v6" />
                <path d="M15 10.5a1.5 1.5 0 013 0V13" />
                <path d="M6 12.5V9a1.5 1.5 0 013 0" />
                <path d="M6 12.5c0 4.5 2.5 7.5 6 7.5s6-3 6-7v-.5" />
              </svg>
              {t.search.tapHint}
            </div>
          </div>
        </div>
      )}
    </>
  );
}