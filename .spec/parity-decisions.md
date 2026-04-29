# ShellySVN Parity Decisions

Generated: 2026-04-29

This document records product decisions that unblock the parity roadmap. These decisions are scoped to TortoiseSVN replacement readiness and can be revisited through a later ADR if product scope changes.

---

## Decision 1: Replacement Readiness Targets Windows and macOS First

ShellySVN replacement readiness is defined for:

- Windows x64
- macOS x64
- macOS arm64

Linux remains a supported packaging target where builds are available, but Linux shell integration and Linux-specific parity are not release-blocking for the TortoiseSVN replacement milestone.

Rationale:

- The parity roadmap is explicitly about replacing TortoiseSVN-style workflows while also becoming a first-class macOS SVN client.
- TortoiseSVN replacement credibility depends on Windows Explorer integration.
- macOS is a product differentiator because TortoiseSVN is Windows-first and Finder workflows require a platform-native design.
- Linux packaging is useful, but matching Windows/macOS file-manager parity on Linux would add desktop-environment-specific scope that does not serve the immediate replacement bar.

Implications:

- Packaged smoke tests are required for Windows x64, macOS x64, and macOS arm64 before claiming replacement readiness.
- Linux packaged smoke tests are still desirable for release quality, but Linux file-manager parity is deferred.
- README language should avoid implying Linux has equal parity priority until this decision changes.

---

## Decision 2: File Manager Integration Is a Launcher and Status Surface, Not the Whole Product

Windows Explorer and macOS Finder integration must cover common working-copy commands and status presentation, but the standalone app remains the primary surface for complex workflows.

File-manager integration should support:

- status overlays or badges where the platform allows them
- context menu entry points for common commands
- handoff into the app for commit, log search, branch/tag comparison, merge, conflict resolution, repository browsing, sparse checkout, diagnostics, and settings
- clear fallback behavior when native overlays, badges, or helper registration are unavailable

Rationale:

- TortoiseSVN users expect right-click actions and status overlays.
- Complex workflows are easier to make accessible, testable, and cross-platform inside the app.
- macOS Finder Sync does not map one-to-one to every Explorer shell extension behavior.

Implications:

- Do not clone every TortoiseSVN Windows shell command exactly.
- Do not make Windows Explorer the primary product surface.
- macOS Finder actions should use Finder-appropriate handoff patterns instead of forcing Explorer-specific behavior.

---

## Decision 3: Linux Shell Integration Is Deferred

Linux shell integration is deferred until Windows/macOS replacement-critical workflows are reliable.

Rationale:

- Linux file-manager integration differs across GNOME Files, Dolphin, Thunar, Nemo, and other environments.
- The product spec positions Linux as package-supported where available, while the parity roadmap emphasizes Windows and macOS.

Implications:

- Linux package smoke tests can be added under release quality.
- Linux context menu and badge integrations should remain wishlist/backlog items until a specific desktop environment target is selected.

---

## Decision 4: Git Integration Is Not Part of the Parity Roadmap

Git integration remains out of scope for TortoiseSVN parity unless the product spec changes.

Rationale:

- `.spec/spec.md` explicitly says ShellySVN is not a Git client.
- SVN parity work already has a large replacement-critical surface.

Implications:

- Git integration should not appear in parity checklists.
- If retained in README, it should be framed as a future wishlist item rather than parity work.

---

## Decision 5: Office/Document Diff Defaults to External Tool Handoff

Office/document diff is not a replacement-critical built-in viewer for the current parity milestone. ShellySVN should support external-tool handoff for document formats and avoid promising built-in Office diff unless a later spec explicitly scopes it.

Rationale:

- Text, image, and patch workflows are higher-frequency SVN client needs.
- Native Office comparison is platform- and application-dependent.
- External diff tool configuration already matches how many SVN users handle document comparisons.

Implications:

- The diff roadmap should focus on reliable unified/side-by-side text diff, image diff, and external diff tool configuration.
- README should not imply built-in Office/document diff support.

---

## Decision 6: Advanced TortoiseSVN Compatibility Is Deferred

The following are useful but not required for replacement readiness:

- full TortoiseSVN settings compatibility
- legacy TortoiseSVN command URL compatibility
- built-in SubWCRev equivalent
- group policy deployment controls

Rationale:

- These features support migrations or enterprise deployment, but they do not block core daily SVN workflows.
- They can be delivered incrementally after replacement-critical workflows are stable.

Implications:

- Track these as deferred or wishlist items.
- Do not block the parity milestone on them.
