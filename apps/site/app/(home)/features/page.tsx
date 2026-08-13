import Link from 'next/link';
import { AppWindow } from '@/components/site/app-window';
import { Band } from '@/components/site/band';
import { FeatureGrid } from '@/components/site/feature-grid';
import { Icon } from '@/components/site/icons';
import { PageHero } from '@/components/site/page-hero';
import { WorkflowRail } from '@/components/site/workflow-rail';

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title={
          <>
            Everything in the preview, and <em>what state it is in</em>.
          </>
        }
        summary={
          <>
            Capabilities mapped to the Subversion commands they stand for and labelled with what
            they actually do today. <strong>Anything preview-only or gated is listed here</strong>{' '}
            rather than left off.
          </>
        }
      >
        <Link className="btn btn-primary btn-lg" href="/download">
          <Icon name="dl" />
          Download for free
        </Link>
        <Link className="btn btn-secondary btn-lg" href="/docs">
          <Icon name="book" />
          Read the docs
        </Link>
      </PageHero>

      <Band tight>
        <FeatureGrid />
      </Band>

      <Band alt n="01">
        <div className="section-head">
          <p className="kicker">The interface</p>
          <h2 className="display">
            One window, and every pane <em>says where its numbers came from</em>.
          </h2>
          <p className="lede">
            Rendered below as live markup from the application&rsquo;s own design tokens, so it
            cannot drift from the product.
          </p>
        </div>
        <div style={{ marginTop: '2rem' }}>
          <AppWindow />
          <p className="plate-caption">
            <span>
              <b>Not a screenshot.</b> Built from the app&rsquo;s own tokens.
            </span>
            <span>macOS · Windows · Linux — identical</span>
          </p>
        </div>
      </Band>

      <Band n="02">
        <div className="section-head">
          <p className="kicker">Same app, three machines</p>
          <h2 className="display">
            The only differences are <em>the title bar and ⌘ versus Ctrl</em>.
          </h2>
          <p className="lede">
            One codebase, three builds. A platform cannot quietly fall behind, because there is
            nothing platform-specific to fall behind with.
          </p>
        </div>
        <div className="trust-grid" style={{ marginTop: '2rem' }}>
          <div className="trust-item">
            <Icon name="apple" />
            <div>
              <b>macOS 14+</b>
              <small>.dmg · .zip · Apple silicon &amp; Intel</small>
            </div>
          </div>
          <div className="trust-item">
            <Icon name="windows" />
            <div>
              <b>Windows 10 &amp; 11</b>
              <small>.exe · x64 · per-user install</small>
            </div>
          </div>
          <div className="trust-item">
            <Icon name="linux" />
            <div>
              <b>Linux x64</b>
              <small>AppImage · deb · rpm · tar.gz</small>
            </div>
          </div>
          <div className="trust-item">
            <Icon name="repo" />
            <div>
              <b>Any SVN server</b>
              <small>1.6 and newer · hooks untouched</small>
            </div>
          </div>
        </div>
      </Band>

      <Band alt n="03">
        <div className="section-head" style={{ marginBottom: '2rem' }}>
          <p className="kicker">Three moves</p>
          <h2 className="display">
            <em>Lean</em> in. <em>Read</em> first. <em>Ship</em> packaged.
          </h2>
        </div>
        <WorkflowRail />
      </Band>

      <Band n="04">
        <div className="cta">
          <p className="eyebrow green" style={{ margin: '0 auto' }}>
            Free download · no account
          </p>
          <h2 className="display">
            Try the preview.
            <br />
            <em>Tell us what breaks.</em>
          </h2>
          <p>
            Preview builds ship today for macOS, Windows and Linux, with Subversion 1.14 inside.
            Issues filed on GitHub flow straight into the roadmap.
          </p>
          <div className="actions">
            <Link className="btn btn-primary btn-lg" href="/download">
              <Icon name="dl" />
              Download for macOS
            </Link>
            <Link className="btn btn-secondary btn-lg" href="/download">
              All platforms
            </Link>
          </div>
        </div>
      </Band>
    </>
  );
}
