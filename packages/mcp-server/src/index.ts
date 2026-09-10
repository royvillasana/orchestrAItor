import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Orchestrator } from '@orchestrai/orchestrator';
import { idSchema, errorText, toolNameSchema } from '@orchestrai/shared-types';

export async function availableToolDefinitions(orchestrator: Orchestrator) {
  const descriptions: Partial<Record<string, string>> = {
    'samples.search':
      "Search the producer's indexed local sample library by name, folder, or tag. Returns real file paths. Read only.",
    'samples.stats': 'Report how many samples are indexed and from which folders. Read only.',
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
