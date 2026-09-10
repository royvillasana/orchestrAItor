import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const dataDirectory = await mkdtemp(path.join(tmpdir(), 'orchestrai-smoke-'));
await mkdir('artifacts', { recursive: true });
const env = { ...process.env, ORCHESTRA_DATA_DIR: dataDirectory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ORCHESTRA_DEV;
const development = process.argv.includes('--dev');
if (development) env.ORCHESTRA_DEV = '1';
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ args: ['apps/desktop/dist/main.cjs'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.getByRole('heading', { name: 'Your next idea starts here.' }).waitFor();
  if (!development) {
    await page.context().setOffline(true);
    await page.reload();
  }
  return page;
}
function runtimePid() {
  const mainPid = app.process().pid;
  const rows = execFileSync('ps', ['-axo', 'pid,ppid,command'], { encoding: 'utf8' }).split('\n');
  const child = rows
    .map((row) => row.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .find((row) => row && Number(row[2]) === mainPid && row[3].endsWith('/runtime.cjs'));
  assert.ok(child, 'The smoke test must identify its own runtime child before terminating it.');
  return Number(child[1]);
}
try {
  let page = await launch();
  await page.screenshot({ path: 'artifacts/connections.png', fullPage: true });
  const button = page.getByRole('button', { name: 'Open demo studio' });
  await button.click({ timeout: 25000 });
  await page.getByRole('heading', { name: 'Studio conversation' }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tempo"]')?.textContent === '122',
  );
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  await page.screenshot({ path: 'artifacts/workspace.png', fullPage: true });
  await page.getByLabel('Message Demo agent').fill('Inspect the project');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.waitForFunction(() =>
    document.body.innerText.includes('project.get_state: succeeded'),
  );
  await page.getByRole('button', { name: /^assist$/i }).click();
  await page.getByLabel('Message Demo agent').fill('Set tempo to 124 BPM');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor();
  assert.equal(await page.getByTestId('tempo').innerText(), '122');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('awaiting approval'));
  await page.getByLabel('Message Demo agent').fill('Set tempo to 124 BPM');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tempo"]')?.textContent === '124',
  );
  await page.getByRole('button', { name: 'Play transport', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('PLAYING'));
  await page.getByRole('button', { name: 'Undo change ↶', exact: true }).first().click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('STOPPED'));
  await page.reload();
  await page.getByRole('heading', { name: 'Studio conversation' }).waitFor();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tempo"]')?.textContent === '124',
  );
  await page.screenshot({ path: 'artifacts/activity.png', fullPage: true });
  const history = await page.evaluate(async () => (await window.orchestra.snapshot({})).history);
  assert.ok(history.messages.length >= 6);
  await app.close();
  app = null;
  page = await launch();
  await page.getByRole('button', { name: 'Open demo studio' }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tempo"]')?.textContent === '122',
  );
  const restored = await page.evaluate(async () => (await window.orchestra.snapshot({})).history);
  assert.equal(restored.messages.length, history.messages.length);
  assert.equal(restored.activities.length, history.activities.length);
  // Only terminate the runtime child belonging to this isolated test application.
  await page.getByLabel('Message Demo agent').fill('Set tempo to 130 BPM');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).waitFor();
  const pending = await page.evaluate(async () =>
    (await window.orchestra.snapshot({})).history.activities.find(
      (a) => a.status === 'awaiting-approval',
    ),
  );
  assert.ok(pending);
  process.kill(runtimePid(), 'SIGKILL');
  await page.getByRole('button', { name: 'Restart runtime', exact: true }).waitFor();
  await page.waitForFunction(
    async () =>
      !(await window.orchestra.snapshot({})).history.activities.some(
        (a) => a.status === 'awaiting-approval',
      ),
  );
  await page.getByRole('button', { name: 'Restart runtime', exact: true }).click();
  await page.getByRole('button', { name: 'Connect mock session', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="tempo"]')?.textContent === '122',
  );
  const afterCrash = await page.evaluate(async () => await window.orchestra.snapshot({}));
  assert.equal(
    afterCrash.history.activities.find((a) => a.id === pending.id).status,
    'interrupted',
  );
  assert.notEqual(afterCrash.runtime.sessionId, pending.sessionId);
  assert.equal(afterCrash.history.messages.length, history.messages.length + 2);
  const lastPid = runtimePid();
  await app.close();
  app = null;
  assert.throws(() => process.kill(lastPid, 0), { code: 'ESRCH' });
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${development ? 'development' : 'offline production'} Electron launch, isolation, chat, approval/cancel, tempo, transport, Undo, reload, persisted history, runtime crash/restart, and child cleanup.`,
  );
  console.log(
    `Screenshots: artifacts/workspace.png and artifacts/activity.png. Temporary data: ${dataDirectory}`,
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.error(await page.locator('body').innerText());
    console.error(errors);
    await page.screenshot({ path: 'artifacts/smoke-failure.png', fullPage: true });
  }
  throw error;
} finally {
  await app?.close();
}
