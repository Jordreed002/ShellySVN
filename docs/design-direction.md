# Shelly workspace design

Shelly uses a restrained application interface inspired by [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh). The goal is to make the current working copy, pending changes and next action easy to identify.

## Navigation responsibilities

The sidebar owns workspace navigation. It provides a stable place for the Shelly identity, saved working copies, repository browsing and settings. The active working copy must remain identifiable when the user moves between Files and History. Selecting a working copy should establish the context for subsequent operations rather than require selecting it again in each view.

The top bar contains the sidebar toggle, command search, global utilities and window controls. Working-copy identity and view navigation live in the sidebar once, under the selected working-copy row. Do not add a second active-copy card or a repository breadcrumb block in the title bar. File and repository actions belong with their view.

Working-copy navigation must preserve the selected path. A journey from a saved working copy to its files, changes, history and commit should keep the same target. Remote repository browsing is a distinct destination with its URL visible. Destructive operations must never inherit an unrelated recent working copy silently.

## Visual rules

- Use neutral graphite surfaces in dark mode and a white canvas with soft grey navigation in light mode.
- Prefer flat rows and grouped sections to nested cards. Use one quiet separator where it clarifies structure.
- Reserve the accent for primary actions, links, focus and meaningful selection. SVN status colours retain their meaning.
- Use Archivo for interface text and JetBrains Mono for paths, revisions and commands. Shared micro-text styles have an 11px floor; primary interface text is 13px.
- Keep controls compact, with modest corners. Menus and dialogs use opaque surfaces and shadows that distinguish them from the workspace.
- Use sentence case and quiet section labels. Avoid glowing indicators, ambient gradients and hover movements in navigation.

## Interaction requirements

Every navigation item and action must remain keyboard accessible, expose its name, and show focus. Context-dependent actions need a clear prerequisite when unavailable. Loading and error states must identify the operation and offer recovery where possible. A modal must open before backend probes finish, with progress inside it.

Keep theme, density, font scale, custom accents, high contrast and reduced motion settings working. The theme contrast regression checks all four text tiers against the five standard opaque surfaces at a minimum ratio of 4.5:1. This checks token combinations; translucent utility classes and individual component arrangements still need visual and accessibility review.

## Implementation scope

The shared theme and control styles establish the application-wide foundation. Shell and view layout changes should implement the navigation responsibilities above without changing SVN semantics or moving work across the preload IPC boundary. Existing work on history and revision graphs is preserved independently.
