export function FounderNote() {
  return (
    <div className="section-frame relative overflow-hidden rounded-3xl px-6 py-12 sm:px-12 sm:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{
          background:
            'radial-gradient(50% 80% at 20% 30%, rgba(124,124,245,0.18), transparent 60%), radial-gradient(40% 60% at 90% 80%, rgba(94,234,212,0.12), transparent 60%)',
        }}
      />
      <p className="kicker mb-5">Why this exists</p>
      <h2 className="display max-w-3xl text-3xl sm:text-4xl lg:text-5xl">
        Built for the SVN repos that <em>actually</em> ship products.
      </h2>
      <div className="mt-8 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <p className="text-[1.05rem] leading-8 text-[var(--muted-foreground)]">
          ShellySVN was built out of daily frustration with large production SVN repositories,
          sparse-checkout workflows, and legacy desktop clients that haven&apos;t been seriously
          updated in years. Git-first tools either ignore SVN entirely or paper over it with
          metaphors that break the second you hit an external or a peg revision. This is the desktop
          SVN client built by someone who still ships from Subversion every week — and wants it to
          stay that way.
        </p>
        <div className="space-y-3 self-start text-[0.92rem] leading-7 text-[var(--muted-foreground)]">
          <p>
            <span className="text-[var(--foreground-strong)]">No telemetry.</span> No analytics, no
            beacons, no remote logging. Your repos stay your business.
          </p>
          <p>
            <span className="text-[var(--foreground-strong)]">Open source.</span> The full source is
            on GitHub. Audit anything before you install it.
          </p>
          <p>
            <span className="text-[var(--foreground-strong)]">Built in the open.</span> Issues,
            releases, and roadmap all live on GitHub.
          </p>
        </div>
      </div>
    </div>
  );
}
