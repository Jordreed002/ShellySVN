#!/usr/bin/env node
// Flips Electron security fuses on packaged ShellySVN builds.
//
// electron-builder runs this as the global `afterPack` hook (see
// electron-builder.yml), i.e. after the app directory is assembled and before
// code signing, for every platform/arch pack pass. It is also usable from the
// command line:
//
//   node scripts/fuses.mjs                 # show fuses of the local dev Electron
//   node scripts/fuses.mjs read  <binary>  # inspect an app or Electron binary
//   node scripts/fuses.mjs write <binary>  # apply the fuse configuration
//
// Fuse decisions:
// - RunAsNode OFF: the shipped binary must not degrade into a plain Node
//   runtime via ELECTRON_RUN_AS_NODE. Known impact: the Windows npm-shim
//   resolution in src/main/services/ai-commit-message.ts re-runs
//   process.execPath with ELECTRON_RUN_AS_NODE=1 and needs a follow-up that
//   resolves a real node executable instead.
// - EnableNodeCliInspectArguments OFF / EnableNodeOptionsEnvironmentVariable
//   OFF: block --inspect* debugging and NODE_OPTIONS injection against the
//   packaged app.
// - EnableCookieEncryption ON: persist cookies encrypted at rest. Cookies
//   written by earlier unencrypted builds are dropped once on first launch.
// - GrantFileProtocolExtraPrivileges ON: REQUIRED by this app. The packaged
//   renderer loads from file:// and its entry chunk is an ES module
//   (<script type="module" crossorigin>), which Chromium fetches with CORS.
//   With this fuse off, file:// documents have an opaque origin and module
//   scripts fail with "Cross origin requests are only supported for protocol
//   schemes: ... http, https" (verified empirically against Electron 43).
//   The remaining privileges this fuse grants are contained by the renderer
//   CSP (connect-src 'self' for fetch, worker-src 'self', frame-src 'none').
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import {
  flipFuses,
  getCurrentFuseWire,
  FuseState,
  FuseVersion,
  FuseV1Options,
} from '@electron/fuses';

const PRODUCT_NAME = 'ShellySVN';

const FUSE_STATE_LABELS = new Map(
  Object.entries(FuseState)
    .filter(([, value]) => typeof value === 'number')
    .map(([label, value]) => [value, label])
);

function fuseValues(platform) {
  return {
    version: FuseVersion.V1,
    // Re-stamp the ad-hoc signature after mutating the binary so unsigned
    // darwin builds (incl. arm64) still pass signature validation. Real code
    // signing happens after this hook and overwrites it.
    resetAdHocDarwinSignature: platform === 'darwin' || platform === 'mas',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  };
}

const FUSE_LABELS = {
  [FuseV1Options.RunAsNode]: 'RunAsNode',
  [FuseV1Options.EnableCookieEncryption]: 'EnableCookieEncryption',
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: 'EnableNodeOptionsEnvironmentVariable',
  [FuseV1Options.EnableNodeCliInspectArguments]: 'EnableNodeCliInspectArguments',
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: 'EnableEmbeddedAsarIntegrityValidation',
  [FuseV1Options.OnlyLoadAppFromAsar]: 'OnlyLoadAppFromAsar',
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: 'LoadBrowserProcessSpecificV8Snapshot',
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: 'GrantFileProtocolExtraPrivileges',
  [FuseV1Options.WasmTrapHandlers]: 'WasmTrapHandlers',
};

function resolveBinaryInsideAppBundle(appBundlePath) {
  // Packaged builds name the executable after the product; the unpackaged dev
  // Electron bundle keeps its own name. Fall back to the bundle's only
  // executable so the CLI also works on bare Electron.app copies.
  const packaged = join(appBundlePath, 'Contents', 'MacOS', PRODUCT_NAME);
  if (existsSync(packaged)) return packaged;

  const macosDir = join(appBundlePath, 'Contents', 'MacOS');
  const candidates = existsSync(macosDir)
    ? readdirSync(macosDir).filter((entry) => !entry.startsWith('.'))
    : [];
  if (candidates.length === 1) return join(macosDir, candidates[0]);
  throw new Error(`Could not locate the executable inside ${appBundlePath}`);
}

function resolveElectronBinary(candidate) {
  if (candidate.endsWith('.app')) {
    return resolveBinaryInsideAppBundle(candidate);
  }
  return candidate;
}

function localDevElectronBinary() {
  // `require('electron')` outside of a running Electron returns the path to
  // the local development binary.
  const require = createRequire(import.meta.url);
  return resolveElectronBinary(require('electron'));
}

function assertBinaryExists(binaryPath) {
  if (!existsSync(binaryPath)) {
    throw new Error(`Electron binary not found: ${binaryPath}`);
  }
}

async function printFuses(binaryPath) {
  assertBinaryExists(binaryPath);
  const wire = await getCurrentFuseWire(binaryPath);
  for (const [option, label] of Object.entries(FUSE_LABELS)) {
    const state = wire[option];
    const stateLabel =
      typeof state === 'number' ? (FUSE_STATE_LABELS.get(state) ?? String(state)) : 'n/a';
    console.log(`  ${label.padEnd(42)} ${stateLabel}`);
  }
}

async function writeFuses(binaryPath, platform) {
  assertBinaryExists(binaryPath);
  await flipFuses(binaryPath, fuseValues(platform));
  console.log(`Fuses written for ${binaryPath}`);
  await printFuses(binaryPath);
}

export async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;
  const binaryPath =
    electronPlatformName === 'darwin' || electronPlatformName === 'mas'
      ? resolveBinaryInsideAppBundle(join(appOutDir, `${PRODUCT_NAME}.app`))
      : join(appOutDir, `${PRODUCT_NAME}${electronPlatformName === 'win32' ? '.exe' : ''}`);
  await writeFuses(binaryPath, electronPlatformName);
}

async function runCli() {
  const [mode, target] = process.argv.slice(2);

  if (mode !== 'read' && mode !== 'write') {
    console.log('Usage:');
    console.log('  node scripts/fuses.mjs                (read fuses of the local dev Electron)');
    console.log('  node scripts/fuses.mjs read <binary|.app>');
    console.log('  node scripts/fuses.mjs write <binary|.app>');
    process.exitCode = mode ? 1 : 0;
    if (!mode) await printFuses(localDevElectronBinary());
    return;
  }

  if (!target) {
    console.error(`Missing target path for "${mode}".`);
    process.exitCode = 1;
    return;
  }

  const binaryPath = resolveElectronBinary(target);
  if (mode === 'read') {
    await printFuses(binaryPath);
  } else {
    await writeFuses(binaryPath, process.platform);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
