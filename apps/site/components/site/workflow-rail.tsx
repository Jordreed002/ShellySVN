const steps = [
  {
    title: 'Pick only the paths you need.',
    body: 'Sparse checkout is a first-class workflow, not an afterthought. Start lean, expand deliberately, and keep large repositories workable on laptops.',
  },
  {
    title: 'Read before you mutate.',
    body: 'Remote browsing, history inspection, and diff surfaces reduce the number of blind SVN operations you need to run against large working copies.',
  },
  {
    title: 'Ship packaged binaries.',
    body: 'Preview releases bundle the client toolchain so teammates are not blocked on manual SVN installs or mismatched system packages.',
  },
];

export function WorkflowRail() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {steps.map((step, index) => (
        <div
          key={step.title}
          className="section-frame tile reveal flex flex-col rounded-2xl p-6"
          style={{ animationDelay: `${120 + index * 100}ms` }}
        >
          <div className="mb-5 flex items-center gap-3">
            <span className="display text-[2.5rem] leading-none text-[var(--accent-bright)]">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="kicker">Step {index + 1} of {steps.length}</span>
          </div>
          <h3 className="text-2xl leading-tight">{step.title}</h3>
          <p className="mt-3 flex-1 text-sm leading-7 text-[var(--muted-foreground)]">
            {step.body}
          </p>
        </div>
      ))}
    </div>
  );
}
