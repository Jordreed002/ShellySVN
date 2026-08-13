import Link from 'next/link';
import { Band } from '@/components/site/band';
import { Icon } from '@/components/site/icons';
import { PageHero } from '@/components/site/page-hero';
import { faqItems } from '@/lib/faq';
import { gitConfig } from '@/lib/shared';

export default function FaqPage() {
  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title={
          <>
            Twelve questions, <em>answered straight</em>.
          </>
        }
        summary={
          <>
            Including the three where the answer is not the one we would prefer to give: the
            licence, the signing and the untested top end.{' '}
            <strong>Those are questions 2, 3 and 9.</strong>
          </>
        }
      />

      <Band tight>
        <div className="faq-list">
          {faqItems.map((item, i) => (
            <details className="section-frame tile faq" key={item.question} open={i < 2}>
              <summary>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                {item.question}
              </summary>
              <div className="a">
                <p>{item.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </Band>

      <Band alt>
        <div className="cta">
          <p className="eyebrow green" style={{ margin: '0 auto' }}>
            Still unanswered?
          </p>
          <h2 className="display">
            Ask it on <em>GitHub</em>.
          </h2>
          <p>
            Issues and discussions are the whole support surface. There is no ticket system behind
            this, which is a genuine trade-off rather than a feature.
          </p>
          <div className="actions">
            <Link
              className="btn btn-primary btn-lg"
              href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/issues`}
            >
              <Icon name="ext" />
              Open an issue
            </Link>
            <Link className="btn btn-secondary btn-lg" href="/docs">
              <Icon name="book" />
              Read the docs
            </Link>
          </div>
        </div>
      </Band>
    </>
  );
}
