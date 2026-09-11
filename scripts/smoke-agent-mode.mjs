/**
 * Electron workflow for Agent mode: a live agent making changes without a
 * prompt, inside a budget the producer set, then stopped and undone.
 *
 * Costs model usage, so it is not part of `pnpm test`. Skips cleanly when the
 * MIDI backend or a signed-in CLI is missing.
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
  console.log('SKIP: the optional MIDI backend is not installed.');
  process.exit(0);
}
const probe = new (require_('@julusian/midi').Input)();
const conflicting = Array.from({ length: probe.getPortCount() }, (_, index) =>
  probe.getPortName(index),
).filter((name) => name.includes('OrchestrAI Bridge'));
probe.closePort();
assert.equal(conflicting.length, 0, 'Stop any standalone peer first.');

const peer = await startCubasePeer({ tempo: 120 });
const dataDirectory = await mkdtemp(path.join(tmpdir(), 'orchestrai-agentmode-'));
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
  await page.getByRole('button', { name: /Refresh detection/ }).click();
  const verified = await page.evaluate(async () => {
    const snapshot = await window.orchestra.verify({ agent: 'claude' });
    return snapshot.agents.find((agent) => agent.id === 'claude-code');
  });
  if (verified?.authentication !== 'authenticated') {
    console.log('SKIP: Claude Code is not signed in.');
    process.exit(0);
  }
  await until(
    page,
    async () => (await window.orchestra.snapshot({})).midi?.ports ?? [],
    (ports) => ports.some((port) => port.name.includes('OrchestrAI Bridge')),
    { timeout: 15000, label: 'the bridge ports' },
  );
  const partner = page.getByRole('radio', { name: /Claude Code/ });
  await untilEnabled(partner, { label: 'the partner option' });
  await partner.click();
  const bridge = page.getByRole('radio', { name: /Cubase . Live bridge/ });
  await untilEnabled(bridge, { label: 'the bridge option' });
  await bridge.click();
  await page.getByRole('button', { name: /Connect live session|Back to the studio/ }).click();
  await page.getByRole('heading', { name: 'Studio conversation' }).waitFor({ timeout: 40000 });

  // Agent mode is never on until it is chosen, and the mode alone is not a run.
  assert.equal(
    await page.evaluate(async () => (await window.orchestra.snapshot({})).runtime.mode),
    'ask',
  );
  await page.getByRole('button', { name: 'agent', exact: true }).click();
  await until(
    page,
    async () => (await window.orchestra.snapshot({})).runtime.mode,
    (mode) => mode === 'agent',
    { timeout: 10000, label: 'agent mode' },
  );
  assert.equal(
    await page.evaluate(async () => (await window.orchestra.snapshot({})).runtime.run),
    null,
    'The mode alone must not be a run.',
  );
  // The renderer polls, so the panel is not on screen the instant the mode is.
  await until(
    page,
    () => document.body.innerText,
    (text) => /without asking/i.test(text),
    { timeout: 15000, label: 'the agent mode disclosure' },
  );

  await page.getByRole('button', { name: 'Start run' }).click();
  const started = await until(
    page,
    async () => (await window.orchestra.snapshot({})).runtime.run,
    (run) => !!run && !run.endedAt,
    { timeout: 15000, label: 'the run to start' },
  );
  console.log(`run started: ${started.budget.maxWrites} changes, ${started.budget.maxSeconds}s`);
  const before = await page.evaluate(
    async () => (await window.orchestra.snapshot({})).runtime.project,
  );

  await page
    .getByLabel(/^Message /)
    .fill('Set the tempo to 128 and set the Kick track fader to 50%. Make both changes now.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const run = await until(
    page,
    async () => (await window.orchestra.snapshot({})).runtime.run,
    (value) => value.writes >= 2 || !!value.endedAt,
    { timeout: 180000, label: 'the autonomous changes' },
  );
  const history = await page.evaluate(async () => (await window.orchestra.snapshot({})).history);
  const autonomous = history.activities.filter(
    (activity) => activity.runId === run.id && activity.status === 'succeeded',
  );
  console.log(
    `run made ${run.writes} change(s) with no approval: ${autonomous.map((a) => a.tool).join(', ')}`,
  );
  assert.ok(autonomous.length >= 2, 'The run should have changed the session without approval.');
  // Nothing waited: that is the whole difference from Assist.
  assert.equal(
    history.activities.filter((activity) => activity.status === 'awaiting-approval').length,
    0,
    'Nothing should have waited for approval during a run.',
  );
  const after = await page.evaluate(
    async () => (await window.orchestra.snapshot({})).runtime.project,
  );
  assert.notEqual(after.tempo, before.tempo);
  console.log(`tempo ${before.tempo} -> ${after.tempo}`);

  await page
    .getByRole('button', { name: 'Stop run' })
    .click()
    .catch(() => {});
  await until(
    page,
    async () => (await window.orchestra.snapshot({})).runtime.run,
    (value) => !!value.endedAt,
    { timeout: 15000, label: 'the run to end' },
  );
  await page.getByRole('button', { name: 'Undo the run' }).click();
  await until(
    page,
    async () => (await window.orchestra.snapshot({})).runtime.project,
    (project) =>
      project.tempo === before.tempo &&
      project.tracks.every(
        (track, index) =>
          track.volume === before.tracks[index].volume && track.mute === before.tracks[index].mute,
      ),
    { timeout: 30000, label: 'the run undo' },
  );
  console.log(`undo restored the session to ${before.tempo} BPM and its original levels`);
  await page.screenshot({ path: 'artifacts/agent-mode.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: a bounded autonomous run, stopped and undone.');
} finally {
  await app?.close();
  peer.stop();
}
