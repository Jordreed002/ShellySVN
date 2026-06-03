import { Bricolage_Grotesque, Geist_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import type { Metadata } from 'next';
import { Provider } from '@/components/provider';
import { appName, siteDescription, siteUrl } from '@/lib/shared';
import './global.css';

const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
});

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700', '800'],
  display: 'swap',
});

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
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
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
