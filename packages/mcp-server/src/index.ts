import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Orchestrator } from '@orchestrai/orchestrator';
import { idSchema, errorText, toolNameSchema } from '@orchestrai/shared-types';

export async function availableToolDefinitions(orchestrator: Orchestrator) {
  return (await orchestrator.tools()).map((tool) => ({
    name: toolNameSchema.parse(tool.id),
    description: `${tool.id} in the connected Cubase session. ${tool.requiresConfirmation ? 'Requires user approval in Assist.' : 'Read only.'}`,
    inputSchema:
      tool.id === 'project.set_tempo'
        ? {
            type: 'object' as const,
            properties: { tempo: { type: 'number', minimum: 20, maximum: 300 } },
            required: ['tempo'],
            additionalProperties: false,
          }
        : { type: 'object' as const, properties: {}, additionalProperties: false },
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
