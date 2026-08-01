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

const MODE_KEY = 'pixforge-theme-mode';
const ACCENT_KEY = 'pixforge-theme-accent';

function systemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// 'system' is a stored preference, never a value written to the DOM — the
// DOM only ever gets 'dark' or 'light', resolved from the OS setting here.
function applyResolvedTheme(m: ThemeMode) {
  const resolved = m === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : m;
  document.documentElement.setAttribute('data-theme', resolved);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [accent, setAccentState] = useState<Accent>('purple');

  useEffect(() => {
    const savedMode = (localStorage.getItem(MODE_KEY) as ThemeMode | null) ?? 'dark';
    const savedAccent = (localStorage.getItem(ACCENT_KEY) as Accent | null) ?? 'purple';
    setModeState(savedMode);
    setAccentState(savedAccent);
    applyResolvedTheme(savedMode);
  }, []);

  // While the user is on 'system', keep the applied theme in sync if they
  // flip their OS-level dark/light setting without touching PIXFORGE at all.
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
    applyResolvedTheme(m);
  }

  function setAccent(a: Accent) {
    setAccentState(a);
    localStorage.setItem(ACCENT_KEY, a);
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