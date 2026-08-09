const claims = [
  'Understands SVN working copies directly',
  'Respects update-before-commit workflows',
  'Sparse-checkout patterns as a first-class surface',
  'Exposes branches, tags, and externals as they really are',
  'Handles peg revisions, locks, and properties — not a Git facade',
  'Packaged binaries, no manual SVN install required',
];

export function BuildTools() {
  return (
    <div className="relative grid gap-10 lg:grid-cols-[1fr_1.2fr]">
      <div className="relative space-y-5">
        <p className="kicker">SVN-native, on purpose</p>
        <h2 className="display text-4xl sm:text-5xl lg:text-[3.4rem]">
          Not a Git client with
          <br />
          <em>SVN bolted on.</em>
        </h2>
        <p className="text-[1.05rem] leading-8 text-[var(--muted-foreground)]">
          ShellySVN is built around the way SVN teams actually work — central repositories, working
          copies, updates, locks, externals, sparse checkouts, and packaged deployments. The whole
          UI respects that model instead of fighting it.
        </p>
      </div>

      <ul className="grid gap-3 self-start">
        {claims.map((claim, idx) => (
          <li
            key={claim}
            className="exhibit reveal flex items-center gap-3 text-[0.98rem] text-[var(--foreground)]"
            style={{ animationDelay: `${120 + idx * 70}ms` }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              aria-hidden
              className="shrink-0"
            >
              <circle
                cx="9"
                cy="9"
                r="8"
                stroke="rgba(124, 124, 245, 0.45)"
                strokeWidth="1"
                fill="rgba(124, 124, 245, 0.12)"
              />
              <path
                d="M5.5 9.5l2.5 2.5L13 7"
                stroke="var(--accent-bright)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>{claim}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
