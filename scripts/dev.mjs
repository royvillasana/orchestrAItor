import { spawn } from 'node:child_process';
import electron from 'electron';
const children = [];
const run = (command, args, env = process.env) => {
  const child = spawn(command, args, { stdio: 'inherit', env });
  children.push(child);
  return child;
};
const build = run(process.execPath, ['scripts/build.mjs']);
await new Promise((resolve, reject) =>
  build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Desktop build failed.')))),
);
const next = run(process.execPath, [
  'apps/desktop/node_modules/next/dist/bin/next',
  'dev',
  'apps/desktop/renderer',
  '--hostname',
  '127.0.0.1',
  '--port',
  '3210',
]);
let ready = false;
for (let i = 0; i < 120; i++) {
  try {
    const response = await fetch('http://127.0.0.1:3210');
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    /* The development server may still be compiling its first page. */
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) {
  next.kill();
  throw new Error('Next.js did not start on port 3210.');
}
const env = { ...process.env, ORCHESTRA_DEV: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = run(electron, ['apps/desktop/dist/main.cjs'], env);
const close = () => {
  for (const child of children) child.kill();
};
desktop.on('exit', close);
process.on('SIGINT', close);
process.on('SIGTERM', close);
