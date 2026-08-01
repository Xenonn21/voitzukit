// app/contact/page.tsx
'use client';

import { useState, type FormEvent } from 'react';
import { useLanguage } from '../lib/language-context';

const inputClasses =
  'w-full rounded border border-line bg-void px-3.5 py-2.5 text-[13.5px] text-text placeholder:text-text-faint outline-none transition-colors duration-150 focus:border-indigo';

export default function ContactPage() {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState(t.contact.form.subjectOptions[0]);
  const [message, setMessage] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = `${message}\n\n—\n${name}${email ? ` (${email})` : ''}`;
    const mailto = `mailto:${t.contact.email}?subject=${encodeURIComponent(
      `[PIXFORGE] ${subject}`
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  }

  return (
    <div className="mx-auto max-w-[860px] px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-10">
      <div className="mb-8">
        <div className="mb-3.5 flex items-center gap-2.5 font-mono text-[11px] tracking-[0.25em] text-text-dim before:h-1.5 before:w-1.5 before:rounded-[1px] before:bg-grad before:content-['']">
          {t.contact.eyebrow}
        </div>
        <h1 className="mb-2.5 font-display text-[clamp(24px,4vw,34px)] leading-[1.2] tracking-[0.01em] text-text">
          {t.contact.title}
        </h1>
        <p className="max-w-[560px] text-[14.5px] leading-[1.6] text-text-dim">{t.contact.intro}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <form onSubmit={handleSubmit} className="rounded border border-line bg-surface">
          <div className="grid grid-cols-1 gap-4 border-b border-line p-[22px] sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.contact.form.nameLabel}
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.contact.form.namePlaceholder}
                className={inputClasses}
              />
            </div>
            <div>
              <label className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
                {t.contact.form.emailLabel}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.contact.form.emailPlaceholder}
                className={inputClasses}
              />
            </div>
          </div>

          <div className="border-b border-line p-[22px]">
            <label className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              {t.contact.form.subjectLabel}
            </label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={`${inputClasses} appearance-none`}
            >
              {t.contact.form.subjectOptions.map((opt) => (
                <option key={opt} value={opt} className="bg-surface text-text">
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="border-b border-line p-[22px]">
            <label className="mb-1.5 block font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              {t.contact.form.messageLabel}
            </label>
            <textarea
              required
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t.contact.form.messagePlaceholder}
              className={`${inputClasses} resize-none`}
            />
          </div>

          <div className="p-[22px]">
            <button
              type="submit"
              className="w-full rounded-[3px] bg-grad py-[15px] font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-white transition-opacity duration-150 hover:opacity-90"
            >
              {t.contact.form.submit}
            </button>
            <p className="mt-3 font-mono text-[11px] leading-[1.5] text-text-faint">{t.contact.form.note}</p>
          </div>
        </form>

        <div className="flex flex-col gap-4">
          <div className="rounded border border-line bg-surface p-[22px]">
            <div className="mb-2.5 font-mono text-[10.5px] uppercase tracking-[0.18em] text-text-faint">
              {t.contact.infoCardsTitle}
            </div>
            <a
              href={`mailto:${t.contact.email}`}
              className="text-[14px] font-semibold text-indigo transition-colors duration-150 hover:opacity-80"
            >
              {t.contact.email}
            </a>
            <p className="mt-1.5 text-[12.5px] leading-[1.5] text-text-faint">{t.contact.emailNote}</p>
          </div>

          <div className="rounded border border-line bg-surface p-[22px]">
            <div className="mb-2 text-[13px] font-semibold text-text">{t.contact.responseTitle}</div>
            <p className="text-[12.5px] leading-[1.6] text-text-dim">{t.contact.responseBody}</p>
          </div>

          <div className="rounded border border-line bg-surface p-[22px]">
            <div className="mb-2 text-[13px] font-semibold text-text">{t.contact.bugTitle}</div>
            <p className="text-[12.5px] leading-[1.6] text-text-dim">{t.contact.bugBody}</p>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <a
          href="/"
          className="inline-flex items-center gap-2 font-mono text-[12px] text-text-dim transition-colors duration-150 hover:text-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {t.contact.backLabel}
        </a>
      </div>
    </div>
  );
}