/** Types for the real-CoreMIDI Cubase peer harness used by the live bridge test. */
export interface CubasePeerLogEntry {
  call: string;
  name?: string;
  value?: number;
  bpm?: number;
  mapping?: { id: string };
  [key: string]: unknown;
}
export interface CubasePeer {
  api: {
    log: CubasePeerLogEntry[];
    driver: Record<string, unknown>;
  };
  sent: number[][];
  portName: string;
  reportTempo(bpm: number): void;
  stop(): void;
}
export interface CubasePeerTrack {
  name: string;
  volume: number;
  mute: boolean;
  solo: boolean;
  plugin?: string;
  quickControls?: { index: number; name: string; value: number }[];
}
export const DEFAULT_TRACKS: CubasePeerTrack[];
export function startCubasePeer(options?: {
  tempo?: number;
  tracks?: CubasePeerTrack[];
}): Promise<CubasePeer>;
