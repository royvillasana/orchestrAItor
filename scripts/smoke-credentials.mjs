/**
 * Electron workflow for API credentials: store a key through the interface,
 * confirm the renderer only ever learns that one exists, confirm the plaintext
 * is not readable in the local database, and remove it again.
 *
 * Runs against the real OS credential store; no network call is made, so the
 * key used here is deliberately not a working one.
 */
import { _electron as electron } from 'playwright';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { until } from './until.mjs';

const KEY = 'sk-not-a-real-key-000000000000009876';
const dataDirectory = await mkdtemp(path.join(tmpdir(), 'orchestrai-credentials-smoke-'));
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
  const available = await app.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable());
  if (!available) {
    // The refusal is the feature on such a system; assert it and stop.
    const refused = await page.evaluate(async () =>
      window.orchestra
        .setApiKey({ provider: 'openai', key: 'sk-x' })
        .then(() => null)
        .catch((error) => String(error.message)),
    );
    assert.match(String(refused), /credential store/i, 'A key must be refused, never stored bare.');
    console.log('PASS: no credential store on this system, and the key was refused.');
    process.exit(0);
  }

  // The partner is unselectable until a key exists, so the field lives on the
  // card itself rather than behind the selection it is a prerequisite for.
  const openai = page.getByRole('radio', { name: /OpenAI/ });
  assert.equal(await openai.isEnabled(), false, 'OpenAI must not be selectable without a key.');
  const before = await page.evaluate(async () => (await window.orchestra.snapshot({})).credentials);
  assert.deepEqual(before, [{ provider: 'openai', stored: false, hint: null, storage: 'os' }]);

  await page.getByLabel('OpenAI API key').fill(KEY);
  await page.getByRole('button', { name: 'Save key' }).click();
  const stored = await until(
    page,
    async () => (await window.orchestra.snapshot({})).credentials,
    (value) => value[0]?.stored === true,
    { timeout: 15000, label: 'the key to be stored' },
  );
  assert.deepEqual(stored, [{ provider: 'openai', stored: true, hint: '9876', storage: 'os' }]);
  // The field is cleared and never repopulated: the key is not readable back.
  assert.equal(await page.getByLabel('OpenAI API key').inputValue(), '');
  const snapshot = await page.evaluate(async () =>
    JSON.stringify(await window.orchestra.snapshot({})),
  );
  assert.equal(snapshot.includes(KEY), false, 'The key must never reach the renderer.');

  // On disk it is ciphertext from the OS credential store.
  const database = await readFile(path.join(dataDirectory, 'orchestrai.sqlite'));
  assert.equal(database.includes(KEY), false, 'The key must not be readable in the database.');
  assert.ok(database.includes('secret.openai'), 'The encrypted row is where it is expected.');

  // It survives a restart, which is the point of storing it at all.
  await app.close();
  app = await electron.launch({ args: ['apps/desktop/dist/main.cjs'], env, timeout: 30000 });
  const restarted = await app.firstWindow();
  await restarted.getByRole('heading', { name: 'Your next idea starts here.' }).waitFor();
  const reloaded = await until(
    restarted,
    async () => (await window.orchestra.snapshot({})).credentials,
    (value) => value[0]?.stored === true,
    { timeout: 15000, label: 'the stored key to load at startup' },
  );
  assert.deepEqual(reloaded, [{ provider: 'openai', stored: true, hint: '9876', storage: 'os' }]);
  // The runtime holds it too, so OpenAI is selectable without re-entering it.
  const selected = await restarted.evaluate(async () =>
    window.orchestra
      .setProvider({ provider: 'openai' })
      .then(() => 'ok')
      .catch((error) => String(error.message)),
  );
  assert.equal(selected, 'ok', `OpenAI must be selectable after a restart: ${selected}`);

  // A replacement must be what the next turn actually sends: the runtime
  // rebuilds the session rather than keeping the transport it already had.
  await restarted.getByRole('radio', { name: /OpenAI/ }).click();
  await restarted.getByLabel('OpenAI API key').fill('sk-not-a-real-key-000000000000001111');
  await restarted.getByRole('button', { name: 'Save key' }).click();
  const replaced = await until(
    restarted,
    async () => (await window.orchestra.snapshot({})).credentials,
    (value) => value[0]?.hint === '1111',
    { timeout: 15000, label: 'the replacement key to be stored' },
  );
  assert.equal(replaced[0].stored, true);
  const still = await restarted.evaluate(async () => (await window.orchestra.snapshot({})).runtime);
  assert.equal(still.provider, 'openai', 'Replacing a key must not drop the session.');

  await restarted.getByRole('button', { name: 'Remove' }).click();
  const cleared = await until(
    restarted,
    async () => (await window.orchestra.snapshot({})).credentials,
    (value) => value[0]?.stored === false,
    { timeout: 15000, label: 'the key to be forgotten' },
  );
  assert.deepEqual(cleared, [{ provider: 'openai', stored: false, hint: null, storage: 'os' }]);
  // A session left holding a key that no longer exists falls back rather than
  // continuing to send it.
  const fallback = await until(
    restarted,
    async () => (await window.orchestra.snapshot({})).runtime,
    (value) => value?.provider === 'demo',
    { timeout: 15000, label: 'the session to fall back to the Demo agent' },
  );
  assert.equal(fallback.providerLive, false);
  const after = await readFile(path.join(dataDirectory, 'orchestrai.sqlite'));
  assert.equal(after.includes(KEY), false);
  await restarted.screenshot({ path: 'artifacts/credentials.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: a key is stored encrypted, described to the renderer only as a hint, survives a restart, is replaceable without dropping the session, and on removal the session falls back to the Demo agent.',
  );
} finally {
  await app?.close();
}
