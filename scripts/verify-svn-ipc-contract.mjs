#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const preloadSource = readFileSync('src/preload/api/svn.ts', 'utf8');
const mainSource = readFileSync('src/main/ipc/svn.ts', 'utf8');
const contractSource = readFileSync('packages/shared/src/ipc-contract.ts', 'utf8');
const preloadTestSource = readFileSync('src/preload/api/__tests__/svn.test.ts', 'utf8');
const eventBoundary = contractSource.indexOf('export type IpcEventContract');

if (eventBoundary < 0) {
  throw new Error('Unable to locate IpcEventContract');
}

function channels(source) {
  return new Set([...source.matchAll(/['"](svn:[\w:-]+)['"]/g)].map((match) => match[1]));
}

function handlerChannels(source) {
  return new Set(
    [...source.matchAll(/ipcMain\.handle\(\s*['"](svn:[\w:-]+)['"]/g)].map((match) => match[1])
  );
}

const preloadChannels = channels(preloadSource);
const mainHandlers = handlerChannels(mainSource);
const invokeContract = channels(contractSource.slice(0, eventBoundary));
const eventContract = channels(contractSource.slice(eventBoundary));
const preloadInvokes = new Set(
  [...preloadChannels].filter((channel) => !eventContract.has(channel))
);
const testedInvokeChannels = channels(preloadTestSource);

function difference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

const failures = [
  ['preload calls without main handlers', difference(preloadInvokes, mainHandlers)],
  ['main handlers absent from preload', difference(mainHandlers, preloadInvokes)],
  ['preload calls absent from invoke contract', difference(preloadInvokes, invokeContract)],
  ['invoke contract channels absent from preload', difference(invokeContract, preloadInvokes)],
  [
    'invoke contract channels without an exact preload argument test',
    difference(invokeContract, testedInvokeChannels),
  ],
];

const violations = failures.filter(([, values]) => values.length > 0);
if (violations.length > 0) {
  for (const [label, values] of violations) {
    console.error(`${label}: ${values.join(', ')}`);
  }
  process.exit(1);
}

console.log(
  `SVN IPC contract verified: ${mainHandlers.size} invoke channels and ${eventContract.size} event channels.`
);
