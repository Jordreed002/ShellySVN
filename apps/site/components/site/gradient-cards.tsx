const cards = [
  {
    variant: 'gc-indigo',
    eyebrow: 'Sparse checkout',
    title: 'How do I keep this giant repo small?',
    body: 'Pull only the paths you need. Expand path-by-path. No more multi-gig checkouts on a laptop.',
  },
  {
    variant: 'gc-teal',
    eyebrow: 'Repository browsing',
    title: 'What will change if I update?',
    body: 'Preview incoming changes, diffs, and revision history before touching your working copy.',
  },
  {
    variant: 'gc-violet',
    eyebrow: 'Diff & history',
    title: 'What actually changed since last week?',
    body: 'Move between commit history, unified diffs, and blame views without leaving the app.',
  },
  {
    variant: 'gc-ember',
    eyebrow: 'Bundled binaries',
    title: 'Do my teammates need SVN installed?',
    body: 'No. Bundled Subversion 1.14 ships inside the app — zero manual installs.',
  },
];

export function GradientCards() {
  return (
    <div className="gradient-cards">
      {cards.map((card, idx) => (
        <article
          key={card.title}
          className={`gradient-card ${card.variant} reveal`}
          style={{ animationDelay: `${100 + idx * 100}ms` }}
        >
          <div className="gc-body">
            <span className="gc-eyebrow">{card.eyebrow}</span>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
