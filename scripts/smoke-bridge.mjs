/**
 * Electron smoke workflow for a live bridge session, without Cubase.
 *
 * Publishes the shipped driver script on real CoreMIDI endpoints, then drives
 * the built desktop application through selecting the bridge, connecting, and
 * approving a write against the live session — asserting throughout that the
 * interface never labels that session as mock state.
 */
import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startCubasePeer } from './cubase-peer.mjs';
import { until, untilEnabled } from './until.mjs';

const require_ = createRequire(import.meta.url);
try {
  require_.resolve('@julusian/midi');
} catch {
  console.log('SKIP: the optional MIDI backend is not installed (pnpm add -w -D @julusian/midi).');
  process.exit(0);
}
const probe = new (require_('@julusian/midi').Input)();
const conflicting = Array.from({ length: probe.getPortCount() }, (_, index) =>
  probe.getPortName(index),
).filter((name) => name.includes('OrchestrAI Bridge'));
probe.closePort();
assert.equal(
  conflicting.length,
  0,
  `An "OrchestrAI Bridge" port is already published (${conflicting.join(', ')}). Stop any standalone peer first.`,
);

const peer = await startCubasePeer({ tempo: 120 });
const dataDirectory = await mkdtemp(path.join(tmpdir(), 'orchestrai-bridge-smoke-'));
const env = { ...process.env, ORCHESTRA_DATA_DIR: dataDirectory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ORCHESTRA_DEV;
let app;
const errors = [];
try {
  app = await electron.launch({ args: ['apps/desktop/dist/main.cjs'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.getByRole('heading', { name: 'Your next idea starts here.' }).waitFor();
  await page.getByRole('button', { name: /Refresh detection/ }).click();
  await until(
    page,
    async () => (await window.orchestra.snapshot({})).midi?.ports ?? [],
    (ports) => ports.some((port) => port.name.includes('OrchestrAI Bridge')),
    { timeout: 15000, label: 'the bridge ports to be detected' },
  );
  const bridge = page.getByRole('radio', { name: /Cubase . Live bridge/ });
  // The renderer polls, so main-process state is not yet state on screen, and a
  // detection refresh in flight disables controls meanwhile. Poll the control.
  await untilEnabled(bridge, { label: 'the bridge option' });
  assert.equal(await bridge.isDisabled(), false, 'The bridge must be selectable with a backend.');
  await bridge.click();
  await page.getByRole('button', { name: 'Connect live session' }).click();
  await page.getByRole('heading', { name: 'Studio conversation' }).waitFor({ timeout: 40000 });

  const state = await page.evaluate(async () => (await window.orchestra.snapshot({})).runtime);
  assert.equal(state.adapter, 'bridge');
  assert.equal(state.daw, 'Cubase (MIDI Remote)');
  assert.equal(state.project.mock, false);
  assert.equal(state.project.tempo, 120);

  // A live session must never be presented with mock labelling.
  const body = await page.locator('body').innerText();
  for (const forbidden of [/MOCK/, /Mock transport/, /Cubase Mock/, /real DAW is not connected/])
    assert.doesNotMatch(body, forbidden, `Live session shows mock labelling: ${forbidden}`);
  assert.match(body, /LIVE/);
  assert.match(body, /Cubase \(MIDI Remote\)/);

  await page.getByRole('button', { name: /^assist$/i }).click();
  await page.getByLabel(/^Message /).fill('Set tempo to 124 BPM');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await page.getByTestId('tempo').innerText(), '120', 'No write before approval.');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tempo"]')?.textContent === '124',
    null,
    { timeout: 20000 },
  );
  const applied = await page.locator('body').innerText();
  assert.match(applied, /\(live\)/, 'The activity card must record a live outcome.');
  assert.doesNotMatch(applied, /\(mock\)/);
  // The write reached the driver script as the documented Cubase call.
  const call = [...peer.api.log].reverse().find((entry) => entry.call === 'setTempoBPM');
  assert.ok(call && call.bpm === 124, 'setTempoBPM must receive the approved tempo.');
  await page.screenshot({ path: 'artifacts/bridge-live.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: bridge selection, real-MIDI handshake, live session labelling, approval, and setTempoBPM(124).',
  );
  console.log(`Screenshot: artifacts/bridge-live.png. Temporary data: ${dataDirectory}`);
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.error(await page.locator('body').innerText());
    console.error(errors);
    await page.screenshot({ path: 'artifacts/bridge-smoke-failure.png', fullPage: true });
  }
  throw error;
} finally {
  await app?.close();
  peer.stop();
}
