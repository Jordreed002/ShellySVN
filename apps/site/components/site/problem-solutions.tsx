const rows = [
  {
    problem: 'Huge SVN repos',
    solution:
      'Keep working copies small with <strong>sparse checkout</strong> — pick the paths you need, expand later.',
  },
  {
    problem: 'Unclear repo state',
    solution:
      '<strong>See what changed</strong> before updating or committing — diffs, history, and remote browsing in one app.',
  },
  {
    problem: 'Command-line friction',
    solution:
      '<strong>Browse, diff, update, revert, and package visually.</strong> The everyday verbs sit one click away.',
  },
  {
    problem: 'Legacy SVN workflows',
    solution:
      'Built around <strong>SVN-native concepts</strong> — working copies, updates, locks, externals — not a Git-shaped wrapper.',
  },
];

export function ProblemSolutions() {
  return (
    <div className="section-frame rounded-3xl px-6 py-4 sm:px-10 sm:py-6">
      {rows.map((row) => (
        <div key={row.problem} className="ps-row">
          <div className="ps-problem">{row.problem}</div>
          <p className="ps-solution" dangerouslySetInnerHTML={{ __html: row.solution }} />
        </div>
      ))}
    </div>
  );
}
