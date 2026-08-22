import { featureEntries } from '@/lib/features';

const statusClass: Record<'available' | 'preview' | 'planned', string> = {
  available: 'available',
  preview: 'preview',
  planned: 'planned',
};

export function FeatureGrid() {
  return (
    <div className="features">
      {featureEntries.map((feature, idx) => (
        <article
          key={feature.slug}
          className="section-frame tile feature-card reveal"
          style={{ animationDelay: `${80 + idx * 80}ms` }}
        >
          <div className="head">
            <h3>{feature.title}</h3>
            <span className={`tag ${statusClass[feature.status]}`}>
              <span className="dot" />
              {feature.status}
            </span>
          </div>
          <p>{feature.summary}</p>
          <p className="aud">Built for {feature.audience}</p>
        </article>
      ))}
    </div>
  );
}
