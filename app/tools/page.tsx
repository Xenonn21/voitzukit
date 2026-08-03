// app/tools/page.tsx
'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useLanguage } from '../lib/language-context';

interface ToolLink {
  name: string;
  desc: string;
  icon: ReactNode;
  href: string;
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
  pdfMergeSplit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h8l4 4v6a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path d="M13 3v4h4" />
      <path d="M5 21h8l4-4v-1" />
      <path d="M17 20v-4h-4" />
    </svg>
  ),
};

export default function ToolsPage() {
  const { t } = useLanguage();

  const tools: ToolLink[] = [
    { name: t.nav.imageConverter, desc: t.nav.imageConverterDesc, icon: icon.image, href: '/tools/image-converter' },
    { name: t.nav.imageToPdf, desc: t.nav.imageToPdfDesc, icon: icon.imageToPdf, href: '/tools/image-to-pdf' },
    { name: t.nav.htmlToPdf, desc: t.nav.htmlToPdfDesc, icon: icon.htmlToPdf, href: '/tools/html-to-pdf' },
    { name: t.nav.docxToHtml, desc: t.nav.docxToHtmlDesc, icon: icon.docxToHtml, href: '/tools/docx-to-html' },
    { name: t.nav.pdfCompressor, desc: t.nav.pdfCompressorDesc, icon: icon.pdf, href: '/tools/pdf-compressor' },
    { name: t.nav.pdfMergeSplit, desc: t.nav.pdfMergeSplitDesc, icon: icon.pdfMergeSplit, href: '/tools/pdf-merge-split' },
    { name: t.nav.qrGenerator, desc: t.nav.qrGeneratorDesc, icon: icon.qr, href: '/tools/qr-generator' },
    { name: t.nav.bgRemover, desc: t.nav.bgRemoverDesc, icon: icon.eraser, href: '/tools/background-remover' },
  ];

  return (
    <div className="mx-auto max-w-[980px] px-5 py-10 sm:px-7 sm:py-14">
      <div className="mb-8 sm:mb-10">
        <h1 className="font-display text-[26px] tracking-[0.01em] text-text sm:text-[32px]">{t.toolsPage.title}</h1>
        <p className="mt-2 max-w-[520px] text-[13.5px] leading-[1.6] text-text-dim">{t.toolsPage.subtitle}</p>
      </div>

      <div className="grid grid-cols-2 items-stretch gap-3.5 lg:grid-cols-3">
        {tools.map((tool) =>
          tool.soon ? (
            <div
              key={tool.name}
              className="relative flex h-full cursor-not-allowed flex-col gap-3 rounded-xl border border-line bg-surface p-5 opacity-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-text-dim [&>svg]:h-5 [&>svg]:w-5">
                {tool.icon}
              </span>
              <div>
                <p className="line-clamp-2 text-[14px] font-semibold text-text">{tool.name}</p>
                <p className="mt-0.5 line-clamp-2 text-[12px] text-text-faint">{tool.desc}</p>
              </div>
              <span className="absolute right-4 top-4 rounded-full border border-line px-2 py-0.5 font-mono text-[9px] tracking-[0.06em] text-text-faint">
                {t.nav.soon}
              </span>
            </div>
          ) : (
            <Link
              key={tool.name}
              href={tool.href}
              className="group flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-5 transition-colors duration-150 hover:border-indigo"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-grad text-white [&>svg]:h-5 [&>svg]:w-5">
                {tool.icon}
              </span>
              <div>
                <p className="line-clamp-2 text-[14px] font-semibold text-text transition-colors duration-150 group-hover:text-indigo">
                  {tool.name}
                </p>
                <p className="mt-0.5 line-clamp-2 text-[12px] text-text-faint">{tool.desc}</p>
              </div>
            </Link>
          )
        )}
      </div>
    </div>
  );
}