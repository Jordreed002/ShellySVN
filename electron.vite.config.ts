import { gzipSync } from 'zlib';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import type { Plugin, OutputBundle, OutputChunk } from 'rollup';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function getTopModules(chunk: OutputChunk, limit = 15): Array<{ id: string; bytes: number }> {
  return Object.entries(chunk.modules)
    .map(([id, moduleInfo]) => ({ id, bytes: moduleInfo.renderedLength }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}

function getInitialChunkNames(
  chunks: Array<{ fileName: string; isEntry: boolean; imports: string[] }>
) {
  const chunkByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const initialChunkNames = new Set<string>();

  const visit = (fileName: string) => {
    if (initialChunkNames.has(fileName)) return;
    const chunk = chunkByFileName.get(fileName);
    if (!chunk) return;

    initialChunkNames.add(fileName);
    for (const importFileName of chunk.imports) {
      visit(importFileName);
    }
  };

  for (const chunk of chunks) {
    if (chunk.isEntry) {
      visit(chunk.fileName);
    }
  }

  return initialChunkNames;
}

function createRendererBundleReportPlugin(): Plugin {
  return {
    name: 'shellysvn-renderer-bundle-report',
    generateBundle(_options, bundle: OutputBundle) {
      if (process.env.SHELLYSVN_BUNDLE_REPORT !== '1') return;

      const chunks = Object.values(bundle)
        .filter((item): item is OutputChunk => item.type === 'chunk')
        .map((chunk) => ({
          fileName: chunk.fileName,
          bytes: Buffer.byteLength(chunk.code, 'utf8'),
          gzipBytes: gzipSync(chunk.code).byteLength,
          isEntry: chunk.isEntry,
          isDynamicEntry: chunk.isDynamicEntry,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          topModules: getTopModules(chunk),
        }))
        .sort((a, b) => b.bytes - a.bytes);

      const assets = Object.values(bundle)
        .filter((item) => item.type === 'asset')
        .map((asset) => ({
          fileName: asset.fileName,
          bytes: Buffer.byteLength(
            typeof asset.source === 'string' ? asset.source : Buffer.from(asset.source)
          ),
        }))
        .sort((a, b) => b.bytes - a.bytes);

      const report = {
        generatedAt: new Date().toISOString(),
        rendererChunks: chunks,
        rendererAssets: assets,
      };

      const reportDir = resolve(__dirname, 'reports/bundle');
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(
        resolve(reportDir, 'renderer-bundle-report.json'),
        `${JSON.stringify(report, null, 2)}\n`
      );

      const initialChunkNames = getInitialChunkNames(chunks);
      const initialChunks = chunks.filter((chunk) => initialChunkNames.has(chunk.fileName));
      const lines = [
        '# Renderer Bundle Report',
        '',
        `Generated: ${report.generatedAt}`,
        '',
        '## Initial Renderer Chunks',
        '',
        '| Chunk | Size | Gzip | Top Modules |',
        '| --- | ---: | ---: | --- |',
        ...initialChunks.map((chunk) => {
          const topModules = chunk.topModules
            .slice(0, 5)
            .map((module) => `${module.id} (${formatBytes(module.bytes)})`)
            .join('<br>');
          return `| \`${chunk.fileName}\` | ${formatBytes(chunk.bytes)} | ${formatBytes(chunk.gzipBytes)} | ${topModules} |`;
        }),
        '',
        '## All Renderer Chunks',
        '',
        '| Chunk | Size | Gzip | Entry | Dynamic Entry |',
        '| --- | ---: | ---: | --- | --- |',
        ...chunks.map(
          (chunk) =>
            `| \`${chunk.fileName}\` | ${formatBytes(chunk.bytes)} | ${formatBytes(chunk.gzipBytes)} | ${chunk.isEntry ? 'yes' : 'no'} | ${chunk.isDynamicEntry ? 'yes' : 'no'} |`
        ),
        '',
      ];

      writeFileSync(resolve(reportDir, 'renderer-bundle-report.md'), `${lines.join('\n')}\n`);
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('packages/shared/src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@preload': resolve('src/preload'),
        '@shared': resolve('packages/shared/src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    base: './',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('packages/shared/src'),
      },
    },
    plugins: [
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolve(__dirname, 'src/renderer/src/routes'),
        generatedRouteTree: resolve(__dirname, 'src/renderer/src/routeTree.gen.ts'),
      }),
      react(),
      createRendererBundleReportPlugin(),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
