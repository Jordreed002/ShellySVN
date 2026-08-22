/**
 * The product, rendered as markup rather than as a screenshot.
 *
 * Ported from prototypes/12-browser.html and styled from the same tokens the
 * desktop app uses, which means this cannot go stale against the product the
 * way a PNG does. It replaces /screenshots/shellysvn-app.png.
 *
 * Decorative: the whole tree is aria-hidden and non-interactive.
 */
export function AppWindow() {
  return (
    <div aria-hidden>
      <div className="app-shot-glow">
        <div className="app-shot">
          <div className="aw-top">
            <span className="brand" style={{ gap: '7px' }}>
              <svg style={{ width: '19px', height: '19px' }}>
                <use href="#i-shell" />
              </svg>
              <b style={{ fontSize: '13px' }}>
                Shelly<em>SVN</em>
              </b>
            </span>
            <div className="aw-pill">
              <svg style={{ width: '12px', height: '12px', color: 'var(--faint)' }}>
                <use href="#i-repo" />
              </svg>
              <span className="m">svn.lineindustries.com</span>
              <svg style={{ width: '11px', height: '11px', color: 'var(--faint)' }}>
                <use href="#i-chevd" />
              </svg>
            </div>
            <div className="aw-search">
              <svg>
                <use href="#i-search" />
              </svg>
              <span>
                Go to a path, or search the repository —{' '}
                <span style={{ fontFamily: 'var(--font-mono)' }}>r4835</span>,{' '}
                <span style={{ fontFamily: 'var(--font-mono)' }}>@mira</span>
              </span>
            </div>
            <div className="aw-tr">
              <span className="aw-ib" data-pressed="true">
                <svg>
                  <use href="#i-side" />
                </svg>
              </span>
              <span className="aw-ib">
                <svg>
                  <use href="#i-cog" />
                </svg>
              </span>
              <span className="aw-av">J</span>
            </div>
          </div>

          <div className="aw-nav">
            <span className="aw-btn icon">
              <svg style={{ transform: 'rotate(180deg)' }}>
                <use href="#i-chev" />
              </svg>
            </span>
            <span className="aw-btn icon">
              <svg>
                <use href="#i-up" />
              </svg>
            </span>
            <span className="aw-btn icon">
              <svg>
                <use href="#i-refresh" />
              </svg>
            </span>
            <div className="aw-addr">
              <svg>
                <use href="#i-repo" />
              </svg>
              <span className="aw-crumb">clients</span>
              <span className="aw-sep">/</span>
              <span className="aw-crumb">acme-corp</span>
              <span className="aw-sep">/</span>
              <span className="aw-crumb">website</span>
              <span className="aw-sep">/</span>
              <span className="aw-crumb here">trunk</span>
              <span className="aw-rev">
                @ <b>HEAD</b>
              </span>
            </div>
            <span className="aw-btn">
              <svg>
                <use href="#i-dl" />
              </svg>
              Checkout…
            </span>
          </div>

          <div className="aw-body" style={{ height: '452px' }}>
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
              <div className="aw-disk">
                <b>18.4 GB on disk</b>
                <div className="bar">
                  <i style={{ width: '56%', background: 'var(--green)' }}></i>
                  <i style={{ width: '14%', background: 'var(--green-ring)' }}></i>
                  <i style={{ flex: '1', background: 'var(--hairline)' }}></i>
                </div>
                <span className="m">full 12.1 · sparse 6.3 · not fetched 2.08 TB</span>
              </div>
              <div className="aw-rsec">
                <span className="k">Repository</span>
              </div>
              <div className="aw-ritem">
                <svg>
                  <use href="#i-repo" />
                </svg>
                <span className="n">Root</span>
              </div>
              <div className="aw-ritem">
                <svg>
                  <use href="#i-folder" />
                </svg>
                <span className="n">clients</span>
                <span className="c">51</span>
              </div>
              <div className="aw-ritem">
                <svg>
                  <use href="#i-folder" />
                </svg>
                <span className="n">internal</span>
                <span className="c">6</span>
              </div>
              <div className="aw-rsec">
                <span className="k">Problems</span>
              </div>
              <div className="aw-ritem">
                <svg style={{ color: 'var(--ember)' }}>
                  <use href="#i-warn" />
                </svg>
                <span className="n">Needs attention</span>
                <span className="c mod">4</span>
              </div>
            </aside>

            <div className="aw-tree">
              <div className="aw-th">
                <span className="k">Repository tree</span>
                <svg style={{ width: '11px', height: '11px', color: 'var(--faint)' }}>
                  <use href="#i-chevd" />
                </svg>
              </div>
              <div className="aw-tn open">
                <span className="aw-tw">
                  <svg>
                    <use href="#i-chev" />
                  </svg>
                </span>
                <svg className="aw-ti">
                  <use href="#i-repo" />
                </svg>
                <span className="aw-tnm">atlas</span>
                <span className="aw-tc">4</span>
              </div>
              <div className="aw-tn open" style={{ paddingLeft: '14px' }}>
                <span className="aw-tw">
                  <svg>
                    <use href="#i-chev" />
                  </svg>
                </span>
                <svg className="aw-ti">
                  <use href="#i-folder" />
                </svg>
                <span className="aw-tnm">clients</span>
                <span className="aw-tc">51</span>
              </div>
              <div className="aw-tn wc" style={{ paddingLeft: '28px' }}>
                <span className="aw-tw">
                  <svg>
                    <use href="#i-chev" />
                  </svg>
                </span>
                <svg className="aw-ti">
                  <use href="#i-folder" />
                </svg>
                <span className="aw-tnm">acme-corp</span>
                <span className="aw-tb">12</span>
              </div>
              <div className="aw-tn open" style={{ paddingLeft: '42px' }}>
                <span className="aw-tw">
                  <svg>
                    <use href="#i-chev" />
                  </svg>
                </span>
                <svg className="aw-ti">
                  <use href="#i-folder" />
                </svg>
                <span className="aw-tnm">website</span>
              </div>
              <div className="aw-tn on" style={{ paddingLeft: '56px' }}>
                <span className="aw-tw leaf"></span>
                <svg className="aw-ti">
                  <use href="#i-folder" />
                </svg>
                <span className="aw-tnm">trunk</span>
              </div>
              <div className="aw-tn" style={{ paddingLeft: '56px' }}>
                <span className="aw-tw">
                  <svg>
                    <use href="#i-chev" />
                  </svg>
                </span>
                <svg className="aw-ti">
                  <use href="#i-branch" />
                </svg>
                <span className="aw-tnm">branches</span>
                <span className="aw-tc">7</span>
              </div>
              <div className="aw-tn" style={{ paddingLeft: '56px' }}>
                <span className="aw-tw">
                  <svg>
                    <use href="#i-chev" />
                  </svg>
                </span>
                <svg className="aw-ti">
                  <use href="#i-folder" />
                </svg>
                <span className="aw-tnm">tags</span>
                <span className="aw-tc">34</span>
              </div>
              <div className="aw-tn ghost" style={{ paddingLeft: '28px' }}>
                <span className="aw-tw leaf"></span>
                <svg className="aw-ti">
                  <use href="#i-folder" />
                </svg>
                <span className="aw-tnm">globex</span>
                <span className="aw-tc">9</span>
              </div>
              <div className="aw-tn ghost" style={{ paddingLeft: '28px' }}>
                <span className="aw-tw leaf"></span>
                <svg className="aw-ti">
                  <use href="#i-folder" />
                </svg>
                <span className="aw-tnm">…47 more</span>
              </div>
              <div className="aw-tn" style={{ paddingLeft: '14px' }}>
                <span className="aw-tw">
                  <svg>
                    <use href="#i-chev" />
                  </svg>
                </span>
                <svg className="aw-ti">
                  <use href="#i-folder" />
                </svg>
                <span className="aw-tnm">internal</span>
                <span className="aw-tb ext">2</span>
              </div>
              <div className="aw-tn" style={{ paddingLeft: '14px' }}>
                <span className="aw-tw">
                  <svg>
                    <use href="#i-chev" />
                  </svg>
                </span>
                <svg className="aw-ti">
                  <use href="#i-folder" />
                </svg>
                <span className="aw-tnm">shared</span>
                <span className="aw-tc">3</span>
              </div>
            </div>

            <section className="aw-cont">
              <div className="aw-scope wc">
                <svg style={{ color: 'var(--green)' }}>
                  <use href="#i-check" />
                </svg>
                <span>
                  <b>Working copy</b> — status from disk
                </span>
                <span className="m">svn status -u</span>
              </div>
              <div className="aw-band">
                <div className="aw-flows">
                  <div className="aw-flow">
                    <span className="n y">17</span>
                    <span className="l">
                      <b>Incoming</b>
                      <small>svn update</small>
                    </span>
                  </div>
                  <div className="aw-flow">
                    <span className="n">12</span>
                    <span className="l">
                      <b>Local</b>
                      <small>11 mod, 1 conflict</small>
                    </span>
                  </div>
                  <div className="aw-flow">
                    <span className="n g">4</span>
                    <span className="l">
                      <b>Eligible</b>
                      <small>not here yet</small>
                    </span>
                  </div>
                </div>
                <div className="aw-mixed">
                  <span>r4744</span>
                  <span className="track">
                    <i style={{ left: '2%' }}></i>
                    <i style={{ left: '11%' }}></i>
                    <i style={{ left: '24%' }}></i>
                    <i style={{ left: '39%' }}></i>
                    <i style={{ left: '43%' }}></i>
                    <i style={{ left: '58%' }}></i>
                    <i style={{ left: '75%' }}></i>
                    <i style={{ left: '89%' }}></i>
                  </span>
                  <span>mixed · r4838</span>
                </div>
              </div>
              <div className="aw-chead">
                <span></span>
                <span>Name</span>
                <span className="r">Rev</span>
                <span>Author</span>
                <span className="r">Status</span>
              </div>
              <div className="aw-crow dir">
                <svg className="aw-ci">
                  <use href="#i-folder" />
                </svg>
                <div className="aw-cn">
                  <b>src</b>
                </div>
                <span className="aw-num r">4838</span>
                <span className="aw-txt">mira</span>
                <span className="aw-st">
                  <span className="flag M">M</span>
                </span>
              </div>
              <div className="aw-crow dir">
                <svg className="aw-ci">
                  <use href="#i-folder" />
                </svg>
                <div className="aw-cn">
                  <b>assets</b>
                </div>
                <span className="aw-num r">4802</span>
                <span className="aw-txt">dev-bot</span>
                <span className="aw-st">
                  <span className="flag X">X</span>
                </span>
              </div>
              <div className="aw-crow">
                <svg className="aw-ci">
                  <use href="#i-file" />
                </svg>
                <div className="aw-cn">
                  <b>package.json</b>
                </div>
                <span className="aw-num r">4821</span>
                <span className="aw-txt">mira</span>
                <span className="aw-st">
                  <span className="flag M">M</span>
                </span>
              </div>
              <div className="aw-crow">
                <svg className="aw-ci">
                  <use href="#i-file" />
                </svg>
                <div className="aw-cn">
                  <b>types.ts</b>
                </div>
                <span className="aw-num r">—</span>
                <span className="aw-txt">jordan</span>
                <span className="aw-st">
                  <span className="flag A">A</span>
                </span>
              </div>
              <div className="aw-crow">
                <svg className="aw-ci">
                  <use href="#i-image" />
                </svg>
                <div className="aw-cn">
                  <b>harbour.umap</b>
                </div>
                <span className="aw-num r">4744</span>
                <span className="aw-txt">kaz</span>
                <span className="aw-st">
                  <span className="flag C">C</span>
                </span>
              </div>
              <div className="aw-crow">
                <svg className="aw-ci">
                  <use href="#i-file" />
                </svg>
                <div className="aw-cn">
                  <b>legacy-bridge.c</b>
                </div>
                <span className="aw-num r">3910</span>
                <span className="aw-txt">archive</span>
                <span className="aw-st">
                  <span className="flag D">D</span>
                </span>
              </div>
              <div className="aw-crow">
                <svg className="aw-ci">
                  <use href="#i-file" />
                </svg>
                <div className="aw-cn">
                  <b>README.md</b>
                </div>
                <span className="aw-num r">4711</span>
                <span className="aw-txt">mira</span>
                <span className="aw-st">
                  <span className="flag quiet">—</span>
                </span>
              </div>
              <div className="aw-crow ghost">
                <svg className="aw-ci">
                  <use href="#i-folder" />
                </svg>
                <div className="aw-cn">
                  <b>node_modules</b>
                </div>
                <span className="aw-num r">—</span>
                <span className="aw-txt">—</span>
                <span className="aw-st">
                  <span className="flag quiet">ignored</span>
                </span>
              </div>
            </section>

            <aside className="aw-detail">
              <div className="aw-dh">
                <div className="aw-dtop">
                  <b>package.json</b>
                  <span
                    className="aw-btn icon"
                    style={{ borderColor: 'transparent', background: 'none', boxShadow: 'none' }}
                  >
                    <svg>
                      <use href="#i-ext" />
                    </svg>
                  </span>
                </div>
                <div className="aw-dtabs">
                  <span className="on">Diff</span>
                  <span>Blame</span>
                  <span>Log</span>
                  <span>Props</span>
                </div>
              </div>
              <div className="aw-cmp">
                <span>Compare</span>
                <span className="p">working copy</span>
                <span>→</span>
                <span className="p">BASE r4821</span>
              </div>
              <div>
                <div className="aw-dl hunk">
                  <span className="ln"></span>
                  <span className="tx">@@ -14,7 +14,8 @@</span>
                </div>
                <div className="aw-dl">
                  <span className="ln">14</span>
                  <span className="tx">{'  "scripts": {'}</span>
                </div>
                <div className="aw-dl del">
                  <span className="ln">15</span>
                  <span className="tx">- "build": "vite build"</span>
                </div>
                <div className="aw-dl add">
                  <span className="ln">15</span>
                  <span className="tx">+ "build": "vite build --prod",</span>
                </div>
                <div className="aw-dl add">
                  <span className="ln">16</span>
                  <span className="tx">+ "verify": "svn status -u"</span>
                </div>
                <div className="aw-dl">
                  <span className="ln">17</span>
                  <span className="tx">{'  },'}</span>
                </div>
                <div className="aw-dl hunk">
                  <span className="ln"></span>
                  <span className="tx">@@ -41,3 +42,3 @@</span>
                </div>
                <div className="aw-dl del">
                  <span className="ln">41</span>
                  <span className="tx">- "react": "18.2.0"</span>
                </div>
                <div className="aw-dl add">
                  <span className="ln">42</span>
                  <span className="tx">+ "react": "18.3.1"</span>
                </div>
              </div>
            </aside>
          </div>

          <footer className="aw-status">
            <span className="c">
              <svg>
                <use href="#i-repo" />
              </svg>
              atlas · 2.1 TB · 512k paths
            </span>
            <span className="c">
              browsing <b>@HEAD r4838</b>
            </span>
            <span className="c">
              <svg>
                <use href="#i-disk" />
              </svg>
              3 working copies · <b>18.4 GB</b>
            </span>
            <span className="c y">12 modified · 1 conflicted</span>
            <span className="sp"></span>
            <span className="c g">
              <svg>
                <use href="#i-check" />
              </svg>
              connected
            </span>
            <span className="c last">svn 1.14.3</span>
          </footer>
        </div>
      </div>
    </div>
  );
}
