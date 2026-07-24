#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const url = process.env.SHELLYSVN_PROBE_URL;
const username = process.env.SHELLYSVN_PROBE_USERNAME;
const password = process.env.SHELLYSVN_PROBE_PASSWORD;
const trustFailures = process.env.SHELLYSVN_PROBE_TRUST_FAILURES;
const svn = process.env.SVN_BIN || 'svn';

if (!url) {
  throw new Error(
    'SHELLYSVN_PROBE_URL is required. The probe is read-only and should target a repository path you can browse.'
  );
}
if (password && !username) {
  throw new Error('SHELLYSVN_PROBE_USERNAME is required when SHELLYSVN_PROBE_PASSWORD is set.');
}

function svnRead(args) {
  const authArgs = ['--non-interactive', '--no-auth-cache'];
  if (username) authArgs.push('--username', username);
  if (password) authArgs.push('--password-from-stdin');
  if (trustFailures) {
    authArgs.push('--trust-server-cert');
    authArgs.push('--trust-server-cert-failures', trustFailures);
  }

  const result = spawnSync(svn, [...args, ...authArgs], {
    encoding: 'utf8',
    input: password ? `${password}\n` : undefined,
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const safeOutput = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Read-only SVN probe failed for "${args[0]}":\n${safeOutput}`);
  }
  return result.stdout.trim();
}

const clientVersion = spawnSync(svn, ['--version', '--quiet'], {
  encoding: 'utf8',
  windowsHide: true,
}).stdout.trim();
const resolvedUrl = svnRead(['info', '--show-item', 'url', url]);
const repositoryRoot = svnRead(['info', '--show-item', 'repos-root-url', url]);
const repositoryUuid = svnRead(['info', '--show-item', 'repos-uuid', url]);
const revision = svnRead(['info', '--show-item', 'revision', url]);
const listingXml = svnRead(['list', '--xml', '--depth', 'immediates', url]);
const logXml = svnRead(['log', '--xml', '--limit', '1', url]);
const immediateEntries = (listingXml.match(/<entry\b/g) ?? []).length;
const latestLogRevision = /<logentry\s+revision="(\d+)"/.exec(logXml)?.[1] ?? null;

console.log(
  JSON.stringify(
    {
      status: 'compatible-read-only',
      mutationPerformed: false,
      svnClientVersion: clientVersion,
      requestedUrl: url,
      resolvedUrl,
      repositoryRoot,
      repositoryUuid,
      revision: Number.parseInt(revision, 10),
      immediateEntries,
      latestLogRevision: latestLogRevision ? Number.parseInt(latestLogRevision, 10) : null,
      authentication: username ? 'explicit-credentials' : 'native/default',
      certificateTrustOverride: trustFailures || null,
      nextStep:
        'Use a dedicated writable sandbox path and the Docker compatibility workflow before enabling mutations on a work repository.',
    },
    null,
    2
  )
);
