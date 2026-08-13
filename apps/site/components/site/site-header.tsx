'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from './icons';
import { gitConfig, marketingLinks } from '@/lib/shared';

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="masthead">
      <div className="wrap masthead-inner">
        <Link className="brand" href="/">
          <Icon name="shell" />
          <b>
            Shelly<em>SVN</em>
          </b>
          <span className="lic">Free &amp; open source</span>
        </Link>

        <nav>
          {marketingLinks.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="masthead-cta">
          <Link
            className="btn btn-ghost hidden sm:inline-flex"
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
          >
            <Icon name="ext" />
            GitHub
          </Link>
          <Link className="btn btn-primary" href="/download">
            <Icon name="dl" />
            Download
          </Link>
        </div>
      </div>
    </header>
  );
}
