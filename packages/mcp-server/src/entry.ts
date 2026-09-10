import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MockCubaseAdapter } from '@orchestrai/cubase';
import { DemoProvider } from '@orchestrai/agent-core';
import { Orchestrator } from '@orchestrai/orchestrator';
import {
  wireSchema,
  historySchema,
  errorText,
  type StoreCommand,
  type Control,
  type Activity,
} from '@orchestrai/shared-types';
import { createMcpServer, availableToolDefinitions } from './index';

const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function store(command: StoreCommand): Promise<unknown> {
  if (!process.send) return Promise.reject(new Error('Desktop persistence channel unavailable.'));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Persistence acknowledgement timed out.'));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    process.send!({ kind: 'store', id, command });
  });
}
const orchestration = new Orchestrator(new MockCubaseAdapter(), async (activity) => {
  await store({ type: 'activity', activity });
});
const demo = new DemoProvider();
const server = createMcpServer(orchestration);
let chatting = false;
async function control(command: Control): Promise<unknown> {
  switch (command.type) {
    case 'state':
      return orchestration.state();
    case 'connect':
      await demo.initialize();
      return orchestration.connect();
    case 'disconnect':
      await demo.cancel();
      return orchestration.disconnect();
    case 'mode': {
      const state = await orchestration.setMode(command.mode);
      await store({ type: 'mode', mode: command.mode });
      await server.sendToolListChanged();
      return state;
    }
    case 'decision':
      return orchestration.decide(
        command.decision.id,
        command.decision.sessionId,
        command.decision.approve,
      );
    case 'undo':
      return orchestration.undo(command.id, command.conversationId);
    case 'cancel':
      await demo.cancel();
      await orchestration.cancel();
      return null;
    case 'chat': {
      if (chatting) throw new Error('A demo response is already running.');
      chatting = true;
      try {
        const history = historySchema.parse(await store({ type: 'history' }));
        const conversation = history.conversations.find(
          (c) => c.id === command.message.conversationId,
        );
        if (!conversation) throw new Error('Conversation not found.');
        const response = await demo.sendMessage(
          {
            ...conversation,
            messages: history.messages.filter((m) => m.conversationId === conversation.id),
          },
          await availableToolDefinitions(orchestration),
        );
        const results: Activity[] = [];
        for (const call of response.commands)
          results.push(
            await orchestration.request(call.tool, call.arguments, conversation.id, 'demo'),
          );
        const text = [
          response.text,
          ...results.map((r) => `${r.tool}: ${r.status}. ${r.detail}`),
        ].join('\n\n');
        await store({
          type: 'message',
          message: {
            id: randomUUID(),
            conversationId: conversation.id,
            role: 'assistant',
            provider: 'Demo',
            content: text,
            timestamp: new Date().toISOString(),
          },
        });
        return null;
      } finally {
        chatting = false;
      }
    }
  }
}
process.on('message', (raw) => {
  const parsed = wireSchema.safeParse(raw);
  if (!parsed.success) return;
  const message = parsed.data;
  if (message.kind === 'reply') {
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.value);
  }
  if (message.kind === 'control')
    void control(message.command).then(
      (value) => process.send?.({ kind: 'reply', id: message.id, value }),
      (error) => process.send?.({ kind: 'reply', id: message.id, error: errorText(error) }),
    );
});
process.on('disconnect', () => process.exit(0));
setInterval(() => {
  void orchestration.expire().catch((error) => process.stderr.write(errorText(error) + '\n'));
}, 1000).unref();
void server.connect(new StdioServerTransport()).catch((error) => {
  process.stderr.write(errorText(error) + '\n');
  process.exit(1);
});
