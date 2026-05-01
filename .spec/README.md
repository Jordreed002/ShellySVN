# ShellySVN Spec Index

This folder now keeps only living product, release, and engineering records. Completed audits, one-off migration plans, and stale parity snapshots were removed after their outcomes were folded into the files below.

## Living Documents

| File | Purpose |
| --- | --- |
| `spec.md` | Product and engineering specification. |
| `tasks.md` | Current task checklist and replacement-readiness tracker. |
| `production-release-blockers.md` | Public release gate and remaining external verification. |
| `parity-decisions.md` | Scope decisions for TortoiseSVN replacement readiness. |
| `adr-logic-engine.md` | Architecture decision for the Electron main-process SVN backend and experimental logic engine. |
| `architecture-boundaries.md` | Main/preload/renderer/shared ownership boundaries. |
| `cli-parity-contract.md` | Contract for any future CLI or logic-engine parity claims. |
| `performance-budgets.md` | Large-repository fixture sizes and timing budgets. |
| `skipped-tests.md` | Skipped-test baseline and reduction policy. |

## Release State

All implementation and CI cleanup tasks are complete except the release-candidate gates that require signed artifacts or target machines:

- Windows Authenticode validation on a clean Windows 10/11 x64 machine.
- macOS x64 and arm64 Developer ID signing, notarization, stapling, Gatekeeper acceptance, and launch validation.
- Real-SVN replacement workflow verification against release-candidate toolchains/artifacts, including shelving with an SVN client that supports shelving.

Use `tasks.md` for implementation status and `production-release-blockers.md` for the public release go/no-go checklist.
