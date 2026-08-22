import Link from 'next/link';
import { Icon } from './icons';
import { appTagline, footerLinks, gitConfig, licenceResolved } from '@/lib/shared';

export function SiteFooter() {
  return (
    <footer className="wrap site-footer">
      <div>
        <Link className="brand" href="/">
          <Icon name="shell" />
          <b>
            Shelly<em>SVN</em>
          </b>
        </Link>
        <p className="note">{appTagline}</p>
        {!licenceResolved ? (
          <p className="note" style={{ color: 'var(--faint)' }}>
            Source is public; a <code>LICENSE</code> file has not landed yet.
          </p>
        ) : null}
      </div>

      <div>
        <h4>Product</h4>
        <ul>
          {footerLinks.product.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4>Learn</h4>
        <ul>
          {footerLinks.learn.map((item) => (
            <li key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4>Project</h4>
        <ul>
          <li>
            <Link href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}>GitHub</Link>
          </li>
          <li>
            <Link href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/issues`}>
              Issues
            </Link>
          </li>
          <li>
            <Link href="/changelog">Changelog</Link>
          </li>
          <li>
            <Link href="/privacy">Privacy</Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
