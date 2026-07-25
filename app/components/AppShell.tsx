// app/components/AppShell.tsx
'use client';

import { useState, type ReactNode } from 'react';
import { useLanguage } from '../lib/language-context';
import { useTheme, type Accent } from '../lib/theme-context';

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
  video: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="5.5" width="14" height="13" rx="2" />
      <path d="M21.5 8.5l-5 3.5 5 3.5z" />
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
};

const accents: Accent[] = ['purple', 'green', 'yellow', 'blue', 'orange'];

// Fixed swatch colors for the accent picker — these represent the option,
// so they stay static regardless of which accent is currently active.
const accentSwatchClass: Record<Accent, string> = {
  purple: 'bg-gradient-to-br from-[#6366f1] to-[#a855f7]',
  green: 'bg-gradient-to-br from-[#10b981] to-[#84cc16]',
  yellow: 'bg-gradient-to-br from-[#eab308] to-[#f59e0b]',
  blue: 'bg-gradient-to-br from-[#3b82f6] to-[#06b6d4]',
  orange: 'bg-gradient-to-br from-[#f97316] to-[#f43f5e]',
};

function Logo() {
  return (
    <a href="/" className="flex items-center gap-2.5">
      <span className="h-[22px] w-[22px] shrink-0 rounded-[5px] bg-grad" aria-hidden="true" />
      <span className="bg-grad bg-clip-text font-display text-[15px] tracking-[0.03em] text-transparent">
        PIXFORGE
      </span>
    </a>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { lang, setLang, t } = useLanguage();
  const { mode, accent, setMode, setAccent } = useTheme();

  const tools: ToolLink[] = [
    { name: t.nav.imageConverter, desc: t.nav.imageConverterDesc, icon: icon.image, href: '/', active: true },
    { name: t.nav.videoCompressor, desc: t.nav.videoCompressorDesc, icon: icon.video, href: '#', soon: true },
    { name: t.nav.pdfCompressor, desc: t.nav.pdfCompressorDesc, icon: icon.pdf, href: '#', soon: true },
    { name: t.nav.qrGenerator, desc: t.nav.qrGeneratorDesc, icon: icon.qr, href: '#', soon: true },
    { name: t.nav.bgRemover, desc: t.nav.bgRemoverDesc, icon: icon.eraser, href: '#', soon: true },
  ];

  return (
    <div className="flex min-h-screen">
      <div
        className={`fixed inset-0 z-[45] bg-black/60 transition-opacity duration-200 ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setOpen(false)}
      />

      <aside
        className={`fixed bottom-0 left-0 top-0 z-50 flex w-60 flex-col overflow-y-auto border-r border-line bg-surface px-3.5 py-5 shadow-[0_0_40px_rgba(0,0,0,0.4)] transition-transform duration-[250ms] ease-out lg:translate-x-0 lg:shadow-none ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-1.5 pb-5">
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

        <div className="mb-2 px-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
          {t.nav.toolsLabel}
        </div>
        <nav className="flex flex-col gap-0.5">
          {tools.map((tool) => (
            <a
              key={tool.name}
              href={tool.href}
              className={`relative flex items-center gap-2.5 rounded px-2.5 py-2.5 transition-colors duration-150 ${
                tool.active
                  ? "bg-[rgba(99,102,241,0.12)] before:absolute before:-left-3.5 before:bottom-1.5 before:top-1.5 before:w-[3px] before:rounded-sm before:bg-grad before:content-['']"
                  : ''
              } ${tool.soon ? 'cursor-not-allowed' : 'hover:bg-surface-2'}`}
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
            </a>
          ))}
        </nav>

        <div className="mt-auto border-t border-line pt-4">
          <div className="mb-3.5 border-b border-line px-1.5 pb-3.5">
            <div className="mb-2.5 flex gap-1 rounded-full border border-line bg-void p-[3px]">
              <button
                type="button"
                className={`flex flex-1 items-center justify-center gap-[5px] rounded-full px-2.5 py-1.5 font-mono text-[10.5px] font-bold tracking-[0.04em] transition-all duration-150 ${
                  mode === 'dark' ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                }`}
                onClick={() => setMode('dark')}
              >
                <span className="[&>svg]:h-3 [&>svg]:w-3">{themeIcon.moon}</span> {t.theme.dark}
              </button>
              <button
                type="button"
                className={`flex flex-1 items-center justify-center gap-[5px] rounded-full px-2.5 py-1.5 font-mono text-[10.5px] font-bold tracking-[0.04em] transition-all duration-150 ${
                  mode === 'light' ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
                }`}
                onClick={() => setMode('light')}
              >
                <span className="[&>svg]:h-3 [&>svg]:w-3">{themeIcon.sun}</span> {t.theme.light}
              </button>
            </div>
            <div className="flex gap-2 px-0.5">
              {accents.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`h-5 w-5 rounded-full border-2 p-0 transition-transform duration-150 hover:scale-[1.12] ${accentSwatchClass[a]} ${
                    accent === a ? 'border-text' : 'border-transparent'
                  }`}
                  onClick={() => setAccent(a)}
                  aria-label={a}
                  title={a}
                />
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
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-line bg-[var(--topbar-bg)] px-7 py-4 backdrop-blur-md">
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
          </div>
          <div className="flex gap-0.5 rounded-full border border-line bg-void p-[3px]">
            <button
              type="button"
              className={`rounded-full px-3 py-[5px] font-mono text-[10.5px] font-bold tracking-[0.04em] transition-all duration-150 ${
                lang === 'id' ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
              }`}
              onClick={() => setLang('id')}
            >
              ID
            </button>
            <button
              type="button"
              className={`rounded-full px-3 py-[5px] font-mono text-[10.5px] font-bold tracking-[0.04em] transition-all duration-150 ${
                lang === 'en' ? 'bg-grad text-white' : 'text-text-dim hover:text-text'
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
              <a href="/" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.nav.imageConverter}
              </a>
              <span className="text-[13px] text-text-faint">
                {t.nav.videoCompressor} · {t.footer.soon}
              </span>
              <span className="text-[13px] text-text-faint">
                {t.nav.pdfCompressor} · {t.footer.soon}
              </span>
              <span className="text-[13px] text-text-faint">
                {t.nav.qrGenerator} · {t.footer.soon}
              </span>
            </div>
            <div className="flex flex-col gap-[9px]">
              <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-faint">
                {t.footer.infoTitle}
              </div>
              <a href="#" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.footer.howItWorks}
              </a>
              <a href="#" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.footer.privacy}
              </a>
              <a href="#" className="text-[13px] text-text-dim transition-colors duration-150 hover:text-text">
                {t.footer.contact}
              </a>
            </div>
          </div>
          <div className="mx-auto mt-8 flex max-w-[980px] flex-wrap justify-between gap-2 border-t border-line pt-5 font-mono text-[11px] text-text-faint">
            <span>© {new Date().getFullYear()} PIXFORGE</span>
            <span>{t.footer.madeWith}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}