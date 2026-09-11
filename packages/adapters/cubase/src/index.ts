export * from './transport';
export * from './protocol';
export * from './bridge';
export * from './simulated';
import {
  projectSchema,
  commandSchema,
  toolSchemas,
  toolNames,
  isLocalTool,
  type Capability,
  type DawAdapter,
  type DawCommand,
  type ProjectState,
} from '@orchestrai/shared-types';

export const initialProject = (): ProjectState => ({
  name: 'After hours / Session 01',
  tempo: 122,
  key: 'A minor',
  timeSignature: '4/4',
  playing: false,
  revision: 0,
  mock: true,
  // Volume is the normalized fader position both adapters now report.
  tracks: [
    { id: 'kick', name: 'Kick', type: 'audio', mute: false, solo: false, volume: 0.82 },
    {
      id: 'bass',
      name: 'Sub bass',
      type: 'midi',
      mute: false,
      solo: false,
      volume: 0.74,
      // What a session exposes on a control surface, not every parameter.
      plugin: {
        name: 'Retrologue',
        bypassed: false,
        quickControls: [
          { index: 0, name: 'Cutoff', value: 0.62 },
          { index: 1, name: 'Resonance', value: 0.3 },
          { index: 2, name: 'Drive', value: 0.18 },
        ],
      },
    },
    { id: 'percussion', name: 'Percussion', type: 'audio', mute: false, solo: false, volume: 0.66 },
    { id: 'keys', name: 'Analog keys', type: 'instrument', mute: false, solo: false, volume: 0.58 },
  ],
});
export class MockCubaseAdapter implements DawAdapter {
  private connected = false;
  private project = initialProject();
  async connect() {
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
  }
  async getCapabilities(): Promise<Capability[]> {
    return [
      ...toolNames.filter((id) => !isLocalTool(id)),
      'track.create_audio',
      'midi.insert_clip',
      'plugin.insert',
    ].map((id) => ({
      id,
      support: this.connected && toolNames.some((n) => n === id) ? 'native' : 'unsupported',
      risk: id.includes('.get_') ? 'read' : 'safe-write',
      requiresConfirmation: !id.includes('.get_'),
    }));
  }
  async getProjectState() {
    this.assertConnected();
    return projectSchema.parse(structuredClone(this.project));
  }
  private assertConnected() {
    if (!this.connected) throw new Error('Mock Cubase is disconnected.');
  }
  private applyPlugin(command: DawCommand) {
    const { trackId } = command.arguments as { trackId: string };
    const track = this.project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) throw new Error(`This session has no track "${trackId}".`);
    if (!track.plugin) throw new Error(`"${track.name}" has no plugin.`);
    if (command.tool === 'plugin.set_bypass')
      track.plugin.bypassed = toolSchemas['plugin.set_bypass'].parse(command.arguments).bypassed;
    if (command.tool === 'plugin.set_quick_control') {
      const { index, value } = toolSchemas['plugin.set_quick_control'].parse(command.arguments);
      const control = track.plugin.quickControls.find((candidate) => candidate.index === index);
      // Unmapped controls are refused rather than invented: moving something
      // nobody assigned is worse than not reaching it.
      if (!control) throw new Error(`Quick control ${index} is not mapped on "${track.name}".`);
      control.value = value;
    }
  }
  private applyTrack(command: DawCommand) {
    const { trackId } = command.arguments as { trackId: string };
    const track = this.project.tracks.find((candidate) => candidate.id === trackId);
    // Refused before anything is applied: a stale conversation must not reach
    // a track that is no longer there.
    if (!track) throw new Error(`This session has no track "${trackId}".`);
    if (command.tool === 'track.set_volume')
      track.volume = toolSchemas['track.set_volume'].parse(command.arguments).volume;
    if (command.tool === 'track.set_mute')
      track.mute = toolSchemas['track.set_mute'].parse(command.arguments).mute;
    if (command.tool === 'track.set_solo')
      track.solo = toolSchemas['track.set_solo'].parse(command.arguments).solo;
  }
  async execute(input: DawCommand) {
    this.assertConnected();
    const command = commandSchema.parse(input);
    toolSchemas[command.tool].parse(command.arguments);
    if (command.tool === 'project.set_tempo')
      this.project.tempo = toolSchemas['project.set_tempo'].parse(command.arguments).tempo;
    if (command.tool === 'transport.play') this.project.playing = true;
    if (command.tool === 'transport.stop') this.project.playing = false;
    if (command.tool.startsWith('track.')) this.applyTrack(command);
    if (command.tool.startsWith('plugin.')) this.applyPlugin(command);
    if (!command.tool.includes('.get_')) this.project.revision++;
    return { project: await this.getProjectState() };
  }
}
