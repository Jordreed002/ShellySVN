const annotations = [
  {
    title: 'Multi-repository sidebar',
    body: 'All your working copies in one place. Quick access for the folders you actually open, plus a search field that scales when the list grows.',
  },
  {
    title: 'Bundled Subversion',
    body: 'Ships with Subversion 1.14. No system install, no manual toolchain, no waiting on IT to roll out client packages.',
  },
  {
    title: 'Everyday verbs, one click away',
    body: 'Update, commit, revert, diff — surfaced as the persistent action bar so you stop digging through menus for the operations you run dozens of times a day.',
  },
];

export function ProductPanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="section-frame relative overflow-hidden rounded-3xl p-3 sm:p-4">
        <div className="app-shot">
          <img
            src="/screenshots/shellysvn-app.png"
            alt="ShellySVN home view showing repositories, quick access, and working copy actions"
            width={2936}
            height={1936}
            loading="lazy"
          />
        </div>
      </div>
      <div className="grid content-between gap-3">
        {annotations.map((annotation, idx) => (
          <article
            key={annotation.title}
            className="section-frame tile reveal flex h-full flex-col rounded-2xl p-5"
            style={{ animationDelay: `${120 + idx * 100}ms` }}
          >
            <div className="flex items-center gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-full border border-[var(--accent-ring)] bg-[var(--accent-soft)] text-[0.78rem] font-medium text-[var(--accent-bright)]">
                {idx + 1}
              </span>
              <h3 className="text-[1.15rem] leading-tight text-[var(--foreground-strong)]">
                {annotation.title}
              </h3>
            </div>
            <p className="mt-3 text-[0.875rem] leading-7 text-[var(--muted-foreground)]">
              {annotation.body}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
