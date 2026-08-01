// app/how-it-works/page.tsx
'use client';

import { useLanguage } from '../lib/language-context';

export default function HowItWorksPage() {
  const { t } = useLanguage();

  return (
    <div className="mx-auto max-w-[860px] px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-10">
      <div className="mb-10">
        <div className="mb-3.5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.25em] text-text-dim before:h-1.5 before:w-1.5 before:rounded-[1px] before:bg-grad before:content-['']">
          {t.howItWorks.eyebrow}
        </div>
        <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
          {t.howItWorks.title}
        </h1>
        <p className="max-w-[560px] text-[14.5px] leading-[1.6] text-text-dim">{t.howItWorks.intro}</p>
      </div>

      <div className="flex flex-col">
        {t.howItWorks.steps.map((step, i) => {
          const isLast = i === t.howItWorks.steps.length - 1;
          return (
            <div key={step.heading} className="relative flex gap-5 pb-9 pl-0 last:pb-0">
              <div className="relative flex shrink-0 flex-col items-center">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-grad font-mono text-[13px] font-bold text-white">
                  {i + 1}
                </span>
                {!isLast && <span className="mt-1.5 w-px flex-1 bg-line" />}
              </div>
              <div className="min-w-0 pb-1 pt-1.5">
                <div className="mb-1.5 text-[15px] font-semibold text-text">{step.heading}</div>
                <p className="max-w-[560px] text-[13.5px] leading-[1.7] text-text-dim">{step.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-surface px-5 py-4">
        <p className="text-[13px] text-text-dim">{t.howItWorks.note}</p>
        <a
          href="/privacy"
          className="shrink-0 font-mono text-[11.5px] font-bold uppercase tracking-[0.06em] text-indigo transition-opacity duration-150 hover:opacity-80"
        >
          {t.howItWorks.noteLink} →
        </a>
      </div>

      <div className="mt-6">
        <a
          href="/"
          className="inline-flex items-center gap-2 font-mono text-[12px] text-text-dim transition-colors duration-150 hover:text-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {t.howItWorks.backLabel}
        </a>
      </div>
    </div>
  );
}