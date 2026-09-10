import { contextBridge, ipcRenderer } from 'electron';
import {
  ipcInputs,
  snapshotSchema,
  type OrchestraAPI,
  type IpcMethod,
} from '@orchestrai/shared-types';
const api = Object.fromEntries(
  Object.entries(ipcInputs).map(([name, schema]) => [
    name,
    async (input: unknown) =>
      snapshotSchema.parse(await ipcRenderer.invoke(`orchestra:${name}`, schema.parse(input))),
  ]),
) as OrchestraAPI;
contextBridge.exposeInMainWorld('orchestra', Object.freeze(api));
// The renderer gets only the fixed methods above, never ipcRenderer or arbitrary channels.
export type { IpcMethod };
