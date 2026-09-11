import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Orchestrator } from '@orchestrai/orchestrator';
import { idSchema, errorText, toolNameSchema, HOST_COMMANDS } from '@orchestrai/shared-types';

export async function availableToolDefinitions(orchestrator: Orchestrator) {
  const descriptions: Partial<Record<string, string>> = {
    'samples.search':
      "Search the producer's indexed local sample library by name, folder, or tag. Returns real file paths. Read only.",
    'samples.stats': 'Report how many samples are indexed and from which folders. Read only.',
    'track.set_volume':
      "Set one track's fader position, from 0 to 1. Requires user approval in Assist.",
    'track.set_mute': 'Mute or unmute one track. Requires user approval in Assist.',
    'track.set_solo': 'Solo or unsolo one track. Requires user approval in Assist.',
    'plugin.set_bypass':
      "Bypass or un-bypass a track's instrument plugin. Requires approval in Assist.",
    'plugin.set_quick_control':
      "Set one of a track's quick controls, 0 to 1. Quick controls are the parameters the producer has mapped in Cubase; other plugin parameters are not reachable. Requires approval in Assist.",
    'track.set_pan': "Set one track's pan, 0 hard left to 1 hard right. Approval in Assist.",
    'track.set_record_enable': 'Arm or disarm one track for recording. Approval in Assist.',
    'track.set_monitor': 'Turn input monitoring on or off for one track. Approval in Assist.',
    'track.select':
      'Select one track in Cubase. EQ, sends, inserts and automation apply to the selected track, so select it before changing any of those. Approval in Assist.',
    'channel.set_eq_band':
      "Set a band of the selected track's channel EQ: on, gain, frequency, or Q, each 0 to 1. Select the track first. Approval in Assist.",
    'channel.set_send':
      'Set a send slot on the selected track: on, level 0 to 1, or pre/post fader. Select the track first. Approval in Assist.',
    'channel.set_insert':
      'Switch on or bypass an insert already loaded on the selected track. Loading, replacing or removing a plugin is not reachable. Approval in Assist.',
    'channel.set_automation':
      "Arm the selected track's automation read or write. Approval in Assist.",
    'mixer.page':
      'Move the sixteen-channel window over the session. Use when project.get_state reports the session is truncated and the track you want is not listed.',
    'host.run_command': `Run one Cubase command from a fixed list: ${HOST_COMMANDS.map((command) => command.id).join(', ')}. A command takes no arguments and acts on whatever is currently selected, so select the track first and expect the producer to check the selection. Commands marked as opening a dialog cannot be completed from here. Always requires approval.`,
    'midi.create_clip':
      'Generate a MIDI clip — chords, bass, or drums — as a file the producer drags onto a track. Key, scale, and tempo default to the connected session. This writes a file; it does not change the project, and it requires user approval in Assist.',
  };
  const schemas: Partial<Record<string, Record<string, unknown>>> = {
    'project.set_tempo': {
      type: 'object' as const,
      properties: { tempo: { type: 'number', minimum: 20, maximum: 300 } },
      required: ['tempo'],
      additionalProperties: false,
    },
    'samples.search': {
      type: 'object' as const,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 120 },
        limit: { type: 'number', minimum: 1, maximum: 50 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    // Without this the tool advertises no arguments, and an agent has to guess
    // what a clip request looks like.
    'track.set_volume': {
      type: 'object' as const,
      properties: {
        trackId: { type: 'string', description: 'The id from project.get_state.' },
        volume: { type: 'number', minimum: 0, maximum: 1, description: 'Fader position, not dB.' },
      },
      required: ['trackId', 'volume'],
      additionalProperties: false,
    },
    'track.set_mute': {
      type: 'object' as const,
      properties: {
        trackId: { type: 'string', description: 'The id from project.get_state.' },
        mute: { type: 'boolean' },
      },
      required: ['trackId', 'mute'],
      additionalProperties: false,
    },
    'track.set_solo': {
      type: 'object' as const,
      properties: {
        trackId: { type: 'string', description: 'The id from project.get_state.' },
        solo: { type: 'boolean' },
      },
      required: ['trackId', 'solo'],
      additionalProperties: false,
    },
    'plugin.set_bypass': {
      type: 'object' as const,
      properties: {
        trackId: { type: 'string', description: 'The id from project.get_state.' },
        bypassed: { type: 'boolean' },
      },
      required: ['trackId', 'bypassed'],
      additionalProperties: false,
    },
    'plugin.set_quick_control': {
      type: 'object' as const,
      properties: {
        trackId: { type: 'string', description: 'The id from project.get_state.' },
        index: {
          type: 'number',
          minimum: 0,
          maximum: 7,
          description: 'The quick control index reported for that track.',
        },
        value: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Normalized, not plugin units.',
        },
      },
      required: ['trackId', 'index', 'value'],
      additionalProperties: false,
    },
    'track.set_pan': {
      type: 'object' as const,
      properties: {
        trackId: { type: 'string', description: 'The id from project.get_state.' },
        pan: { type: 'number', minimum: 0, maximum: 1, description: '0.5 is centre.' },
      },
      required: ['trackId', 'pan'],
      additionalProperties: false,
    },
    'track.set_record_enable': {
      type: 'object' as const,
      properties: {
        trackId: { type: 'string', description: 'The id from project.get_state.' },
        armed: { type: 'boolean' },
      },
      required: ['trackId', 'armed'],
      additionalProperties: false,
    },
    'track.set_monitor': {
      type: 'object' as const,
      properties: {
        trackId: { type: 'string', description: 'The id from project.get_state.' },
        monitoring: { type: 'boolean' },
      },
      required: ['trackId', 'monitoring'],
      additionalProperties: false,
    },
    'track.select': {
      type: 'object' as const,
      properties: { trackId: { type: 'string', description: 'The id from project.get_state.' } },
      required: ['trackId'],
      additionalProperties: false,
    },
    'channel.set_eq_band': {
      type: 'object' as const,
      properties: {
        band: { type: 'number', minimum: 1, maximum: 4, description: 'Bands are numbered 1 to 4.' },
        on: { type: 'boolean' },
        gain: { type: 'number', minimum: 0, maximum: 1, description: 'Normalized, not dB.' },
        frequency: { type: 'number', minimum: 0, maximum: 1, description: 'Normalized, not Hz.' },
        q: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['band'],
      additionalProperties: false,
    },
    'channel.set_send': {
      type: 'object' as const,
      properties: {
        slot: { type: 'number', minimum: 0, maximum: 15, description: 'The slot from the state.' },
        on: { type: 'boolean' },
        level: { type: 'number', minimum: 0, maximum: 1 },
        preFader: { type: 'boolean' },
      },
      required: ['slot'],
      additionalProperties: false,
    },
    'channel.set_insert': {
      type: 'object' as const,
      properties: {
        slot: { type: 'number', minimum: 0, maximum: 15, description: 'The slot from the state.' },
        on: { type: 'boolean' },
        bypassed: { type: 'boolean' },
      },
      required: ['slot'],
      additionalProperties: false,
    },
    'channel.set_automation': {
      type: 'object' as const,
      properties: { read: { type: 'boolean' }, write: { type: 'boolean' } },
      additionalProperties: false,
    },
    'mixer.page': {
      type: 'object' as const,
      properties: {
        direction: {
          type: 'string',
          enum: ['next', 'previous', 'left', 'right', 'reset'],
          description: 'A bank moves sixteen channels; left and right move one.',
        },
      },
      required: ['direction'],
      additionalProperties: false,
    },
    'host.run_command': {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          enum: HOST_COMMANDS.map((command) => command.id),
          description: 'One of the allowlisted Cubase commands.',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    'midi.create_clip': {
      type: 'object' as const,
      properties: {
        kind: { type: 'string', enum: ['chords', 'bass', 'drums'] },
        bars: { type: 'number', minimum: 1, maximum: 32, description: 'Defaults to 4.' },
        key: {
          type: 'string',
          description: 'Note name such as A, F#, or Bb. Defaults to the session key.',
        },
        scale: {
          type: 'string',
          enum: ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'harmonicMinor'],
        },
        progression: {
          type: 'string',
          enum: ['pop', 'sad', 'loop', 'cadence', 'descending'],
          description: 'A named shape, not roman numerals.',
        },
        tempo: { type: 'number', minimum: 20, maximum: 300 },
        seed: {
          type: 'number',
          minimum: 0,
          maximum: 999999,
          description: 'Reproduces a clip exactly.',
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  };
  return (await orchestrator.tools()).map((tool) => ({
    name: toolNameSchema.parse(tool.id),
    description:
      descriptions[tool.id] ??
      `${tool.id} in the connected Cubase session. ${tool.requiresConfirmation ? 'Requires user approval in Assist.' : 'Read only.'}`,
    inputSchema:
      schemas[tool.id] ??
      ({ type: 'object' as const, properties: {}, additionalProperties: false } as Record<
        string,
        unknown
      >),
  }));
}

export function createMcpServer(orchestrator: Orchestrator) {
  const server = new Server(
    { name: 'orchestra-mcp', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true } } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await availableToolDefinitions(orchestrator),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const conversationId = idSchema.parse(request.params._meta?.conversationId ?? 'system');
      const result = await orchestrator.request(
        request.params.name,
        request.params.arguments ?? {},
        conversationId,
        'desktop',
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        isError: ['failed', 'denied'].includes(result.status),
      };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: errorText(error) }], isError: true };
    }
  });
  return server;
}
