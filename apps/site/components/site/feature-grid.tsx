import { featureEntries } from '@/lib/features';

const statusClass: Record<'available' | 'preview' | 'planned', string> = {
  available: 'available',
  preview: 'preview',
  planned: 'planned',
};

export function FeatureGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {featureEntries.map((feature, idx) => (
        <article
          key={feature.slug}
          className="section-frame tile reveal flex flex-col rounded-2xl p-6"
          style={{ animationDelay: `${80 + idx * 80}ms` }}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <h3 className="text-2xl leading-tight text-[var(--foreground-strong)]">
              {feature.title}
            </h3>
            <span className={`tag ${statusClass[feature.status]}`}>
              <span className="dot" />
              {feature.status}
            </span>
          </div>
          <p className="flex-1 text-sm leading-7 text-[var(--muted-foreground)]">
            {feature.summary}
          </p>
          <p className="mt-6 border-t border-[var(--border)] pt-4 text-[0.78rem] text-[var(--dim)]">
            Built for {feature.audience}
          </p>
        </article>
      ))}
    </div>
  );
}
