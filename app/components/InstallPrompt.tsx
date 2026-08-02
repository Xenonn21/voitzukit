'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../lib/language-context';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
  const { t } = useLanguage();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Skip kalau app udah jalan dalam mode standalone (sudah di-install)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;

    if (isStandalone) return;

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);

      // Auto-hide popup setelah 3 detik
      const timer = setTimeout(() => setVisible(false), 3000);
      return () => clearTimeout(timer);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  }

  if (!visible || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border border-white/10 bg-black/80 px-4 py-3 shadow-lg backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] bg-grad">
        <svg viewBox="0 0 120 120" className="h-[15px] w-[15px]" fill="none">
          <path d="M20 30 L60 88 L100 30 L82 30 L60 62 L38 30 Z" fill="#fff" />
          <circle cx="60" cy="90" r="7" fill="#fff" />
        </svg>
      </span>
      <div className="flex flex-col">
        <span className="text-[13px] font-medium text-white">{t.installPrompt.title}</span>
        <span className="text-[11px] text-white/50">{t.installPrompt.subtitle}</span>
      </div>
      <button
        onClick={handleInstall}
        className="ml-2 rounded-lg bg-grad px-3 py-1.5 text-[12px] font-medium text-white"
      >
        {t.installPrompt.install}
      </button>
    </div>
  );
}