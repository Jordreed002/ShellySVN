const annotations = [
  { label: 'Multi-repository workspace', x: '8%', y: '14%' },
  { label: 'Repo browser · history · diff', x: '8%', y: '40%' },
  { label: 'Drag-to-open working copies', x: '52%', y: '32%' },
  { label: 'Everyday verbs, one click', x: '52%', y: '70%' },
  { label: 'Bundled Subversion 1.14', x: '8%', y: '88%' },
];

export function AnnotatedScreenshot() {
  return (
    <div className="reveal reveal-6 app-shot-glow relative">
      <div className="app-shot relative">
        <img
          src="/screenshots/shellysvn-app.png"
          alt="ShellySVN desktop application — repositories sidebar, working copy actions, and bundled Subversion client"
          width={2936}
          height={1936}
          loading="eager"
        />
        <div className="pointer-events-none absolute inset-0 hidden md:block">
          {annotations.map((annotation, idx) => (
            <span
              key={annotation.label}
              className="annotation"
              style={{
                left: annotation.x,
                top: annotation.y,
                opacity: 0,
                animation: `float-in 0.6s ease forwards`,
                animationDelay: `${600 + idx * 150}ms`,
                ['--float-opacity' as never]: 1,
              }}
            >
              <span className="annotation-dot" aria-hidden />
              {annotation.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
