# SVN Project Property Compatibility

Date: 2026-04-29

This note evaluates common SVN and TortoiseSVN project properties that affect ShellySVN parity.

## Supported

| Property | Compatibility | Evidence |
| --- | --- | --- |
| `svn:ignore` | Supported for viewing, editing, deleting, and ignore helper workflows. | `PropertiesDialog`, `IgnoreDialog`, `svn-metadata.test.ts`, validation tests. |
| `svn:externals` | Supported for property display and initial externals manager list/add/remove behavior. Full edit/update parity remains tracked separately. | `ExternalsManager`, `svn-metadata.externals*`, roadmap externals item. |
| `svn:keywords` | Supported through property helper and set/delete service coverage. | `PropertiesDialog`, `svn-metadata.test.ts`. |
| `svn:eol-style` | Supported through property helper and set service coverage. | `PropertiesDialog`, `svn-metadata.test.ts`. |
| `svn:mime-type` | Supported through property helper and list parsing coverage. | `PropertiesDialog`, `svn-metadata.test.ts`. |
| `bugtraq:url` | Supported for issue link URL templates, including `%BUGID%` conversion. | `issueTracker.ts`, `issueTracker.test.ts`. |
| `bugtraq:logregex` | Supported for single-line and common two-line TortoiseSVN regex forms. | `issueTracker.test.ts`. |
| `bugtraq:number` | Supported as numeric issue ID fallback when no regex is supplied. | `issueTracker.ts`. |
| Inherited `bugtraq:*` lookup | Supported by walking nested paths to the working-copy root. | `getInheritedPropertyLookupPaths`, `useIssueTrackerConfig`. |

## Partial Or Tracked Elsewhere

| Property / family | Status |
| --- | --- |
| `svn:externals` full manager parity | Listing/add/remove are present; edit/update and clearer commit/status handling remain open in the parity roadmap. |
| `bugtraq:message`, `bugtraq:label`, `bugtraq:warnifnoissue`, `bugtraq:append`, `bugtraq:provideruuid`, `bugtraq:providerparams` | Not directly modeled. Equivalent behavior is covered through ShellySVN issue tracker settings, required issue warnings, URL templates, and commit dialog fields. Provider COM integration is Windows/TortoiseSVN-specific and out of scope before 1.0. |
| `tsvn:*` UI preference properties | Not a compatibility target before 1.0 unless a concrete workflow gap is identified. |

## Decision

Common SVN properties and the high-value TortoiseSVN `bugtraq:*` issue-tracker properties are compatible enough for the current parity milestone. Remaining work should focus on externals workflow parity and real working-copy fixtures rather than broad TortoiseSVN settings emulation.
