/**
 * MCP stdio server that a live agent CLI loads. It owns no orchestration: every
 * call is forwarded over the token-guarded channel to the one runtime that
 * holds the registry, permission engine, and adapter session.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { errorText } from '@orchestrai/shared-types';
import { requestOverChannel } from './channel';

const address = process.env.ORCHESTRA_AGENT_CHANNEL;
const token = process.env.ORCHESTRA_AGENT_TOKEN;
if (!address || !token) {
  process.stderr.write('The OrchestrAI MCP proxy requires its channel address and token.\n');
  process.exit(2);
}
const channel = address;
const sessionToken = token;
const server = new Server(
  { name: 'orchestrai', version: '0.1.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = (await requestOverChannel(channel, {
    op: 'list',
    token: sessionToken,
  })) as unknown[];
  return { tools };
});
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await requestOverChannel(channel, {
      op: 'call',
      token: sessionToken,
      tool: request.params.name,
      arguments: (request.params.arguments ?? {}) as Record<string, unknown>,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: errorText(error) }], isError: true };
  }
});
// Diagnostics must never reach stdout: it carries the MCP protocol.
server.connect(new StdioServerTransport()).catch((error: unknown) => {
  process.stderr.write(`${errorText(error)}\n`);
  process.exit(1);
});
