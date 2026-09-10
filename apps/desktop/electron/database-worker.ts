import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { idSchema, storeCommandSchema, errorText } from '@orchestrai/shared-types';
import { LocalStore } from './store';
const inputSchema = z.object({ id: idSchema, command: storeCommandSchema }).strict();
async function main() {
  const config = z.object({ file: z.string(), wasmPath: z.string() }).strict().parse(workerData);
  const store = await LocalStore.open(config.file, config.wasmPath);
  store.execute({ type: 'interrupt' });
  parentPort!.postMessage({ ready: true });
  parentPort!.on('message', (raw) => {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return;
    const { id, command } = parsed.data;
    try {
      parentPort!.postMessage({ kind: 'reply', id, value: store.execute(command) });
    } catch (error) {
      parentPort!.postMessage({ kind: 'reply', id, error: errorText(error) });
    }
  });
}
void main().catch((error) => {
  throw new Error(errorText(error));
});
