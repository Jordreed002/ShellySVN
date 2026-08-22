import Link from 'next/link';
import { Band } from '@/components/site/band';
import { Icon } from '@/components/site/icons';
import { PageHero } from '@/components/site/page-hero';
import { roadmap, roadmapRisks, type RoadmapStatus } from '@/lib/roadmap';

const tagFor: Record<RoadmapStatus, string> = {
  shipped: 'available',
  beta: 'preview',
  planned: 'planned',
  exploratory: 'planned',
};

export default function RoadmapPage() {
  return (
    <>
      <PageHero
        eyebrow="Roadmap"
        title={
          <>
            Stable at 1.0. Now we <em>harden, scale and grow</em>.
          </>
        }
        summary={
          <>
            Every release below carries a theme and a single exit gate — the one thing that has to
            be true before it ships.{' '}
            <strong>Dates after 1.1 are intentions, not commitments</strong>, and the gates are the
            part that does not move.
          </>
        }
      >
        <Link className="btn btn-primary btn-lg" href="/download">
          <Icon name="dl" />
          Get the 1.1 preview
        </Link>
        <Link className="btn btn-secondary btn-lg" href="/changelog">
          Changelog
        </Link>
      </PageHero>

      <Band tight>
        <div className="trust-grid">
          <div className="trust-item">
            <Icon name="check" />
            <div>
              <b>Shipped</b>
              <small>0.2.0 sparse checkout · 1.0.0 first stable</small>
            </div>
          </div>
          <div className="trust-item">
            <Icon name="flag" style={{ color: 'var(--ember)' }} />
            <div>
              <b>In flight</b>
              <small>1.1.0 update infrastructure · 2026 Q3</small>
            </div>
          </div>
          <div className="trust-item">
            <Icon name="repo" style={{ color: 'var(--accent)' }} />
            <div>
              <b>Planned</b>
              <small>1.2 → 1.5 · through H2 2027</small>
            </div>
          </div>
          <div className="trust-item">
            <Icon name="branch" style={{ color: 'var(--dim)' }} />
            <div>
              <b>Exploratory</b>
              <small>2.0.0 · 2028 and beyond</small>
            </div>
          </div>
        </div>
      </Band>

      <Band alt n="01">
        <div className="section-head" style={{ marginBottom: '1rem' }}>
          <p className="kicker">Goals and milestones, by version</p>
          <h2 className="display">
            The release <em>arc</em>.
          </h2>
        </div>
        {roadmap.map((entry) => (
          <div
            key={entry.version}
            className={`rm-row${entry.status === 'shipped' ? ' shipped' : ''}${entry.status === 'beta' ? ' now' : ''}`}
          >
            <div>
              <p className="v">{entry.version}</p>
              <p className="when">{entry.target}</p>
              <p className="st">
                <span className={`tag ${tagFor[entry.status]}`}>
                  <span className="dot" />
                  {entry.status}
                </span>
              </p>
            </div>
            <div>
              <h3>{entry.theme}</h3>
              <p>{entry.body}</p>
              <p className="gate">
                <Icon name="flag" />
                <span>Exit gate · {entry.gate}</span>
              </p>
            </div>
          </div>
        ))}
      </Band>

      <Band n="02">
        <div className="section-head">
          <p className="kicker">What the version number promises</p>
          <h2 className="display">
            Cadence, and <em>what could derail it</em>.
          </h2>
        </div>
        <div className="features" style={{ marginTop: '2rem' }}>
          <article className="section-frame tile feature-card">
            <div className="head">
              <h3>Minor versions carry themes</h3>
            </div>
            <p>
              Each <code>1.x</code> line has one theme and one exit gate. Features that do not serve
              the theme wait, rather than being squeezed in to fill a date.
            </p>
            <p className="aud">Cadence</p>
          </article>
          <article className="section-frame tile feature-card">
            <div className="head">
              <h3>Patches never add surface</h3>
            </div>
            <p>
              A <code>1.1.x</code> release fixes defects and nothing else. If it needs a new setting
              or a new pane, it is not a patch.
            </p>
            <p className="aud">Cadence</p>
          </article>
          {roadmapRisks.map((risk) => (
            <article className="section-frame tile feature-card" key={risk.title}>
              <div className="head">
                <h3>{risk.title}</h3>
                <span className={`tag ${risk.kind === 'blocker' ? 'planned' : 'preview'}`}>
                  <span className="dot" />
                  {risk.kind}
                </span>
              </div>
              <p>{risk.body}</p>
              <p className="aud">{risk.kind === 'blocker' ? 'Blocker' : 'Risk'}</p>
            </article>
          ))}
          <article className="section-frame tile feature-card">
            <div className="head">
              <h3>Parity is a checklist, not a claim</h3>
            </div>
            <p>
              1.5 is measured against a published TortoiseSVN feature list. Until every line is
              green, this site says &ldquo;alongside&rdquo; rather than &ldquo;instead of&rdquo;.
            </p>
            <p className="aud">Scope</p>
          </article>
        </div>
      </Band>
    </>
  );
}
