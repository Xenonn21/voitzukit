// app/layout.tsx
import type { Metadata } from 'next';
import { Audiowide, Space_Grotesk, Space_Mono } from 'next/font/google';
import AppShell from './components/AppShell';
import { LanguageProvider } from './lib/language-context';
import { ThemeProvider } from './lib/theme-context';
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
  title: 'PIXFORGE — Image Format Converter',
  description: 'Convert gambar ke WebP, PNG, atau JPG langsung di browser. Cepat, privat, dan gratis.',
};

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var mode = localStorage.getItem('pixforge-theme-mode') || 'dark';
    var accent = localStorage.getItem('pixforge-theme-accent') || 'purple';
    document.documentElement.setAttribute('data-theme', mode);
    document.documentElement.setAttribute('data-accent', accent);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="id"
      className={`${audiowide.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <LanguageProvider>
            <AppShell>{children}</AppShell>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}