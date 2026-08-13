import { Archivo, JetBrains_Mono } from 'next/font/google';
import type { Metadata } from 'next';
import { Provider } from '@/components/provider';
import { IconSprite } from '@/components/site/icons';
import { appName, siteDescription, siteUrl } from '@/lib/shared';
import './global.css';

// Archivo and JetBrains Mono are the desktop app's own typefaces. The site
// previously used Bricolage Grotesque + Plus Jakarta Sans, which matched
// nothing in the product.
const body = Archivo({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

const display = Archivo({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
  description: siteDescription,
  metadataBase: new URL(siteUrl),
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`dark ${body.variable} ${display.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <IconSprite />
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
