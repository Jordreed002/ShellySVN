#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const svn = process.env.SVN_BIN || 'svn';
const svnadmin = process.env.SVNADMIN_BIN || 'svnadmin';

function fileUrl(path) {
  const normalized = resolve(path).replaceAll('\\', '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 30000,
    input: options.input,
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  if (options.allowFailure) {
    return { status: result.status ?? 1, output };
  }

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}:\n${output}`);
  }

  return { status: 0, output };
}

function svnRun(args, options = {}) {
  return run(svn, ['--non-interactive', ...args], options);
}

function ensureToolchain() {
  run(svn, ['--version', '--quiet']);
  run(svnadmin, ['--version', '--quiet']);
}

function write(path, contents) {
  writeFileSync(path, contents, 'utf8');
}

function append(path, contents) {
  writeFileSync(path, `${readFileSync(path, 'utf8')}${contents}`, 'utf8');
}

function commit(cwd, message) {
  svnRun(['commit', '-m', message], { cwd });
}

function expectContains(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} did not include "${needle}". Output:\n${haystack}`);
  }
}

function main() {
  ensureToolchain();

  const root = mkdtempSync(join(tmpdir(), 'shellysvn-real-svn-'));
  const repoPath = join(root, 'repo');
  const importPath = join(root, 'import');
  const trunkUrl = `${fileUrl(repoPath)}/trunk`;
  const branchesUrl = `${fileUrl(repoPath)}/branches`;
  const tagsUrl = `${fileUrl(repoPath)}/tags`;
  const wc = join(root, 'wc');
  const wc2 = join(root, 'wc2');
  const sparseWc = join(root, 'sparse-wc');

  try {
    run(svnadmin, ['create', repoPath]);

    mkdirSync(join(importPath, 'trunk', 'src'), { recursive: true });
    mkdirSync(join(importPath, 'branches'), { recursive: true });
    mkdirSync(join(importPath, 'tags'), { recursive: true });
    write(join(importPath, 'trunk', 'src', 'app.txt'), 'line 1\nline 2\n');
    write(join(importPath, 'trunk', 'README.txt'), 'ShellySVN fixture\n');

    svnRun(['import', importPath, fileUrl(repoPath), '-m', 'initial import']);
    svnRun(['checkout', trunkUrl, wc]);
    svnRun(['info'], { cwd: wc });
    svnRun(['status'], { cwd: wc });

    const addedPath = join(wc, 'src', 'added.txt');
    write(addedPath, 'new file\n');
    svnRun(['add', addedPath], { cwd: wc });
    commit(wc, 'add file');

    append(join(wc, 'src', 'app.txt'), 'line 3\n');
    expectContains(svnRun(['diff'], { cwd: wc }).output, 'line 3', 'diff');
    commit(wc, 'modify file');
    svnRun(['log', '--limit', '3'], { cwd: wc });

    append(join(wc, 'src', 'app.txt'), 'local revert me\n');
    svnRun(['revert', join(wc, 'src', 'app.txt')], { cwd: wc });

    svnRun(['copy', trunkUrl, `${branchesUrl}/feature`, '-m', 'create feature branch']);
    svnRun(['copy', trunkUrl, `${tagsUrl}/v1`, '-m', 'create tag']);
    svnRun(['switch', `${branchesUrl}/feature`], { cwd: wc });
    append(join(wc, 'src', 'app.txt'), 'from feature branch\n');
    commit(wc, 'feature branch change');
    svnRun(['switch', trunkUrl], { cwd: wc });
    svnRun(['merge', `${branchesUrl}/feature`], { cwd: wc });
    expectContains(svnRun(['status'], { cwd: wc }).output, 'M', 'merge status');
    commit(wc, 'merge feature branch');

    svnRun(['checkout', '--depth', 'immediates', trunkUrl, sparseWc]);
    svnRun(['update', '--depth', 'infinity', 'src'], { cwd: sparseWc });
    expectContains(svnRun(['list'], { cwd: sparseWc }).output, 'src/', 'sparse checkout list');

    svnRun(['propset', 'svn:externals', `${trunkUrl}/src vendor-src`, wc], { cwd: wc });
    commit(wc, 'add external definition');
    expectContains(svnRun(['propget', 'svn:externals'], { cwd: wc }).output, 'vendor-src', 'externals property');
    svnRun(['update'], { cwd: wc });
    expectContains(svnRun(['list', trunkUrl]).output, 'src/', 'repository browser list');

    svnRun(['checkout', trunkUrl, wc2]);
    append(join(wc, 'src', 'app.txt'), 'from wc1\n');
    commit(wc, 'conflict source change');
    append(join(wc2, 'src', 'app.txt'), 'from wc2\n');
    const conflictUpdate = svnRun(['update'], { cwd: wc2, allowFailure: true });
    if (conflictUpdate.status === 0) {
      const status = svnRun(['status'], { cwd: wc2 }).output;
      expectContains(status, 'C', 'conflict status');
    }
    svnRun(['resolve', '--accept', 'theirs-full', join(wc2, 'src', 'app.txt')], { cwd: wc2 });

    svnRun(['lock', join(wc, 'README.txt'), '-m', 'lock test'], { cwd: wc });
    svnRun(['unlock', join(wc, 'README.txt')], { cwd: wc });

    const patchPath = join(root, 'change.patch');
    append(join(wc, 'README.txt'), 'patch line\n');
    write(patchPath, svnRun(['diff'], { cwd: wc }).output);
    svnRun(['revert', join(wc, 'README.txt')], { cwd: wc });
    svnRun(['patch', '--dry-run', patchPath], { cwd: wc });
    svnRun(['patch', patchPath], { cwd: wc });
    commit(wc, 'apply patch');

    const shelve = svnRun(['help', 'shelve'], { cwd: wc, allowFailure: true });
    const shelveSupported = shelve.status === 0 && !/unknown (?:sub)?command/i.test(shelve.output);
    if (shelveSupported) {
      append(join(wc, 'README.txt'), 'shelved line\n');
      svnRun(['shelve', 'release-smoke-shelf'], { cwd: wc });
      svnRun(['shelve', '--list'], { cwd: wc });
      svnRun(['unshelve', 'release-smoke-shelf'], { cwd: wc });
      svnRun(['revert', join(wc, 'README.txt')], { cwd: wc });
    }

    svnRun(['cleanup'], { cwd: wc });

    const summary = {
      status: 'ok',
      repository: repoPath,
      verified: [
        'checkout',
        'status',
        'info',
        'add',
        'commit',
        'update',
        'revert',
        'log',
        'diff',
        'patch',
        'branch',
        'tag',
        'merge',
        'switch',
        'sparse-checkout',
        'externals',
        'repository-browser',
        'conflict-resolve',
        'lock-unlock',
        'cleanup',
        shelveSupported ? 'shelve-unshelve' : 'shelve-unavailable',
      ],
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (process.env.KEEP_SVN_WORKFLOW_FIXTURE !== '1' && existsSync(root)) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

main();
