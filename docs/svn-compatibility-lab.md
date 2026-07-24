# SVN compatibility lab

ShellySVN includes a disposable server lab for validating the app before connecting it to a
work repository. The same Compose definition runs with Docker Desktop, OrbStack, and GitHub
Actions.

## Start the lab

```bash
pnpm run svn:lab:up
```

The seeded repository is available through three authenticated transports:

| Transport    | Repository URL                      | Username    | Password       |
| ------------ | ----------------------------------- | ----------- | -------------- |
| SVN protocol | `svn://127.0.0.1:36990/repo/trunk`  | `shellysvn` | `release-test` |
| HTTP         | `http://127.0.0.1:18080/svn/trunk`  | `shellysvn` | `release-test` |
| HTTPS        | `https://127.0.0.1:18443/svn/trunk` | `shellysvn` | `release-test` |

The HTTPS endpoint deliberately uses a self-signed certificate so certificate prompts and trust
handling can be tested. A second user, `reviewer` / `review-test`, is available for lock and
conflict scenarios.

Repository data is stored in the `shellysvn-compat_svn-data` Docker volume. `down` preserves it;
`reset` deletes the disposable repository.

```bash
pnpm run svn:lab:down
pnpm run svn:lab:reset
```

## Run the automated app compatibility suite

```bash
pnpm run svn:lab:verify
```

This starts the lab if necessary and drives ShellySVN's service implementations through
authenticated checkout, repository listing, add, commit, status, cat, blame, update, revert,
cleanup, lock/unlock, properties, changelists, branch/tag copy, switch, patch creation/application,
remote mkdir/move/delete, and sparse checkout. It also smoke-tests authenticated HTTP and
self-signed HTTPS reads and mutations.

Every destructive run uses a unique child beneath `/sandbox` and removes it afterward. It never
uses the seeded `/trunk` for the broad destructive workflow.

## Point the desktop app at the lab

Start ShellySVN and add one of the repository URLs above. This is useful for manually checking:

- authentication and credential saving;
- SSL certificate review and trust behavior;
- repository browsing and historical file viewing;
- two-user locks and conflicts;
- progress and targeted cancellation;
- sparse checkout selection, especially sibling isolation.

## Probe a work server safely

The work-server probe performs only `svn info`, `svn list`, and `svn log`. It does not create a
working copy or mutate the repository. The password is passed over standard input and is not
placed in the process argument list.

```bash
SHELLYSVN_PROBE_URL="https://svn.example.test/repos/project/trunk" \
SHELLYSVN_PROBE_USERNAME="your-user" \
SHELLYSVN_PROBE_PASSWORD="your-password" \
pnpm run svn:work-server:probe
```

For a private CA or known certificate failure, add only the failures you have independently
verified. The lab's IP-based HTTPS URL requires both of these overrides with the command-line SVN
client:

```bash
SHELLYSVN_PROBE_TRUST_FAILURES="unknown-ca,cn-mismatch"
```

Do not run destructive compatibility tests against a work repository root. Ask the repository
administrator for a dedicated, disposable sandbox path first. Corporate SSO, client certificates,
proxy configuration, `svn+ssh`, server hooks, path-based authorization, and minimum client-version
rules should each be checked explicitly because the local lab cannot reproduce organization-specific
policy.

## GitHub Actions

The Linux real-SVN workflow in `.github/workflows/ci.yml` builds and starts this same Compose lab,
runs the compatibility suite, prints container logs on failure, and removes its volume afterward.
