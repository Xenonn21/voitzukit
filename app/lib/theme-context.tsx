// app/lib/theme-context.tsx
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system';
export type Accent = 'purple' | 'green' | 'yellow' | 'blue' | 'orange' | 'pink' | 'teal' | 'red';

interface ThemeContextValue {
  mode: ThemeMode;
  accent: Accent;
  setMode: (m: ThemeMode) => void;
  setAccent: (a: Accent) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MODE_KEY = 'VoiTzu Tools-theme-mode';
const ACCENT_KEY = 'VoiTzu Tools-theme-accent';
const MODE_COOKIE_KEY = 'voitzu-theme-mode'; // nama cookie gak boleh pakai spasi
const ACCENT_COOKIE_KEY = 'voitzu-theme-accent';

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// 'system' is a stored preference, never a value written to the DOM — the
// DOM only ever gets 'dark' or 'light', resolved from the OS setting here.
function applyResolvedTheme(m: ThemeMode) {
  const resolved = m === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : m;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function ThemeProvider({
  children,
  initialMode = 'dark',
  initialAccent = 'purple',
}: {
  children: ReactNode;
  initialMode?: ThemeMode;
  initialAccent?: Accent;
}) {
  // initialMode/initialAccent datang dari cookie yang dibaca server
  // (layout.tsx), jadi render pertama sudah langsung pakai nilai yang benar
  // — tidak nunggu localStorage kebaca di client (itu yang bikin checkmark
  // di theme switcher sempat "mental" ke default sebelum ganti ke aktif).
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [accent, setAccentState] = useState<Accent>(initialAccent);

  // Migrasi satu-kali: kalau user udah pernah set preferensi sebelum fix ini
  // di-deploy (kesimpen di localStorage, belum ada cookie), sinkronin ke
  // cookie sekarang biar reload berikutnya udah bener dari server.
  useEffect(() => {
    try {
      const storedMode = localStorage.getItem(MODE_KEY) as ThemeMode | null;
      const storedAccent = localStorage.getItem(ACCENT_KEY) as Accent | null;
      if (storedMode && storedMode !== mode) setMode(storedMode);
      if (storedAccent && storedAccent !== accent) setAccent(storedAccent);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the user is on 'system', keep the applied theme in sync if they
  // flip their OS-level dark/light setting without touching VoiTzu Tools at all.
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange() {
      applyResolvedTheme('system');
    }
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  function setMode(m: ThemeMode) {
    setModeState(m);
    localStorage.setItem(MODE_KEY, m);
    document.cookie = `${MODE_COOKIE_KEY}=${m}; path=/; max-age=31536000; SameSite=Lax; Secure`;
    applyResolvedTheme(m);
  }

  function setAccent(a: Accent) {
    setAccentState(a);
    localStorage.setItem(ACCENT_KEY, a);
    document.cookie = `${ACCENT_COOKIE_KEY}=${a}; path=/; max-age=31536000; SameSite=Lax; Secure`;
    document.documentElement.setAttribute('data-accent', a);
  }

  return (
    <ThemeContext.Provider value={{ mode, accent, setMode, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}