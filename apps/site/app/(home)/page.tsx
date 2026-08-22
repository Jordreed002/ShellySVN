import Link from 'next/link';
import { AppWindow } from '@/components/site/app-window';
import { Band } from '@/components/site/band';
import { FeatureGrid } from '@/components/site/feature-grid';
import { GradientCards } from '@/components/site/gradient-cards';
import { Icon } from '@/components/site/icons';
import { PreviewBanner } from '@/components/site/preview-banner';
import { ProductPanel } from '@/components/site/product-panel';
import { WorkflowRail } from '@/components/site/workflow-rail';
import { projectFacts } from '@/lib/shared';

export default function HomePage() {
  return (
    <>
      {/* ── HERO ──────────────────────────────────────────────────── */}
      <section className="band hero-band hero">
        <div className="aurora" aria-hidden />
        <div className="dot-grid hidden md:block" aria-hidden />
        <div className="wrap">
          <div className="hero-inner reveal reveal-1">
            <p className="eyebrow green">Free · open source · preview 1.1.0-beta.2</p>
            <h1 className="display">
              Subversion,
              <br />
              without the <em>struggle</em>.
            </h1>
            <p className="deck">
              A <strong>free, open-source</strong> desktop Subversion client for teams that still
              need SVN — and it runs <strong>the same on macOS, Windows and Linux</strong>.
              Subversion 1.14 ships inside the download, so there is nothing to install first.
            </p>
            <div className="actions">
              <Link className="btn btn-primary btn-lg" href="/download">
                <Icon name="dl" />
                Download for free
              </Link>
              <Link className="btn btn-secondary btn-lg" href="/docs">
                <Icon name="book" />
                Read the docs
              </Link>
            </div>
            <div className="facts">
              <span>
                <Icon name="check" />
                No account
              </span>
              <span>
                <Icon name="check" />
                No licence key
              </span>
              <span>
                <Icon name="eye-off" />
                No telemetry
              </span>
              <span>
                <Icon name="check" />
                Works with any SVN server
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── THE PRODUCT, AS MARKUP ────────────────────────────────── */}
      <Band tight>
        <AppWindow />
        <p className="plate-caption">
          <span>
            <b>Not a screenshot.</b> The interface above is rendered as markup from the app&rsquo;s
            own design tokens, so it cannot go stale against the product.
          </span>
          <span>macOS · Windows · Linux — identical</span>
        </p>
        <PreviewBanner />
      </Band>

      {/* ── TRUST STRIP ───────────────────────────────────────────── */}
      <Band alt tight n="01">
        <p className="kicker" style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
          Free, open, and built on what already works
        </p>
        <div className="trust-grid">
          <div className="trust-item">
            <Icon name="code" />
            <div>
              <b>Open source</b>
              <small>full source on GitHub · build it yourself</small>
            </div>
          </div>
          <div className="trust-item">
            <Icon name="check" />
            <div>
              <b>Free, with no tiers</b>
              <small>no account, no licence key, no seats</small>
            </div>
          </div>
          <div className="trust-item">
            <Icon name="disk" />
            <div>
              <b>Subversion 1.14 bundled</b>
              <small>no external install on any platform</small>
            </div>
          </div>
          <div className="trust-item">
            <Icon name="repo" />
            <div>
              <b>Same app on all three</b>
              <small>macOS · Windows · Linux, one codebase</small>
            </div>
          </div>
        </div>
      </Band>

      {/* ── QUESTION CARDS ────────────────────────────────────────── */}
      <Band n="02">
        <div className="section-head">
          <p className="kicker">Answers, faster</p>
          <h2 className="display">
            ShellySVN answers the questions you <em>actually ask</em> about your repo.
          </h2>
          <p className="lede">The first two are the ones the old site never answered at all.</p>
        </div>
        <div style={{ marginTop: '2rem' }}>
          <GradientCards />
        </div>
      </Band>

      {/* ── EDITORIAL SPLIT ───────────────────────────────────────── */}
      <Band alt n="03">
        <div className="split">
          <div>
            <p className="kicker">SVN-native, on purpose</p>
            <h2
              className="display"
              style={{ fontSize: 'clamp(1.85rem,3.6vw,2.8rem)', marginTop: '0.9rem' }}
            >
              Not a Git client with
              <br />
              <em>SVN bolted on.</em>
            </h2>
            <p className="lede" style={{ maxWidth: '44ch' }}>
              ShellySVN is built around the way SVN teams actually work — central repositories,
              working copies, updates, locks, externals, sparse checkouts and packaged deployments.
            </p>
          </div>
          <ul className="claims">
            {[
              'Understands SVN working copies directly',
              'Respects update-before-commit workflows',
              'Sparse-checkout patterns as a first-class surface',
              'Exposes branches, tags and externals as they really are',
              'Handles peg revisions, locks and properties — not a Git facade',
              'Packaged binaries, no manual SVN install required',
            ].map((claim) => (
              <li className="exhibit" key={claim}>
                <Icon name="check" />
                <span>{claim}</span>
              </li>
            ))}
          </ul>
        </div>
      </Band>

      {/* ── PRODUCT PANEL ─────────────────────────────────────────── */}
      <Band n="04">
        <div className="section-split" style={{ marginBottom: '2rem' }}>
          <div className="section-head">
            <p className="kicker">The home view</p>
            <h2 className="display">
              Where is my repo, and <em>what do I do</em> with it?
            </h2>
          </div>
          <p className="aside">
            Quick access to recent repositories, drag-to-open working copies, and a unified action
            bar for the everyday verbs — update, commit, revert, diff.
          </p>
        </div>
        <ProductPanel />
      </Band>

      {/* ── FEATURE GRID ──────────────────────────────────────────── */}
      <Band alt n="05" id="features">
        <div className="section-split" style={{ marginBottom: '2rem' }}>
          <div className="section-head">
            <p className="kicker">What ships today</p>
            <h2 className="display">
              What is <em>actually</em> in the preview?
            </h2>
          </div>
          <p className="aside">
            Working copies, sparse checkout, history, diffs, repository browsing and packaged
            release binaries — explicit about what ships, what is preview-only and what remains
            gated.
          </p>
        </div>
        <FeatureGrid />
      </Band>

      {/* ── WORKFLOW RAIL ─────────────────────────────────────────── */}
      <Band n="06">
        <div className="section-head" style={{ marginBottom: '2rem' }}>
          <p className="kicker">Three moves</p>
          <h2 className="display">
            <em>Lean</em> in. <em>Read</em> first. <em>Ship</em> packaged.
          </h2>
        </div>
        <WorkflowRail />
      </Band>

      {/* ── FACTS — replaces the fabricated testimonial ───────────── */}
      <Band alt n="07">
        <div className="facts-grid">
          <div>
            <p className="kicker">Instead of a testimonial</p>
            <p className="facts-lede" style={{ marginTop: '0.8rem' }}>
              The old site quoted an <em>anonymous evaluator</em>. Here are numbers you can check
              instead.
            </p>
            <p className="facts-note">
              Every figure is verifiable from the repository — the test suite, the packaging config
              and the bundled toolchain version.
            </p>
          </div>
          <div className="facts-list">
            <div className="section-frame fact">
              <b className="g">{projectFacts.unitTests}</b>
              <small>unit tests passing</small>
            </div>
            <div className="section-frame fact">
              <b>{projectFacts.e2eJourneys}</b>
              <small>end-to-end journeys</small>
            </div>
            <div className="section-frame fact">
              <b className="a">1.14.3</b>
              <small>Subversion, bundled</small>
            </div>
            <div className="section-frame fact">
              <b>{projectFacts.platforms}</b>
              <small>platforms, one codebase</small>
            </div>
            <div className="section-frame fact">
              <b className="g">{projectFacts.prerequisites}</b>
              <small>external prerequisites</small>
            </div>
            <div className="section-frame fact">
              <b className="g">{projectFacts.trackers}</b>
              <small>analytics or trackers</small>
            </div>
          </div>
        </div>
      </Band>

      {/* ── DOWNLOAD CTA ──────────────────────────────────────────── */}
      <Band n="08" id="download">
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
          <div className="plats">
            <span>
              <Icon name="apple" />
              .dmg · arm64 &amp; x64
            </span>
            <span>
              <Icon name="windows" />
              .exe · x64
            </span>
            <span>
              <Icon name="linux" />
              AppImage · deb · rpm
            </span>
          </div>
        </div>
      </Band>
    </>
  );
}
