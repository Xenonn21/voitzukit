// app/layout.tsx
import type { Metadata, Viewport } from 'next';
import { Audiowide, Space_Grotesk, Space_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import AppShell from './components/AppShell';
import type { BgEffect } from './components/BackgroundFX';
import { LanguageProvider, type Lang } from './lib/language-context';
import { ThemeProvider, type ThemeMode, type Accent } from './lib/theme-context';
import InstallPrompt from './components/InstallPrompt';
import PullToRefresh from './components/PullToRefresh';
import './globals.css';

const audiowide = Audiowide({
  subsets: ['latin'],
  weight: '400',
  variable: '--next-audiowide',
});
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--next-space-grotesk',
});
const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--next-space-mono',
});

export const metadata: Metadata = {
  title: 'VoiTzu Tools — Image Format Converter',
  description: 'Convert gambar ke WebP, PNG, atau JPG langsung di browser. Cepat, privat, dan gratis.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#7c5cfc',
};

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var mode = localStorage.getItem('VoiTzu Tools-theme-mode') || 'dark';
    var accent = localStorage.getItem('VoiTzu Tools-theme-accent') || 'purple';
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.setAttribute('data-accent', accent);
  } catch (e) {}
})();
`;

const VALID_BG_EFFECTS: BgEffect[] = ['off', 'boxes', 'particles', 'network', 'bubbles', 'comets'];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const savedLang = cookieStore.get('voitzu-lang')?.value;
  const initialLang: Lang = savedLang === 'en' ? 'en' : 'id';

  const savedBgEffect = cookieStore.get('voitzu-bg-effect')?.value as BgEffect | undefined;
  const initialBgEffect: BgEffect = VALID_BG_EFFECTS.includes(savedBgEffect as BgEffect)
    ? (savedBgEffect as BgEffect)
    : 'off';

  const VALID_MODES: ThemeMode[] = ['dark', 'light', 'system'];
  const VALID_ACCENTS: Accent[] = ['purple', 'green', 'yellow', 'blue', 'orange', 'pink', 'teal', 'red'];

  const savedMode = cookieStore.get('voitzu-theme-mode')?.value as ThemeMode | undefined;
  const initialMode: ThemeMode = VALID_MODES.includes(savedMode as ThemeMode) ? (savedMode as ThemeMode) : 'dark';

  const savedAccent = cookieStore.get('voitzu-theme-accent')?.value as Accent | undefined;
  const initialAccent: Accent = VALID_ACCENTS.includes(savedAccent as Accent) ? (savedAccent as Accent) : 'purple';

  return (
    <html
      lang={initialLang}
      className={`${audiowide.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider initialMode={initialMode} initialAccent={initialAccent}>
          <LanguageProvider initialLang={initialLang}>
            <PullToRefresh>
              <AppShell initialBgEffect={initialBgEffect}>{children}</AppShell>
            </PullToRefresh>
            <InstallPrompt />
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}