// app/privacy/page.tsx
'use client';

import { useLanguage } from '../lib/language-context';

export default function PrivacyPage() {
  const { t } = useLanguage();

  return (
    <div className="mx-auto max-w-[860px] px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-10">
      <div className="mb-8">
        <div className="mb-3.5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.25em] text-text-dim before:h-1.5 before:w-1.5 before:rounded-[1px] before:bg-grad before:content-['']">
          {t.privacy.eyebrow}
        </div>
        <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
          {t.privacy.title}
        </h1>
        <p className="max-w-[560px] text-[14.5px] leading-[1.6] text-text-dim">{t.privacy.intro}</p>
        <p className="mt-2 font-mono text-[11.5px] text-text-faint">{t.privacy.updated}</p>
      </div>

      <div className="rounded border border-line bg-surface">
        {t.privacy.sections.map((section, i) => (
          <div
            key={section.heading}
            className={`p-[22px] ${i !== t.privacy.sections.length - 1 ? 'border-b border-line' : ''}`}
          >
            <div className="mb-2.5 flex items-center gap-2.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] bg-grad font-mono text-[10px] font-bold text-white">
                {i + 1}
              </span>
              {section.heading}
            </div>
            <p className="text-[13.5px] leading-[1.7] text-text-dim">{section.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <a
          href="/"
          className="inline-flex items-center gap-2 font-mono text-[12px] text-text-dim transition-colors duration-150 hover:text-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {t.privacy.backLabel}
        </a>
      </div>
    </div>
  );
}