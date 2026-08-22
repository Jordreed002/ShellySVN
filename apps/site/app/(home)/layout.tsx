import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site/site-footer';
import { SiteHeader } from '@/components/site/site-header';
import { ReleaseStrip } from '@/components/site/release-strip';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="site-shell">
      <ReleaseStrip />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
