import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Orchestrator } from '@orchestrai/orchestrator';
import { idSchema, errorText, toolNameSchema } from '@orchestrai/shared-types';

export async function availableToolDefinitions(orchestrator: Orchestrator) {
  const descriptions: Partial<Record<string, string>> = {
    'samples.search':
      "Search the producer's indexed local sample library by name, folder, or tag. Returns real file paths. Read only.",
    'samples.stats': 'Report how many samples are indexed and from which folders. Read only.',
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
