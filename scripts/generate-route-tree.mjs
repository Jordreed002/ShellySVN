import { resolve } from 'node:path';
import { Generator, getConfig } from '@tanstack/router-generator';

const root = process.cwd();
const config = getConfig(
  {
    target: 'react',
    autoCodeSplitting: true,
    routesDirectory: resolve(root, 'src/renderer/src/routes'),
    generatedRouteTree: resolve(root, 'src/renderer/src/routeTree.gen.ts'),
  },
  root
);

await new Generator({ config, root }).run();
