import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
await mkdir('apps/desktop/dist', { recursive: true });
await build({
  entryPoints: {
    main: 'apps/desktop/electron/main.ts',
    preload: 'apps/desktop/electron/preload.ts',
    runtime: 'packages/mcp-server/src/entry.ts',
    database: 'apps/desktop/electron/database-worker.ts',
  },
  outdir: 'apps/desktop/dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
});
await copyFile(require.resolve('sql.js/dist/sql-wasm.wasm'), 'apps/desktop/dist/sql-wasm.wasm');
