const items = [
  { label: 'macOS', value: 'Available', tone: 'ready' as const },
  { label: 'Windows', value: 'Planned', tone: 'planned' as const },
  { label: 'Linux', value: 'Planned', tone: 'planned' as const },
  { label: 'Open source', value: 'Yes', tone: 'ready' as const },
  { label: 'Requires SVN install', value: 'No — bundled', tone: 'ready' as const },
  { label: 'Telemetry', value: 'None', tone: 'ready' as const },
];

export function StatusGrid() {
  return (
    <div className="section-frame rounded-2xl px-6 py-5 sm:px-8 sm:py-6">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <p className="kicker">Preview status</p>
        <p className="text-[0.82rem] text-[var(--muted-foreground)]">
          Honest about what works and what does not.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((item) => (
          <li key={item.label} className="space-y-1">
            <p className="kicker text-[var(--dim)]">{item.label}</p>
            <p className={`text-[0.95rem] font-medium ${item.tone === 'ready' ? 'text-[var(--teal)]' : 'text-[var(--muted-foreground)]'}`}>
              <span
                className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${item.tone === 'ready' ? 'bg-[var(--teal)] shadow-[0_0_8px_currentColor]' : 'bg-[var(--dim)]'}`}
                aria-hidden
              />
              {item.value}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
