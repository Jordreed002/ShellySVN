# Performance Budgets and Repository Fixtures

Date: 2026-04-29

These budgets define the fixture sizes and regression thresholds for parity testing. They are intentionally measurable and should be revised only with a benchmark result or product decision.

## Repository Size Targets

| Fixture | File count | Folder depth | Log length | Diff size | Binary size | Purpose |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `small-wc` | 250 | 4 | 500 revisions | 250 KB | 5 MB | Fast smoke coverage for common workflows. |
| `medium-wc` | 10,000 | 8 | 25,000 revisions | 5 MB | 100 MB | Default parity fixture for status, update, log, diff, and repository browser tests. |
| `large-wc` | 100,000 | 14 | 250,000 revisions | 50 MB | 1 GB | Stress fixture for background scanning, virtualization, cache behavior, and cancellation. |
| `conflict-wc` | 2,000 | 6 | 5,000 revisions | 2 MB | 25 MB | Conflict, lock, merge, and resolve workflows with mixed text, tree, and lock conflicts. |
| `sparse-wc` | 50,000 remote entries, 5,000 local entries | 12 | 100,000 revisions | 10 MB | 250 MB | Sparse checkout, remote-only item display, repository browser lazy loading, and add-to-working-copy flows. |

Fixture repositories should include:

- mixed file extensions for syntax highlighting and unknown-language fallback
- property-only changes
- copied, renamed, moved, deleted, missing, ignored, external, switched, nested, obstructed, and locked paths
- binary images and non-previewable binary assets
- issue IDs in log messages
- branch/tag copies and merge-tracking metadata

## Regression Budgets

Budgets are measured on a release-class machine, not a developer laptop under load. CI can use looser smoke limits, but release qualification should use these targets.

| Area | Budget | Measurement |
| --- | --- | --- |
| Renderer initial bundle | <= 750 KiB raw and <= 160 KiB gzip for the initial renderer entry | `bun run analyze:bundle` report |
| App shell cold start | <= 3 seconds to first usable window | packaged app smoke test |
| App shell warm start | <= 1.5 seconds to first usable window | packaged app smoke test |
| Open `medium-wc` | <= 5 seconds to root metadata and first visible status | E2E/perf test |
| `medium-wc` status refresh | <= 10 seconds without blocking renderer interaction | main-process status benchmark plus UI responsiveness probe |
| `large-wc` background scan | cancellable within 500 ms after user cancellation | status scan benchmark |
| Repository browser first page | <= 2 seconds for first visible children | repo browser benchmark |
| Repository browser large folder expand | <= 3 seconds for 5,000 child entries with virtualization stable | repo browser benchmark |
| Log first page | <= 2 seconds for 100 entries from warm cache, <= 6 seconds cold | log benchmark |
| Log filtering | <= 300 ms UI response for cached `medium-wc` logs | renderer benchmark |
| Unified diff render | <= 2 seconds for 5 MB text diff, with truncation/streaming metadata above budget | diff benchmark |
| Large binary handling | no renderer preview attempt above configured binary preview limit | diff/file review benchmark |

## Measurement Rules

- Benchmarks must run against generated or checked-in fixture recipes, not hand-picked local repositories.
- Measurements must record app version, commit SHA, OS, CPU architecture, SVN version, and fixture name.
- Regressions above budget require either a fix or an explicit accepted-risk entry before release.
- Performance work must not depend on remote assets or network-only fixtures for normal operation.
