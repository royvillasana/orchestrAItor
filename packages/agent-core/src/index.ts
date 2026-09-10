import {
  type AgentProvider,
  type Conversation,
  type ToolDefinition,
  type AgentResponse,
} from '@orchestrai/shared-types';
export type { AgentProvider } from '@orchestrai/shared-types';
export class DemoProvider implements AgentProvider {
  id = 'demo';
  name = 'Demo';
  private generation = 0;
  async initialize() {}
  getCapabilities() {
    return { tools: true, streaming: false, local: true };
  }
  async cancel() {
    this.generation++;
  }
  async sendMessage(conversation: Conversation, _tools: ToolDefinition[]): Promise<AgentResponse> {
    const generation = this.generation;
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (generation !== this.generation) throw new Error('Demo response cancelled.');
    const text = conversation.messages.at(-1)?.content.toLowerCase() ?? '';
    if (/bassline|groove|sample|midi|plugin|generate|compose/.test(text))
      return {
        text: 'Sample search, music generation, and plugin control arrive in later milestones. In this demo we can inspect the mock project, change its tempo, and test transport with your approval.',
        commands: [],
      };
    const tempo = text.match(/(?:tempo\s*(?:to|at|=)?\s*|\b)(\d+(?:\.\d+)?)\s*(?:bpm)?/);
    if (tempo && /tempo|bpm/.test(text))
      return {
        text: 'I have proposed a tempo change for the mock project. The activity panel shows whether approval is needed.',
        commands: [{ tool: 'project.set_tempo', arguments: { tempo: Number(tempo[1]) } }],
      };
    if (/\b(play|stop)\b/.test(text))
      return {
        text: 'I have proposed a mock transport action.',
        commands: [
          { tool: /\bstop\b/.test(text) ? 'transport.stop' : 'transport.play', arguments: {} },
        ],
      };
    if (/project|inspect|tempo|tracks/.test(text))
      return {
        text: 'Here is the current mock project state.',
        commands: [{ tool: 'project.get_state', arguments: {} }],
      };
    return {
      text: 'Let’s explore the session. Try “Inspect the project”, “Set tempo to 124 BPM”, or “Play”. I am the local Demo agent; no live AI account or real Cubase session is connected.',
      commands: [],
    };
  }
}
