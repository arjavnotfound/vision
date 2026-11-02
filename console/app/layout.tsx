import { Doto, Geist, Geist_Mono } from 'next/font/google';
import { AppearanceRoot } from '@/components/vision/appearance-root';
import { cn } from '@/lib/shadcn/utils';
import '@/styles/globals.css';

const geist = Geist({ variable: '--font-geist', subsets: ['latin'], display: 'swap' });
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});
// Dot-matrix display face: ONLY for the state word and the clock.
const doto = Doto({
  variable: '--font-doto',
  subsets: ['latin'],
  display: 'swap',
  weight: 'variable',
  axes: ['ROND'],
  fallback: ['ui-monospace', 'monospace'],
});

// Runs before paint: theme from saved settings, transparent background in Electron.
const BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem('vision.settings.v1')||'{}');if(s.theme==='paper')document.documentElement.dataset.theme='paper';}catch(e){}if(window.electronAPI)document.documentElement.classList.add('is-electron');`;

export const metadata = {
  title: 'VISION',
  description: 'Hands-free voice assistant for your computer.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="ember"
      suppressHydrationWarning
      className={cn(geist.variable, geistMono.variable, doto.variable, 'antialiased')}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        <AppearanceRoot>{children}</AppearanceRoot>
      </body>
    </html>
  );
}
