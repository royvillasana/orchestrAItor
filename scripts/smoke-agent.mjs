/**
 * Electron workflow for a live agent session: verify the CLI's sign-in, select
 * it as the creative partner, connect it alongside the live bridge, and let a
 * real model drive the session through the permission path.
 *
 * Requires an installed, signed-in CLI and the optional MIDI backend; skips
 * cleanly otherwise. This one costs model usage, so it is not part of `pnpm test`.
 */
import { _electron as electron } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startCubasePeer } from './cubase-peer.mjs';
import { until } from './until.mjs';

const require_ = createRequire(import.meta.url);
try {
  require_.resolve('@julusian/midi');
} catch {
  console.log('SKIP: the optional MIDI backend is not installed.');
  process.exit(0);
}
const peer = await startCubasePeer({ tempo: 120 });
const dataDirectory = await mkdtemp(path.join(tmpdir(), 'orchestrai-agent-smoke-'));
const env = { ...process.env, ORCHESTRA_DATA_DIR: dataDirectory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ORCHESTRA_DEV;
let app;
try {
  app = await electron.launch({ args: ['apps/desktop/dist/main.cjs'], env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Your next idea starts here.' }).waitFor();
  await page.getByRole('button', { name: /Refresh detection/ }).click();
  await until(
    page,
    async () => (await window.orchestra.snapshot({})).midi?.ports ?? [],
    (ports) => ports.some((port) => port.name.includes('OrchestrAI Bridge')),
    { timeout: 15000, label: 'the bridge ports to be detected' },
  );
  // Discovery must never claim authentication it has not checked.
  const discovered = await page.evaluate(async () => (await window.orchestra.snapshot({})).agents);
  const claude = discovered.find((agent) => agent.id === 'claude-code');
  if (!claude?.installed) {
    console.log('SKIP: the Claude Code CLI is not installed.');
    process.exit(0);
  }
  assert.equal(claude.authentication, 'unverified', 'Discovery alone must not claim a sign-in.');

  // Verification runs in the runtime child; call it and read its own result
  // rather than whichever poll happened to land first.
  const verified = await page.evaluate(async () => {
    const snapshot = await window.orchestra.verify({ agent: 'claude' });
    return {
      agent: snapshot.agents.find((agent) => agent.id === 'claude-code'),
      error: snapshot.error,
    };
  });
  if (verified.agent?.authentication !== 'authenticated') {
    console.log(`SKIP: Claude Code is not signed in: ${JSON.stringify(verified)}`);
    process.exit(0);
  }
  // The button a producer would use must exist while the CLI is unverified.
  await page
    .getByRole('button', { name: 'Verify sign-in' })
    .first()
    .click()
    .catch(() => {});
  console.log(`verified: ${verified.agent.account} · ${verified.agent.version}`);

  await page.getByRole('radio', { name: /Claude Code/ }).click();
  await page.getByRole('radio', { name: /Cubase . Live bridge/ }).click();
  const body = await page.locator('body').innerText();
  assert.match(
    body,
    /sends this conversation and project state/i,
    'Network use must be disclosed.',
  );
  await page.getByRole('button', { name: 'Connect live session' }).click();
  await page.getByRole('heading', { name: 'Studio conversation' }).waitFor({ timeout: 40000 });
  const state = await page.evaluate(async () => (await window.orchestra.snapshot({})).runtime);
  assert.equal(state.provider, 'claude');
  assert.equal(state.providerLive, true);
  assert.equal(state.adapter, 'bridge');

  await page.getByRole('button', { name: /^assist$/i }).click();
  await page
    .getByLabel(/^Message /)
    .fill('What tempo is this project, and please set it to 126 BPM.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor({ timeout: 180000 });
  assert.equal(await page.getByTestId('tempo').innerText(), '120', 'No write before approval.');
  const proposed = await page.evaluate(async () => (await window.orchestra.snapshot({})).history);
  assert.ok(
    proposed.activities.some((activity) => activity.agent === 'claude'),
    'The live agent must own the activities it created.',
  );
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tempo"]')?.textContent === '126',
    null,
    { timeout: 30000 },
  );
  // The agent's answer is persisted when its turn ends, which can be after the
  // approval prompt appears.
  await until(
    page,
    async () => (await window.orchestra.snapshot({})).history.messages,
    (messages) => messages.some((message) => message.provider === 'Claude Code'),
    { timeout: 120000, label: "the live agent's answer to be persisted" },
  );
  // The transcript must attribute the answer to the provider that produced it.
  const transcript = await page.locator('body').innerText();
  assert.doesNotMatch(transcript, /Demo agent/, 'A live answer must not be labelled Demo agent.');
  assert.match(transcript, /Claude Code/);
  const call = [...peer.api.log].reverse().find((entry) => entry.call === 'setTempoBPM');
  assert.ok(call && call.bpm === 126, 'The approved write must reach the driver script.');
  // The agent can reach the producer's own sounds through the same read path.
  if (process.env.ORCHESTRA_SAMPLE_FOLDER) {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, process.env.ORCHESTRA_SAMPLE_FOLDER);
    await page.evaluate(async () => await window.orchestra.addSampleFolder({}));
    const library = await until(
      page,
      async () => (await window.orchestra.snapshot({})).library,
      (value) => value.total > 0,
      { timeout: 60000, label: 'the sample folder to index' },
    );
    console.log(`library: ${library.total} samples indexed`);
    // Count what is already there: the tempo turn has answers of its own.
    const before = (
      await page.evaluate(async () => (await window.orchestra.snapshot({})).history.messages)
    ).filter((message) => message.role === 'assistant').length;
    await page.getByLabel(/^Message /).fill('Find me a kick sample and tell me its full path.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const messages = await until(
      page,
      async () => (await window.orchestra.snapshot({})).history.messages,
      (value) => value.filter((message) => message.role === 'assistant').length > before,
      { timeout: 180000, label: "the agent's sample answer" },
    );
    const answer = messages.filter((message) => message.role === 'assistant').at(-1).content;
    console.log(`agent said: ${answer.slice(0, 200).replace(/\n/g, ' ')}`);
    // A cited path must be real, not invented.
    assert.match(answer, /Kick/i, 'The agent must name a sample it actually found.');
    assert.ok(
      answer.includes(process.env.ORCHESTRA_SAMPLE_FOLDER) ||
        answer.includes(path.basename(process.env.ORCHESTRA_SAMPLE_FOLDER)),
      'The agent must cite the real indexed path.',
    );
    const searched = await page.evaluate(
      async () => (await window.orchestra.snapshot({})).history.activities,
    );
    assert.ok(
      searched.some(
        (activity) => activity.tool === 'samples.search' && activity.agent === 'claude',
      ),
      'The agent must have used samples.search rather than guessing.',
    );
  }
  await page.screenshot({ path: 'artifacts/agent-live.png', fullPage: true });
  console.log(
    'PASS: verification, live partner selection, agent tool calls through the permission path, and an approved write reaching the session.',
  );
} finally {
  await app?.close();
  peer.stop();
}
