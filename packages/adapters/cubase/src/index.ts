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
  hostCommand,
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
    {
      id: 'kick',
      name: 'Kick',
      type: 'audio',
      mute: false,
      solo: false,
      volume: 0.82,
      pan: 0.5,
      recordEnabled: false,
      monitoring: false,
      selected: true,
    },
    {
      id: 'bass',
      name: 'Sub bass',
      type: 'midi',
      mute: false,
      solo: false,
      volume: 0.74,
      pan: 0.42,
      recordEnabled: false,
      monitoring: false,
      selected: false,
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
    {
      id: 'percussion',
      name: 'Percussion',
      type: 'audio',
      mute: false,
      solo: false,
      volume: 0.66,
      pan: 0.58,
      recordEnabled: false,
      monitoring: false,
      selected: false,
    },
    {
      id: 'keys',
      name: 'Analog keys',
      type: 'instrument',
      mute: false,
      solo: false,
      volume: 0.58,
      pan: 0.5,
      recordEnabled: false,
      monitoring: false,
      selected: false,
    },
  ],
  // The fixture is smaller than a bank, so the window is the whole session.
  bank: { offset: 0, size: 16, total: 4 },
  selectedChannel: {
    trackId: 'kick',
    name: 'Kick',
    automation: { read: true, write: false },
    eq: [
      { band: 1, on: true, gain: 0.42, frequency: 0.18, q: 0.5 },
      { band: 2, on: false, gain: 0.5, frequency: 0.4, q: 0.5 },
      { band: 3, on: false, gain: 0.5, frequency: 0.62, q: 0.5 },
      { band: 4, on: true, gain: 0.55, frequency: 0.86, q: 0.4 },
    ],
    sends: [
      { slot: 0, on: true, level: 0.3, preFader: false },
      { slot: 1, on: false, level: 0, preFader: false },
    ],
    inserts: [{ slot: 0, name: 'Compressor', on: true, bypassed: false }],
  },
});
export class MockCubaseAdapter implements DawAdapter {
  private connected = false;
  private project = initialProject();
  /** Commands the fixture was asked to run, so a test can see what happened. */
  readonly commands: string[] = [];
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
      // A host command acts on whatever is selected rather than on an argument,
      // which is exactly the shape of a destructive operation.
      risk: id.includes('.get_')
        ? 'read'
        : id === 'host.run_command'
          ? 'destructive'
          : 'safe-write',
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
    if (command.tool === 'track.set_pan')
      track.pan = toolSchemas['track.set_pan'].parse(command.arguments).pan;
    if (command.tool === 'track.set_record_enable')
      track.recordEnabled = toolSchemas['track.set_record_enable'].parse(command.arguments).armed;
    if (command.tool === 'track.set_monitor')
      track.monitoring = toolSchemas['track.set_monitor'].parse(command.arguments).monitoring;
    if (command.tool === 'track.select') {
      // One selection at a time, as the host has.
      for (const candidate of this.project.tracks) candidate.selected = candidate.id === trackId;
      this.project.selectedChannel = {
        ...(this.project.selectedChannel ?? {
          automation: { read: false, write: false },
          eq: [],
          sends: [],
          inserts: [],
        }),
        trackId: track.id,
        name: track.name,
      };
    }
  }
  /** EQ, sends, inserts and automation belong to the selected channel. */
  private applyChannel(command: DawCommand) {
    const channel = this.project.selectedChannel;
    if (!channel) throw new Error('No track is selected.');
    if (command.tool === 'channel.set_automation') {
      const input = toolSchemas['channel.set_automation'].parse(command.arguments);
      if (input.read !== undefined) channel.automation.read = input.read;
      if (input.write !== undefined) channel.automation.write = input.write;
    }
    if (command.tool === 'channel.set_eq_band') {
      const input = toolSchemas['channel.set_eq_band'].parse(command.arguments);
      const band = channel.eq.find((candidate) => candidate.band === input.band);
      if (!band) throw new Error(`This channel has no EQ band ${input.band}.`);
      if (input.on !== undefined) band.on = input.on;
      if (input.gain !== undefined) band.gain = input.gain;
      if (input.frequency !== undefined) band.frequency = input.frequency;
      if (input.q !== undefined) band.q = input.q;
    }
    if (command.tool === 'channel.set_send') {
      const input = toolSchemas['channel.set_send'].parse(command.arguments);
      const send = channel.sends.find((candidate) => candidate.slot === input.slot);
      if (!send) throw new Error(`This channel has no send slot ${input.slot}.`);
      if (input.on !== undefined) send.on = input.on;
      if (input.level !== undefined) send.level = input.level;
      if (input.preFader !== undefined) send.preFader = input.preFader;
    }
    if (command.tool === 'channel.set_insert') {
      const input = toolSchemas['channel.set_insert'].parse(command.arguments);
      const insert = channel.inserts.find((candidate) => candidate.slot === input.slot);
      // An empty slot is refused rather than filled in.
      if (!insert) throw new Error(`Insert slot ${input.slot} is empty.`);
      if (input.on !== undefined) insert.on = input.on;
      if (input.bypassed !== undefined) insert.bypassed = input.bypassed;
    }
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
    if (command.tool.startsWith('channel.')) this.applyChannel(command);
    if (command.tool.startsWith('plugin.')) this.applyPlugin(command);
    if (command.tool === 'mixer.page') {
      // The fixture is smaller than one bank, so paging has nowhere to go and
      // says so rather than pretending to move.
      throw new Error('This mock session fits in one bank, so there is nothing to page to.');
    }
    if (command.tool === 'host.run_command') {
      const { command: id } = toolSchemas['host.run_command'].parse(command.arguments);
      const entry = hostCommand(id);
      if (!entry) throw new Error(`Command "${id}" is not one this bridge will run.`);
      // Recorded as run against the fixture; nothing is saved to disk, and the
      // detail says so rather than implying a real project was written.
      this.commands.push(entry.id);
    }
    if (!command.tool.includes('.get_')) this.project.revision++;
    return { project: await this.getProjectState() };
  }
}
