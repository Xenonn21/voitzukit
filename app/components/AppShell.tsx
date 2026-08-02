// app/components/AppShell.tsx
// app shell, includes header, sidebar, and footer, etc idk for specific
'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '../lib/language-context';
import { useTheme, type Accent } from '../lib/theme-context';
import BackgroundFX, { type BgEffect } from './BackgroundFX';
import ScrollThumb from './ScrollThumb';
import SearchCommand from './SearchCommand';

interface ToolLink {
  name: string;
  desc: string;
  icon: ReactNode;
  href: string;
  active?: boolean;
  soon?: boolean;
}

const icon = {
  image: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  ),
  imageToPdf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M13.5 9.5v7A2 2 0 0015.5 18.5h4A2 2 0 0021.5 16.5v-7A2 2 0 0019.5 7.5h-4A2 2 0 0013.5 9.5z" />
      <path d="M16.5 12h2.5M16.5 14.5h2.5" />
    </svg>
  ),
  htmlToPdf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="19" height="19" rx="2" />
      <path d="M8.5 9L6 12l2.5 3M15.5 9L18 12l-2.5 3" />
    </svg>
  ),
  docxToHtml: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h8l5 5v14a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M13 2v5h5" />
      <path d="M8 15.5l-1.5 2 1.5 2M13 15.5l1.5 2-1.5 2M11 15l-1 4" />
    </svg>
  ),
  pdf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2h9l5 5v15a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M14 2v5h5" />
    </svg>
  ),
  qr: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 21h2M21 14v2" />
    </svg>
  ),
  eraser: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20H8l-6-6a2 2 0 010-2.8L13.6 2a2 2 0 012.8 0l4.6 4.6a2 2 0 010 2.8L11.6 20" />
      <path d="M6.5 12.5L14 20" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  ),
  pdfMergeSplit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h8l4 4v6a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path d="M13 3v4h4" />
      <path d="M5 21h8l4-4v-1" />
      <path d="M17 20v-4h-4" />
    </svg>
  ),
};

const themeIcon = {
  sun: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  moon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
};

const accents: Accent[] = ['purple', 'green', 'yellow', 'blue', 'orange', 'pink', 'teal', 'red'];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3 w-3 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}


const BG_EFFECTS: { key: BgEffect; labelKey: 'off' | 'boxes' | 'particles' | 'network' | 'bubbles' | 'comets' }[] = [
  { key: 'off', labelKey: 'off' },
  { key: 'boxes', labelKey: 'boxes' },
  { key: 'particles', labelKey: 'particles' },
  { key: 'network', labelKey: 'network' },
  { key: 'bubbles', labelKey: 'bubbles' },
  { key: 'comets', labelKey: 'comets' },
];
const BG_EFFECT_STORAGE_KEY = 'VoiTzu Tools-bg-effect';

const effectIcon: Record<BgEffect, ReactNode> = {
  off: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </svg>
  ),
  boxes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 4v10l-7 4-7-4V7z" />
      <path d="M5 7l7 4 7-4M12 11v10" />
    </svg>
  ),
  particles: (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="6" cy="7" r="1.6" />
      <circle cx="17" cy="6" r="1.3" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="18" cy="16" r="1.4" />
      <circle cx="6" cy="17" r="1.3" />
    </svg>
  ),
  network: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 7l5 5-5 5M12 12l5.5-5M12 12l5.5 5" />
      <circle cx="6" cy="6.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="18" cy="6.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="6" cy="17.5" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="18" cy="17.5" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  ),
  bubbles: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="16" r="3.2" />
      <circle cx="16" cy="10.5" r="2.2" />
      <circle cx="13.5" cy="5.5" r="1.3" />
    </svg>
  ),
  comets: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19L19 5" />
      <path d="M12 5h7v7" />
    </svg>
  ),
};


const accentSwatchClass: Record<Accent, string> = {
  purple: 'bg-gradient-to-br from-[#6366f1] to-[#a855f7]',
  green: 'bg-gradient-to-br from-[#10b981] to-[#84cc16]',
  yellow: 'bg-gradient-to-br from-[#eab308] to-[#f59e0b]',
  blue: 'bg-gradient-to-br from-[#3b82f6] to-[#06b6d4]',
  orange: 'bg-gradient-to-br from-[#f97316] to-[#f43f5e]',
  pink: 'bg-gradient-to-br from-[#ec4899] to-[#d946ef]',
  teal: 'bg-gradient-to-br from-[#14b8a6] to-[#0d9488]',
  red: 'bg-gradient-to-br from-[#ef4444] to-[#b91c1c]',
};

function Logo() {
  return (
    <Link href="/tools" className="flex items-center gap-2.5">
      <span className="h-[22px] w-[22px] shrink-0 rounded-[5px] bg-grad" aria-hidden="true" />
      <span className="bg-grad bg-clip-text font-display text-[15px] tracking-[0.03em] text-transparent">
        VoiTzu Tools
      </span>
    </Link>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { lang, setLang, t } = useLanguage();
  const { mode, accent, setMode, setAccent } = useTheme();
  const pathname = usePathname();
  const [bgEffect, setBgEffectState] = useState<BgEffect>('off');
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sidebarHoveredRef = useRef(false);
  const [breadcrumbOpen, setBreadcrumbOpen] = useState(false);
  const breadcrumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(BG_EFFECT_STORAGE_KEY) as BgEffect | null;
    if (saved) setBgEffectState(saved);
  }, []);

  useEffect(() => {
    setBreadcrumbOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!breadcrumbOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (breadcrumbRef.current && !breadcrumbRef.current.contains(e.target as Node)) {
        setBreadcrumbOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setBreadcrumbOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [breadcrumbOpen]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!sidebarHoveredRef.current) return;
      const el = sidebarScrollRef.current;
      if (!el) return;

      const step = 44;
      const page = el.clientHeight * 0.9;
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          el.scrollBy({ top: -step });
          break;
        case 'ArrowDown':
          e.preventDefault();
          el.scrollBy({ top: step });
          break;
        case 'PageUp':
          e.preventDefault();
          el.scrollBy({ top: -page });
          break;
        case 'PageDown':
        case ' ':
          e.preventDefault();
          el.scrollBy({ top: page });
          break;
        case 'Home':
          e.preventDefault();
          el.scrollTo({ top: 0, behavior: 'smooth' });
          break;
        case 'End':
          e.preventDefault();
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          break;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function setBgEffect(effect: BgEffect) {
    setBgEffectState(effect);
    localStorage.setItem(BG_EFFECT_STORAGE_KEY, effect);
  }

  const toolsBase: ToolLink[] = [
    { name: t.nav.imageConverter, desc: t.nav.imageConverterDesc, icon: icon.image, href: '/tools/image-converter' },
    { name: t.nav.imageToPdf, desc: t.nav.imageToPdfDesc, icon: icon.imageToPdf, href: '/tools/image-to-pdf' },
    { name: t.nav.htmlToPdf, desc: t.nav.htmlToPdfDesc, icon: icon.htmlToPdf, href: '/tools/html-to-pdf' },
    { name: t.nav.docxToHtml, desc: t.nav.docxToHtmlDesc, icon: icon.docxToHtml, href: '/tools/docx-to-html' },
    { name: t.nav.pdfCompressor, desc: t.nav.pdfCompressorDesc, icon: icon.pdf, href: '/tools/pdf-compressor' },
    { name: t.nav.pdfMergeSplit, desc: t.nav.pdfMergeSplitDesc, icon: icon.pdfMergeSplit, href: '/tools/pdf-merge-split' },
    { name: t.nav.qrGenerator, desc: t.nav.qrGeneratorDesc, icon: icon.qr, href: '/tools/qr-generator' },
    { name: t.nav.bgRemover, desc: t.nav.bgRemoverDesc, icon: icon.eraser, href: '/tools/background-remover' },
  ];
  const tools: ToolLink[] = toolsBase.map((tool) => ({ ...tool, active: !tool.soon && tool.href === pathname }));

  const infoPages = [
    { name: t.toolsPage.title, desc: t.toolsPage.subtitle, href: '/tools' },
    { name: t.footer.howItWorks, desc: t.search.pages.howItWorks, href: '/how-it-works' },
    { name: t.footer.privacy, desc: t.search.pages.privacy, href: '/privacy' },
    { name: t.footer.contact, desc: t.search.pages.contact, href: '/contact' },
  ];

  return (
    <div className="flex min-h-screen">
      <BackgroundFX effect={bgEffect} accent={accent} />
      <ScrollThumb accent={accent} topInset={72} bottomInset={8} thumbHeight={48} width={5} className="right-[3px]" />

      <div
        className={`fixed inset-0 z-[45] bg-black/60 transition-opacity duration-200 ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setOpen(false)}
      />

      <aside
        className={`fixed bottom-0 left-0 top-0 z-50 flex w-60 flex-col border-r border-line bg-surface px-3.5 py-5 shadow-[0_0_40px_rgba(0,0,0,0.4)] transition-transform duration-[250ms] ease-out lg:translate-x-0 lg:shadow-none ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between px-1.5 pb-5">
          <Logo />
          <button
            className="flex h-7 w-7 items-center justify-center border-none bg-transparent text-text-dim lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            ref={sidebarScrollRef}
            className="sidebar-scroll h-full overflow-y-auto pr-4"
            onMouseEnter={() => {
              sidebarHoveredRef.current = true;
            }}
            onMouseLeave={() => {
              sidebarHoveredRef.current = false;
            }}
          >
            <style jsx>{`
              .sidebar-scroll {
                scrollbar-width: none;
              }
              .sidebar-scroll::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            <Link
              href="/tools"
              className={`relative mb-3 flex items-center gap-2.5 rounded px-2.5 py-2.5 transition-colors duration-150 ${
                pathname === '/tools'
                  ? "bg-[color-mix(in_srgb,var(--indigo)_12%,transparent)] before:absolute before:-left-3.5 before:bottom-1.5 before:top-1.5 before:w-[3px] before:rounded-sm before:bg-grad before:content-['']"
                  : 'hover:bg-surface-2 active:bg-surface-2'
              }`}
            >
              <span
                className={`flex h-[17px] w-[17px] shrink-0 [&>svg]:h-full [&>svg]:w-full ${
                  pathname === '/tools' ? 'text-indigo' : 'text-text-dim'
                }`}
              >
                {icon.grid}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold text-text">{t.toolsPage.title}</span>
                <span className="truncate text-[10.5px] text-text-faint">{t.toolsPage.subtitle}</span>
              </span>
            </Link>

            <div className="mb-2 px-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
              {t.nav.toolsLabel}
            </div>
            <nav className="flex flex-col gap-1.5">
              {tools.map((tool) => (
                <Link
                  key={tool.name}
                  href={tool.href}
                  className={`relative flex items-center gap-2.5 rounded px-2.5 py-2.5 transition-colors duration-150 ${
                    tool.active
                      ? "bg-[color-mix(in_srgb,var(--indigo)_12%,transparent)] before:absolute before:-left-3.5 before:bottom-1.5 before:top-1.5 before:w-[3px] before:rounded-sm before:bg-grad before:content-['']"
                      : ''
                  } ${tool.soon ? 'cursor-not-allowed' : tool.active ? '' : 'hover:bg-surface-2 active:bg-surface-2'}`}
                  onClick={(e) => tool.soon && e.preventDefault()}
                  aria-disabled={tool.soon}
                >
                  <span
                    className={`flex h-[17px] w-[17px] shrink-0 [&>svg]:h-full [&>svg]:w-full ${
                      tool.active ? 'text-indigo' : tool.soon ? 'text-text-faint' : 'text-text-dim'
                    }`}
                  >
                    {tool.icon}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className={`truncate text-[13px] font-semibold ${tool.soon ? 'text-text-dim' : 'text-text'}`}>
                      {tool.name}
                    </span>
                    <span className="truncate text-[10.5px] text-text-faint">{tool.desc}</span>
                  </span>
                  {tool.soon && (
                    <span className="ml-auto shrink-0 rounded-full border border-line px-1.5 py-0.5 font-mono text-[8.5px] tracking-[0.06em] text-text-faint">
                      {t.nav.soon}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </div>
          <ScrollThumb accent={accent} target={sidebarScrollRef} thumbHeight={50} width={4} inset={4} showArrows arrowStep={100} className="right-0.5" />
        </div>

        <div className="shrink-0 border-t border-line pt-4">
          <div className="mb-3.5 border-b border-line px-1.5 pb-3.5">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
              {t.sidebar.effectsLabel}
            </div>
            <div className="grid grid-cols-3 gap-x-1.5 gap-y-0.5">
              {BG_EFFECTS.map((fx) => (
                <button
                  key={fx.key}
                  type="button"
                  onClick={() => setBgEffect(fx.key)}
                  className="flex flex-col items-center gap-0.5 bg-transparent"
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
                      bgEffect === fx.key
                        ? 'border-transparent bg-grad text-white'
                        : 'border-line bg-void text-text-dim'
                    }`}
                  >
                    <span className="[&>svg]:h-3 [&>svg]:w-3">{effectIcon[fx.key]}</span>
                  </span>
                  <span
                    className={`flex h-3.5 items-center justify-center text-center font-mono text-[7.5px] font-semibold leading-tight transition-colors duration-150 ${
                      bgEffect === fx.key ? 'text-indigo' : 'text-text-faint'
                    }`}
                  >
                    {t.sidebar.effects[fx.labelKey]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-3.5 border-b border-line px-1.5 pb-3.5">
            <div className="mb-2.5 flex gap-1 rounded-full border border-line bg-void p-[3px]">
              <button
                type="button"
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1.5 font-mono text-[8.5px] font-bold tracking-[0.02em] transition-all duration-150 ${
                  mode === 'dark' ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                }`}
                onClick={() => setMode('dark')}
              >
                <span className="[&>svg]:h-3 [&>svg]:w-3">{themeIcon.moon}</span>
                {t.theme.dark}
              </button>
              <button
                type="button"
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1.5 font-mono text-[8.5px] font-bold tracking-[0.02em] transition-all duration-150 ${
                  mode === 'light' ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                }`}
                onClick={() => setMode('light')}
              >
                <span className="[&>svg]:h-3 [&>svg]:w-3">{themeIcon.sun}</span>
                {t.theme.light}
              </button>
              <button
                type="button"
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1.5 font-mono text-[8.5px] font-bold tracking-[0.02em] transition-all duration-150 ${
                  mode === 'system' ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
                }`}
                onClick={() => setMode('system')}
              >
                <span className="[&>svg]:h-3 [&>svg]:w-3">{themeIcon.system}</span>
                {t.theme.system}
              </button>
            </div>
            <div className="grid grid-cols-4 justify-items-center gap-2 px-0.5">
              {accents.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`relative h-5 w-5 rounded-full p-0 transition-transform duration-150 hover:scale-[1.12] active:scale-95 ${accentSwatchClass[a]}`}
                  onClick={() => setAccent(a)}
                  aria-label={a}
                  title={a}
                >
                  {accent === a && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/30">
                      <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-[7px] px-1.5 font-mono text-[10px] text-text-faint">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_rgba(52,211,153,0.15)]" />
            {t.sidebar.storageStatus}
          </div>
        </div>
      </aside>

      <div className="ml-0 flex min-h-screen min-w-0 flex-1 flex-col lg:ml-60">
        <header className="app-header sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-line bg-[var(--topbar-bg)] px-7 py-4 backdrop-blur-md">
          <div className="flex min-w-0 items-center gap-3.5">
            <button
              className="flex h-8 w-8 items-center justify-center rounded border border-line bg-transparent text-text-dim lg:hidden"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
            <div className="relative hidden min-w-0 items-center gap-2 font-mono text-[11px] lg:flex" ref={breadcrumbRef}>
              {pathname === '/tools' ? (
                <button
                  type="button"
                  onClick={() => setBreadcrumbOpen((prev) => !prev)}
                  className="flex items-center gap-1 text-text-dim transition-colors duration-150 hover:text-text"
                >
                  {t.nav.toolsLabel}
                  <ChevronIcon open={breadcrumbOpen} />
                </button>
              ) : (
                <>
                  <span className="text-text-dim">{t.nav.toolsLabel}</span>
                  <span className="text-text-faint">/</span>
                  <button
                    type="button"
                    onClick={() => setBreadcrumbOpen((prev) => !prev)}
                    className="flex min-w-0 items-center gap-1 text-indigo transition-colors duration-150"
                  >
                    <span className="truncate font-semibold">
                      {tools.find((tool) => tool.active)?.name ?? infoPages.find((page) => page.href === pathname)?.name ?? t.nav.imageConverter}
                    </span>
                    <ChevronIcon open={breadcrumbOpen} />
                  </button>
                </>
              )}

              {breadcrumbOpen && (
                <div className="absolute left-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
                  <Link
                    href="/tools"
                    onClick={() => setBreadcrumbOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2 transition-colors duration-150 ${
                      pathname === '/tools' ? 'bg-[color-mix(in_srgb,var(--indigo)_12%,transparent)]' : 'hover:bg-surface-2'
                    }`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 [&>svg]:h-full [&>svg]:w-full ${pathname === '/tools' ? 'text-indigo' : 'text-text-dim'}`}>
                      {icon.grid}
                    </span>
                    <span className="truncate text-[12.5px] font-semibold text-text">{t.toolsPage.title}</span>
                  </Link>

                  <div className="my-1 border-t border-line" />

                  {tools.map((tool) => (
                    <Link
                      key={tool.name}
                      href={tool.href}
                      onClick={(e) => {
                        if (tool.soon) {
                          e.preventDefault();
                          return;
                        }
                        setBreadcrumbOpen(false);
                      }}
                      aria-disabled={tool.soon}
                      className={`flex items-center gap-2.5 px-3 py-2 transition-colors duration-150 ${
                        tool.soon
                          ? 'cursor-not-allowed opacity-50'
                          : tool.active
                          ? 'bg-[color-mix(in_srgb,var(--indigo)_12%,transparent)]'
                          : 'hover:bg-surface-2'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 [&>svg]:h-full [&>svg]:w-full ${
                          tool.active ? 'text-indigo' : tool.soon ? 'text-text-faint' : 'text-text-dim'
                        }`}
                      >
                        {tool.icon}
                      </span>
                      <span className="truncate text-[12.5px] font-semibold text-text">{tool.name}</span>
                      {tool.soon && (
                        <span className="ml-auto shrink-0 rounded-full border border-line px-1.5 py-0.5 font-mono text-[8px] tracking-[0.06em] text-text-faint">
                          {t.nav.soon}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end">
            <SearchCommand tools={tools} pages={infoPages} />
          </div>
          <div className="flex shrink-0 gap-0.5 rounded-full border border-line bg-void p-[3px]">
            <button
              type="button"
              className={`rounded-full px-3 py-[5px] font-mono text-[10.5px] font-bold tracking-[0.04em] transition-all duration-150 ${
                lang === 'id' ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
              }`}
              onClick={() => setLang('id')}
            >
              ID
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-[5px] font-mono text-[10.5px] font-bold tracking-[0.04em] transition-all duration-150 ${
                lang === 'en' ? 'bg-grad text-white' : 'text-text-dim hover:text-text active:text-text'
              }`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="mt-14 border-t border-line bg-surface px-5 pb-5 pt-8 sm:px-7 sm:pb-6 sm:pt-10">
          <div className="mx-auto grid max-w-[980px] grid-cols-1 gap-7 sm:grid-cols-[1.6fr_1fr_1fr] sm:gap-8">
            <div>
              <Logo />
              <p className="mt-3 max-w-[320px] text-[12.5px] leading-[1.6] text-text-faint">{t.footer.tagline}</p>
            </div>
            <div className="flex flex-col gap-[9px]">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-faint">
                {t.footer.toolsTitle}
              </div>
              <Link href="/tools/image-converter" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.nav.imageConverter}
              </Link>
              <Link href="/tools/image-to-pdf" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.nav.imageToPdf}
              </Link>
              <Link href="/tools/html-to-pdf" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.nav.htmlToPdf}
              </Link>
              <Link href="/tools/docx-to-html" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.nav.docxToHtml}
              </Link>
              <Link href="/tools/pdf-compressor" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.nav.pdfCompressor}
              </Link>
              <Link href="/tools/qr-generator" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.nav.qrGenerator}
              </Link>
            </div>
            <div className="flex flex-col gap-[9px]">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-faint">
                {t.footer.infoTitle}
              </div>
              <Link href="/how-it-works" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.footer.howItWorks}
              </Link>
              <Link href="/privacy" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.footer.privacy}
              </Link>
              <Link href="/contact" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.footer.contact}
              </Link>
            </div>
          </div>
          <div className="mx-auto mt-8 flex max-w-[980px] flex-wrap justify-between gap-2 border-t border-line pt-5 font-mono text-[11px] text-text-faint">
            <span>© {new Date().getFullYear()} VoiTzu Tools</span>
            <span>{t.footer.madeWith}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}