/**
 * Copies the MIDI Remote driver script into Cubase's user driver-scripts
 * folder. Cubase reads this folder at startup, so the folder can be created
 * before Cubase has ever been launched.
 */
import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const source = path.resolve('resources/cubase/orchestrai_bridge.js');
const base =
  process.platform === 'win32'
    ? path.join(homedir(), 'Documents', 'Steinberg')
    : path.join(homedir(), 'Documents', 'Steinberg');
let products = [];
try {
  products = (await readdir(base, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^(Cubase|Nuendo)/i.test(entry.name))
    .map((entry) => entry.name);
} catch {
  /* Cubase has not created its user folder yet. */
}
// Cubase has never been launched, or is installed but unopened: install into
// the version-neutral folder it will read on first start.
if (products.length === 0) products = ['Cubase'];
const installed = [];
for (const product of products) {
  const directory = path.join(
    base,
    product,
    'MIDI Remote',
    'Driver Scripts',
    'Local',
    'OrchestrAI',
    'Bridge',
  );
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, 'orchestrai_bridge.js');
  await copyFile(source, target);
  installed.push(target);
}
console.log(
  `Installed the OrchestrAI driver script:\n${installed.map((p) => `  ${p}`).join('\n')}`,
);
console.log(
  '\nNext: start Cubase, connect the live bridge in OrchestrAI so the "OrchestrAI Bridge" ports appear,\nthen pair the script in Cubase’s MIDI Remote Manager.',
);
