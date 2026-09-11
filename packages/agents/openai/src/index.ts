import {
  agentResponseSchema,
  type AgentProvider,
  type Conversation,
  type ToolDefinition,
  type AgentResponse,
} from '@orchestrai/shared-types';
export interface OpenAITransport {
  initialize(): Promise<void>;
  send(
    conversation: Conversation,
    tools: ToolDefinition[],
    signal: AbortSignal,
  ): Promise<AgentResponse>;
}
export * from './transport';
export class OpenAIProvider implements AgentProvider {
  id = 'openai';
  name = 'OpenAI';
  private controller: AbortController | undefined;
  constructor(private readonly transport?: OpenAITransport) {}
  async initialize() {
    if (!this.transport)
      throw new Error(
        'OpenAI unavailable: live API connections are not implemented in this milestone.',
      );
    await this.transport.initialize();
  }
  getCapabilities() {
    return { tools: true, streaming: false, local: false };
  }
  async cancel() {
    this.controller?.abort();
  }
  async sendMessage(conversation: Conversation, tools: ToolDefinition[]) {
    if (!this.transport) throw new Error('OpenAI unavailable: configure a transport first.');
    const controller = new AbortController();
    this.controller = controller;
    // A deliberate cancel is not a failed turn, so it is reported as what the
    // producer did rather than as an abort error from somewhere in the stack.
    const cancelled = () =>
      agentResponseSchema.parse({ text: `${this.name} turn cancelled.`, commands: [] });
    try {
      const result = await this.transport.send(conversation, tools, controller.signal);
      return controller.signal.aborted ? cancelled() : agentResponseSchema.parse(result);
    } catch (error) {
      if (controller.signal.aborted) return cancelled();
      throw error;
    }
  }
}
