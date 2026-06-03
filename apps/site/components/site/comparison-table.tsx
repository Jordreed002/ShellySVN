type Cell = { text: string; tone?: 'yes' | 'mid' | 'no' };
type Row = { label: string; cli: Cell; legacy: Cell; shelly: Cell };

const rows: Row[] = [
  {
    label: 'Sparse checkout visibility',
    cli: { text: 'Manual', tone: 'no' },
    legacy: { text: 'Mixed', tone: 'mid' },
    shelly: { text: 'First-class', tone: 'yes' },
  },
  {
    label: 'Repo browsing',
    cli: { text: 'Manual', tone: 'no' },
    legacy: { text: 'Yes', tone: 'mid' },
    shelly: { text: 'Built in', tone: 'yes' },
  },
  {
    label: 'Preview changes before update',
    cli: { text: 'Manual', tone: 'no' },
    legacy: { text: 'Limited', tone: 'mid' },
    shelly: { text: 'Built in', tone: 'yes' },
  },
  {
    label: 'Bundled Subversion runtime',
    cli: { text: 'No', tone: 'no' },
    legacy: { text: 'Rarely', tone: 'no' },
    shelly: { text: 'Yes — no install', tone: 'yes' },
  },
  {
    label: 'Packaged release artifacts',
    cli: { text: 'No', tone: 'no' },
    legacy: { text: 'No', tone: 'no' },
    shelly: { text: 'Yes', tone: 'yes' },
  },
  {
    label: 'Modern desktop UI',
    cli: { text: 'No', tone: 'no' },
    legacy: { text: 'Mixed', tone: 'mid' },
    shelly: { text: 'Native dark UI', tone: 'yes' },
  },
  {
    label: 'Open source & auditable',
    cli: { text: 'Yes', tone: 'yes' },
    legacy: { text: 'Mixed', tone: 'mid' },
    shelly: { text: 'Yes', tone: 'yes' },
  },
];

function toneClass(tone?: Cell['tone']) {
  if (tone === 'yes') return 'compare-yes';
  if (tone === 'mid') return 'compare-mid';
  return 'compare-no';
}

export function ComparisonTable() {
  return (
    <div className="section-frame overflow-hidden rounded-2xl">
      <div className="overflow-x-auto">
        <table className="compare">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Command-line SVN</th>
              <th>Legacy GUI client</th>
              <th>ShellySVN</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>
                  <span className={toneClass(row.cli.tone)}>{row.cli.text}</span>
                </td>
                <td>
                  <span className={toneClass(row.legacy.tone)}>{row.legacy.text}</span>
                </td>
                <td>
                  <span className={toneClass(row.shelly.tone)}>{row.shelly.text}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
