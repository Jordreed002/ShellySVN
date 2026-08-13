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
    <div className="rail">
      {steps.map((step, index) => (
        <div
          key={step.title}
          className="section-frame tile rail-card reveal"
          style={{ animationDelay: `${120 + index * 100}ms` }}
        >
          <div className="head">
            <span className="n">{String(index + 1).padStart(2, '0')}</span>
            <span className="kicker">
              Step {index + 1} of {steps.length}
            </span>
          </div>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </div>
      ))}
    </div>
  );
}
