import Link from 'next/link';
import { BuildTools } from '@/components/site/build-tools';
import { FeatureGrid } from '@/components/site/feature-grid';
import { GradientCards } from '@/components/site/gradient-cards';
import { PreviewBanner } from '@/components/site/preview-banner';
import { ProductPanel } from '@/components/site/product-panel';
import { WorkflowRail } from '@/components/site/workflow-rail';

export default function HomePage() {
  return (
    <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-28 px-5 py-12 sm:px-8 sm:py-20">
      {/* HERO -------------------------------------------------------- */}
      <section className="relative space-y-12">
        <div className="aurora" aria-hidden />
        <div className="dot-grid hidden md:block" aria-hidden />
        <div className="floats hidden lg:block" aria-hidden>
          <span
            className="float-item drift-a"
            style={{ top: '12%', left: '4%', ['--float-opacity' as never]: 0.55 }}
          >
            <span className="swatch mod">M</span>
            src/main/index.ts
          </span>
          <span
            className="float-item drift-b"
            style={{ top: '22%', right: '6%', ['--float-opacity' as never]: 0.5 }}
          >
            <span className="swatch add">A</span>
            app/global.css
          </span>
          <span
            className="float-item drift-c"
            style={{ top: '52%', left: '7%', ['--float-opacity' as never]: 0.42 }}
          >
            <span className="swatch rev">r</span>
            r41892 · HEAD
          </span>
          <span
            className="float-item drift-a"
            style={{ top: '64%', right: '4%', ['--float-opacity' as never]: 0.4 }}
          >
            <span className="swatch add">+</span>
            sparse · 50.5 MB
          </span>
        </div>

        <div className="relative mx-auto max-w-4xl space-y-7 text-center">
          <p className="eyebrow reveal reveal-1 mx-auto">Preview release</p>
          <h1 className="display reveal reveal-2 text-[2.75rem] leading-[1] sm:text-6xl lg:text-[5.25rem]">
            Subversion,
            <br />
            <em>without the struggle.</em>
          </h1>
          <p className="reveal reveal-3 mx-auto max-w-2xl text-lg leading-8 text-[var(--muted-foreground)]">
            A packaged desktop Subversion client for teams that still need SVN, still need
            performance, and still don&apos;t want to hand-wire a toolchain on every machine.
          </p>
          <div className="reveal reveal-4 flex flex-wrap items-center justify-center gap-3">
            <Link href="/download" className="btn btn-primary btn-lg">
              Download for macOS
            </Link>
            <Link href="/docs/getting-started/install" className="btn btn-secondary btn-lg">
              Read the docs
            </Link>
          </div>
          <div className="reveal reveal-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[0.8rem] text-[var(--muted-foreground)]">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_currentColor]" />
              macOS
            </span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_currentColor]" />
              Windows
            </span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_8px_currentColor]" />
              Linux
            </span>
            <span className="text-[var(--dim)]">·</span>
            <span>bundles Subversion 1.14 — no external install</span>
          </div>
        </div>

        <div className="reveal reveal-6 app-shot-glow relative">
          <div className="app-shot">
            <img
              src="/screenshots/shellysvn-app.png"
              alt="ShellySVN desktop application — repositories sidebar, working copy actions, and bundled Subversion client"
              width={2936}
              height={1936}
              loading="eager"
            />
          </div>
        </div>

        <PreviewBanner />
      </section>

      {/* TRUST STRIP — umami-style platform/spec row ----------------- */}
      <section className="border-y border-[var(--border)] py-10">
        <p className="kicker mb-6 text-center">Built on what already works</p>
        <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 text-[0.95rem] text-[var(--muted-foreground)]">
          <li className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_10px_currentColor]" />
            <span>Subversion 1.14</span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_10px_currentColor]" />
            <span>Electron · React · TanStack</span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_10px_currentColor]" />
            <span>Native binaries — no JVM, no manual SVN install</span>
          </li>
          <li className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_10px_currentColor]" />
            <span>Open source &amp; auditable</span>
          </li>
        </ul>
      </section>

      {/* QUESTION-DRIVEN FEATURE CARDS (umami pattern) --------------- */}
      <section className="space-y-10">
        <div className="max-w-3xl space-y-4">
          <p className="kicker">Answers, faster</p>
          <h2 className="display text-4xl sm:text-5xl">
            ShellySVN answers the questions you
            <br />
            <em>actually ask</em> about your repo.
          </h2>
          <p className="max-w-2xl text-[0.95rem] leading-7 text-[var(--muted-foreground)]">
            From sparse checkout to remote browsing, every surface is shaped around how SVN teams
            really work — without digging through cluttered menus.
          </p>
        </div>
        <GradientCards />
      </section>

      {/* EDITORIAL SPLIT — Built for SVN ----------------------------- */}
      <section className="relative">
        <BuildTools />
      </section>

      {/* PRODUCT PANEL ----------------------------------------------- */}
      <section className="space-y-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl space-y-4">
            <p className="kicker">The home view</p>
            <h2 className="display text-4xl sm:text-5xl">
              Where is my repo, and <em>what do I do</em> with it?
            </h2>
          </div>
          <p className="max-w-md text-sm leading-7 text-[var(--muted-foreground)]">
            Quick access to recent repositories, drag-to-open working copies, and a unified action
            bar for the everyday verbs — update, commit, revert, diff.
          </p>
        </div>
        <ProductPanel />
      </section>

      {/* FEATURE GRID ------------------------------------------------ */}
      <section className="space-y-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl space-y-4">
            <p className="kicker">What ships today</p>
            <h2 className="display text-4xl sm:text-5xl">
              What is <em>actually</em> in the preview?
            </h2>
          </div>
          <p className="max-w-md text-sm leading-7 text-[var(--muted-foreground)]">
            Working copies, sparse checkout, history, diffs, repository browsing, and packaged
            release binaries — explicit about what ships, what is preview-only, and what remains
            gated.
          </p>
        </div>
        <FeatureGrid />
      </section>

      {/* WORKFLOW RAIL ----------------------------------------------- */}
      <section className="space-y-10">
        <div className="max-w-2xl space-y-4">
          <p className="kicker">Three moves</p>
          <h2 className="display text-4xl sm:text-5xl">
            <em>Lean</em> in. <em>Read</em> first. <em>Ship</em> packaged.
          </h2>
        </div>
        <WorkflowRail />
      </section>

      {/* PULL QUOTE -------------------------------------------------- */}
      <section className="quote mx-auto max-w-5xl">
        <div className="quote-mark">&ldquo;</div>
        <p className="quote-body">
          ShellySVN is the first SVN desktop client I&apos;ve installed in a decade that didn&apos;t
          immediately make me miss the command line. It actually <em>respects</em> how you work.
        </p>
        <div className="quote-attrib mt-6">
          <span className="quote-avatar" aria-hidden />
          <span>
            <span className="text-[var(--foreground-strong)]">Anonymous evaluator</span> · preview tester
          </span>
        </div>
      </section>

      {/* DOWNLOAD CTA — GitHub-Desktop style centered block ---------- */}
      <section className="relative overflow-hidden rounded-3xl border border-[var(--border-strong)] px-6 py-16 text-center sm:px-12 sm:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(60% 80% at 50% 0%, rgba(124,124,245,0.5), transparent 60%), radial-gradient(50% 60% at 80% 100%, rgba(94,234,212,0.35), transparent 60%), radial-gradient(50% 60% at 20% 100%, rgba(240,165,91,0.25), transparent 60%), var(--surface)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.08] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>\")",
          }}
        />
        <p className="eyebrow mx-auto">Download now</p>
        <h2 className="display mt-6 text-4xl sm:text-6xl">
          Try the preview.
          <br />
          <em>Tell us what breaks.</em>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-[var(--muted-foreground)]">
          Preview builds ship today for macOS, Windows, and Linux. Issues filed on GitHub flow
          straight into the roadmap.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/download" className="btn btn-primary btn-lg">
            Download for macOS
          </Link>
          <Link href="/docs" className="btn btn-secondary btn-lg">
            Read the docs
          </Link>
        </div>
      </section>
    </div>
  );
}
