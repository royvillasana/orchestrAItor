/**
 * Electron workflow for sample libraries: index a real folder, search it from
 * the interface, preview a result through the confined protocol, and confirm a
 * path outside the index is refused.
 *
 * The folder picker is a native dialog, so it is stubbed in the main process
 * rather than widening the IPC surface with a caller-supplied path.
 */
import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { until } from './until.mjs';

const libraryFolder = process.argv[2];
assert.ok(libraryFolder, 'Pass the sample folder to index as the first argument.');
const dataDirectory = await mkdtemp(path.join(tmpdir(), 'orchestrai-samples-smoke-'));
const env = { ...process.env, ORCHESTRA_DATA_DIR: dataDirectory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ORCHESTRA_DEV;
let app;
const errors = [];
try {
  app = await electron.launch({ args: ['apps/desktop/dist/main.cjs'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'Your next idea starts here.' }).waitFor();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, libraryFolder);

  await page.getByRole('button', { name: 'Add folder' }).click();
  const library = await until(
    page,
    async () => (await window.orchestra.snapshot({})).library,
    (value) => value.total > 0,
    { timeout: 60000, label: 'the folder to finish indexing' },
  );
  console.log(`indexed ${library.total} samples from ${library.roots.length} folder(s)`);
  assert.equal(library.roots.length, 1);
  assert.equal(library.total, 7, 'Only audio files are indexed.');
  assert.equal(library.roots[0].truncated, false);
  assert.equal(library.roots[0].error, null);

  // Re-indexing an unchanged folder must not duplicate anything.
  await page.getByRole('button', { name: 'Re-index' }).click();
  await until(
    page,
    async () => (await window.orchestra.snapshot({})).indexing,
    (value) => value === null,
    { timeout: 60000, label: 're-index to finish' },
  );
  assert.equal(
    (await page.evaluate(async () => (await window.orchestra.snapshot({})).library)).total,
    7,
    'Re-index must not duplicate samples.',
  );

  await page.getByRole('button', { name: 'Open demo studio' }).click();
  await page.getByRole('heading', { name: 'Studio conversation' }).waitFor();
  await page.getByLabel('Search samples').fill('kick');
  await page.getByLabel('Search samples').press('Enter');
  const results = await until(
    page,
    async () => (await window.orchestra.snapshot({})).samples,
    (value) => value.length > 0,
    { timeout: 20000, label: 'search results' },
  );
  console.log(`search "kick" -> ${results.map((sample) => sample.name).join(', ')}`);
  assert.ok(
    results.every((sample) => sample.name.toLowerCase().includes('kick')),
    'Every result must match the query.',
  );
  assert.ok(results[0].durationMs > 0 && results[0].sampleRate === 44100, 'Header facts are read.');

  // Preview goes through the confined protocol as media, which is the only way
  // the renderer may reach it: the scheme supports no fetch and CSP allows it
  // under media-src alone.
  const load = (file) =>
    page.evaluate(
      (target) =>
        new Promise((resolve) => {
          const audio = new Audio(`orchestra-sample://local${encodeURI(target)}`);
          audio.addEventListener('loadedmetadata', () =>
            resolve({ ok: true, duration: audio.duration }),
          );
          audio.addEventListener('error', () => resolve({ ok: false }));
          setTimeout(() => resolve({ ok: false, timedOut: true }), 8000);
        }),
      file,
    );
  const indexed = results[0].path;
  const played = await load(indexed);
  console.log(`preview ${path.basename(indexed)} -> ${JSON.stringify(played)}`);
  assert.ok(played.ok && played.duration > 0, 'An indexed sample must play.');
  // A real file that was never indexed must not be reachable.
  const refused = await load('/etc/hosts');
  assert.equal(refused.ok, false, 'A file outside the index must not be served.');
  const outside = await load(path.join(path.dirname(libraryFolder), 'nothing-here.wav'));
  assert.equal(outside.ok, false);
  console.log('preview confinement: unindexed paths refused');

  await page
    .getByRole('button', { name: /Deep_Kick|Punchy_Kick/ })
    .first()
    .click();
  await page.waitForSelector('audio', { timeout: 10000 });

  await page.screenshot({ path: 'artifacts/samples.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: indexing, incremental re-index, search, header facts, and confined preview.');
} catch (error) {
  if (app) await (await app.firstWindow()).screenshot({ path: 'artifacts/samples-failure.png' });
  throw error;
} finally {
  await app?.close();
}
