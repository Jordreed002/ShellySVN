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
    <div className="product">
      {/* The home view, rendered as markup from the app's own tokens rather
          than as a screenshot — same reason as <AppWindow />. */}
      <div aria-hidden>
        <div className="section-frame" style={{ borderRadius: '18px', padding: '12px' }}>
          <div className="app-shot">
            <div className="aw-top" style={{ height: '38px' }}>
              <span className="brand" style={{ gap: '6px' }}>
                <svg style={{ width: '17px', height: '17px' }}>
                  <use href="#i-shell" />
                </svg>
                <b style={{ fontSize: '12.5px' }}>
                  Shelly<em>SVN</em>
                </b>
              </span>
              <div className="aw-tr">
                <span className="aw-av" style={{ width: '23px', height: '23px', fontSize: '10px' }}>
                  J
                </span>
              </div>
            </div>
            <div className="aw-body two" style={{ height: '326px' }}>
              <aside className="aw-rail">
                <div className="aw-rsec">
                  <span className="k">Working copies</span>
                  <svg>
                    <use href="#i-plus" />
                  </svg>
                </div>
                <div className="aw-ritem tall on">
                  <span className="aw-dot mod"></span>
                  <span className="n">
                    ~/wc/acme-website<small>website/trunk · r4821</small>
                  </span>
                  <span className="c mod">12</span>
                </div>
                <div className="aw-ritem tall">
                  <span className="aw-dot full"></span>
                  <span className="n">
                    ~/wc/shelly-svn<small>tooling/trunk · r4838</small>
                  </span>
                </div>
                <div className="aw-ritem tall">
                  <span className="aw-dot part"></span>
                  <span className="n">
                    ~/wc/brand-system<small>depth immediates</small>
                  </span>
                  <span className="c mod">3</span>
                </div>
                <div className="aw-rsec">
                  <span className="k">Recent</span>
                </div>
                <div className="aw-ritem">
                  <svg>
                    <use href="#i-folder" />
                  </svg>
                  <span className="n">globex/intranet</span>
                </div>
                <div className="aw-ritem">
                  <svg>
                    <use href="#i-folder" />
                  </svg>
                  <span className="n">initech</span>
                </div>
                <div className="aw-disk">
                  <b>18.4 GB on disk</b>
                  <div className="bar">
                    <i style={{ width: '56%', background: 'var(--green)' }}></i>
                    <i style={{ flex: '1', background: 'var(--hairline)' }}></i>
                  </div>
                  <span className="m">drag a folder here to open it</span>
                </div>
              </aside>
              <section className="aw-cont">
                <div className="aw-nav" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="aw-btn">
                    <svg>
                      <use href="#i-refresh" />
                    </svg>
                    Update
                  </span>
                  <span className="aw-btn">
                    <svg>
                      <use href="#i-check" />
                    </svg>
                    Commit
                  </span>
                  <span className="aw-btn">
                    <svg>
                      <use href="#i-up" />
                    </svg>
                    Revert
                  </span>
                  <span className="aw-btn">
                    <svg>
                      <use href="#i-file" />
                    </svg>
                    Diff
                  </span>
                </div>
                <div
                  className="aw-chead"
                  style={{ gridTemplateColumns: '16px minmax(80px,1fr) 44px 72px' }}
                >
                  <span></span>
                  <span>Name</span>
                  <span className="r">Rev</span>
                  <span className="r">Status</span>
                </div>
                <div
                  className="aw-crow dir"
                  style={{ gridTemplateColumns: '16px minmax(80px,1fr) 44px 72px' }}
                >
                  <svg className="aw-ci">
                    <use href="#i-folder" />
                  </svg>
                  <div className="aw-cn">
                    <b>src</b>
                  </div>
                  <span className="aw-num r">4838</span>
                  <span className="aw-st">
                    <span className="flag M">M</span>
                  </span>
                </div>
                <div
                  className="aw-crow"
                  style={{ gridTemplateColumns: '16px minmax(80px,1fr) 44px 72px' }}
                >
                  <svg className="aw-ci">
                    <use href="#i-file" />
                  </svg>
                  <div className="aw-cn">
                    <b>package.json</b>
                  </div>
                  <span className="aw-num r">4821</span>
                  <span className="aw-st">
                    <span className="flag M">M</span>
                  </span>
                </div>
                <div
                  className="aw-crow"
                  style={{ gridTemplateColumns: '16px minmax(80px,1fr) 44px 72px' }}
                >
                  <svg className="aw-ci">
                    <use href="#i-file" />
                  </svg>
                  <div className="aw-cn">
                    <b>types.ts</b>
                  </div>
                  <span className="aw-num r">—</span>
                  <span className="aw-st">
                    <span className="flag A">A</span>
                  </span>
                </div>
                <div
                  className="aw-crow"
                  style={{ gridTemplateColumns: '16px minmax(80px,1fr) 44px 72px' }}
                >
                  <svg className="aw-ci">
                    <use href="#i-image" />
                  </svg>
                  <div className="aw-cn">
                    <b>harbour.umap</b>
                  </div>
                  <span className="aw-num r">4744</span>
                  <span className="aw-st">
                    <span className="flag C">C</span>
                  </span>
                </div>
                <div
                  className="aw-crow dir"
                  style={{ gridTemplateColumns: '16px minmax(80px,1fr) 44px 72px' }}
                >
                  <svg className="aw-ci">
                    <use href="#i-folder" />
                  </svg>
                  <div className="aw-cn">
                    <b>assets</b>
                  </div>
                  <span className="aw-num r">—</span>
                  <span className="aw-st">
                    <span className="flag X">X</span>
                  </span>
                </div>
              </section>
            </div>
            <footer className="aw-status">
              <span className="c g">
                <svg>
                  <use href="#i-check" />
                </svg>
                connected
              </span>
              <span className="c y">12 modified</span>
              <span className="sp"></span>
              <span className="c last">svn 1.14.3</span>
            </footer>
          </div>
        </div>
      </div>

      <div className="annotations">
        {annotations.map((annotation, idx) => (
          <article
            key={annotation.title}
            className="section-frame tile annotation-card reveal"
            style={{ animationDelay: `${120 + idx * 100}ms` }}
          >
            <div className="head">
              <span className="num">{idx + 1}</span>
              <h3>{annotation.title}</h3>
            </div>
            <p>{annotation.body}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
