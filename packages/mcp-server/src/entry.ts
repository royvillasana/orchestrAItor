import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CubaseBridgeAdapter,
  MockCubaseAdapter,
  PlatformMidiTransport,
  virtualPortId,
  type MidiPort,
} from '@orchestrai/cubase';
import { DemoProvider } from '@orchestrai/agent-core';
import { AgentToolChannel, LiveAgentProvider } from '@orchestrai/live-agents';
import { discoverAgents, verifyAgent, isVerifiable } from '@orchestrai/cli';
import { Orchestrator } from '@orchestrai/orchestrator';
import { z } from 'zod';
import { generateClip } from '@orchestrai/music-engine';
import {
  wireSchema,
  artifactSchema,
  toolSchemas,
  sampleLibrarySchema,
  indexedSampleSchema,
  historySchema,
  errorText,
  type StoreCommand,
  type Control,
  type Activity,
  type AdapterId,
  type MidiStatus,
  type ProviderId,
  type AgentProvider,
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
/**
 * Sample search runs against the desktop's index over the existing persistence
 * channel; the runtime keeps no library of its own.
 */
orchestration.useSamples({
  search: async (query, limit) => {
    const library = sampleLibrarySchema.parse(await store({ type: 'library' }));
    if (library.roots.length === 0)
      throw new Error('No sample folder has been added yet. Add one in the connection screen.');
    const results = z
      .array(indexedSampleSchema)
      .parse(await store({ type: 'searchSamples', query, limit }));
    if (results.length === 0)
      return `No sample matched "${query}" in ${library.total} indexed samples.`;
    return results
      .map((sample) => {
        const facts = [
          sample.durationMs !== null ? `${(sample.durationMs / 1000).toFixed(2)}s` : null,
          sample.sampleRate !== null ? `${sample.sampleRate} Hz` : null,
          sample.channels === 1 ? 'mono' : sample.channels === 2 ? 'stereo' : null,
        ].filter(Boolean);
        return `${sample.name}${facts.length ? ` (${facts.join(', ')})` : ''} — ${sample.path}`;
      })
      .join('\n');
  },
  stats: async () => {
    const library = sampleLibrarySchema.parse(await store({ type: 'library' }));
    if (library.roots.length === 0) return 'No sample folder has been added yet.';
    return [
      `${library.total} samples indexed across ${library.roots.length} folder(s).`,
      ...library.roots.map(
        (root) =>
          `${root.path}: ${root.count} samples${root.truncated ? ' (truncated at the index cap)' : ''}${root.indexedAt ? `, indexed ${root.indexedAt}` : ', not indexed yet'}`,
      ),
    ].join('\n');
  },
});
/**
 * Clip generation. The musical defaults come from the connected session, so a
 * clip lands in the key and tempo the producer is actually working in.
 */
orchestration.useArtifacts({
  createClip: async (raw) => {
    const input = toolSchemas['midi.create_clip'].parse(raw);
    const state = await orchestration.state();
    const project = state.project;
    const seed = input.seed ?? Math.floor(Math.random() * 1000000);
    const key = input.key ?? keyOf(project?.key) ?? 'C';
    const scale = input.scale ?? scaleOf(project?.key) ?? 'minor';
    const clip = generateClip({
      kind: input.kind,
      key,
      scale,
      bars: input.bars ?? 4,
      tempo: input.tempo ?? project?.tempo ?? 120,
      progression: input.progression ?? 'pop',
      seed,
    });
    const id = randomUUID();
    const stored = artifactSchema.parse(
      await store({
        type: 'artifact',
        artifact: {
          id,
          name: `${input.kind}-${key}-${input.bars ?? 4}bar`,
          kind: input.kind,
          summary: clip.summary,
          bars: input.bars ?? 4,
          tempo: input.tempo ?? project?.tempo ?? 120,
          key,
          scale,
          progression: input.progression ?? 'pop',
          seed,
          noteCount: clip.notes.length,
          createdAt: new Date().toISOString(),
        },
        data: Buffer.from(clip.bytes).toString('base64'),
      }),
    );
    // Said plainly: this is a file to drop in, not a change to the project.
    return `${clip.summary}. Saved as ${stored.path}. Drop it onto a track in Cubase; the session itself is unchanged.`;
  },
});
/** A session reports its key as free text, so read it defensively. */
function keyOf(reported: string | undefined): string | null {
  const match = /^([A-G][#b]?)/.exec((reported ?? '').trim());
  return match ? match[1] : null;
}
function scaleOf(reported: string | undefined): 'major' | 'minor' | null {
  if (/minor|min\b|m\b/i.test(reported ?? '')) return 'minor';
  if (/major|maj\b/i.test(reported ?? '')) return 'major';
  return null;
}
const demo = new DemoProvider();
let live: LiveAgentProvider | null = null;
let active: AgentProvider = demo;
let activeId: ProviderId = 'demo';
const providerNames: Record<ProviderId, string> = {
  demo: 'Demo agent',
  claude: 'Claude Code',
  codex: 'Codex',
};
/**
 * One channel for however many turns a live agent runs, opened only while a
 * live provider is selected so no agent surface exists during a demo session.
 */
const channel = new AgentToolChannel({
  list: () => availableToolDefinitions(orchestration),
  call: async (tool, args) => {
    const name = tool.startsWith('mcp__orchestrai__')
      ? tool.slice('mcp__orchestrai__'.length)
      : tool;
    return orchestration.request(name, args, agentConversationId, activeId);
  },
});
let agentConversationId = '';
let streamed = '';
/** Display-only: the persisted message is still written once, at turn end. */
function emit(chunk: { conversationId: string; text: string; done: boolean }) {
  if (!process.send || !chunk.conversationId) return;
  process.send({ kind: 'stream', chunk });
}
async function executablesById(): Promise<Partial<Record<ProviderId, string>>> {
  const discovered = await discoverAgents();
  const find = (id: string) =>
    discovered.find((agent: { id: string }) => agent.id === id)?.executable ?? undefined;
  return { claude: find('claude-code'), codex: find('codex') };
}
async function useProvider(id: ProviderId) {
  if (id === activeId && (id === 'demo' || live)) return;
  await live?.dispose();
  live = null;
  if (id === 'demo') {
    await channel.stop();
    active = demo;
    activeId = 'demo';
  } else {
    const executable = (await executablesById())[id];
    if (!executable) throw new Error(`${providerNames[id]} is not installed.`);
    await channel.start();
    live = new LiveAgentProvider({
      id,
      name: providerNames[id],
      executable,
      onDelta: (text) => {
        streamed += (streamed ? '\n\n' : '') + text;
        emit({ conversationId: agentConversationId, text: streamed, done: false });
      },
      proxyEntry: path.join(path.dirname(process.argv[1]), 'agent-mcp.cjs'),
      nodeExecutable: process.execPath,
      channelAddress: channel.address,
      channelToken: channel.token,
    });
    await live.initialize();
    active = live;
    activeId = id;
  }
  await orchestration.useProvider({
    id: activeId,
    label: providerNames[activeId],
    live: activeId !== 'demo',
  });
}
/**
 * The MIDI backend is optional by design, so the bridge is described rather
 * than assumed: the interface shows why it is unavailable instead of offering
 * a connection that cannot succeed.
 */
async function midiStatus(): Promise<MidiStatus> {
  const transport = new PlatformMidiTransport();
  const status = await transport.status();
  if (!status.available)
    return { available: false, reason: status.reason, remedy: status.remedy, ports: [] };
  let ports: MidiPort[] = [];
  try {
    ports = await transport.listPorts();
  } catch (error) {
    return { available: false, reason: errorText(error), remedy: null, ports: [] };
  }
  return { available: true, reason: null, remedy: null, ports };
}
const bridgePortName = 'OrchestrAI Bridge';
async function buildAdapter(id: AdapterId) {
  if (id === 'mock') return new MockCubaseAdapter();
  const status = await midiStatus();
  if (!status.available)
    throw new Error(status.reason ?? 'No MIDI backend is available for the Cubase bridge.');
  const match = (direction: 'input' | 'output') =>
    status.ports.find((port) => port.direction === direction && port.name.includes(bridgePortName));
  // Publish our own CoreMIDI endpoints when the pair does not already exist, so
  // a producer never has to hand-configure an IAC bus before pairing in Cubase.
  const input = match('input')?.id ?? virtualPortId(bridgePortName);
  const output = match('output')?.id ?? virtualPortId(bridgePortName);
  return new CubaseBridgeAdapter(new PlatformMidiTransport(), { input, output });
}
const server = createMcpServer(orchestration);
let chatting = false;
async function control(command: Control): Promise<unknown> {
  switch (command.type) {
    case 'state':
      return orchestration.state();
    case 'midi':
      return midiStatus();
    case 'verify': {
      if (!isVerifiable(command.agent)) throw new Error('The Demo agent needs no verification.');
      const executable = (await executablesById())[command.agent];
      if (!executable) throw new Error(`${providerNames[command.agent]} is not installed.`);
      return { agent: command.agent, ...(await verifyAgent(command.agent, executable)) };
    }
    case 'provider': {
      // A partner may be swapped without disturbing the DAW session, but not
      // underneath a turn that is already running.
      if (chatting) throw new Error('Wait for the current response to finish before switching.');
      await active.cancel();
      await useProvider(command.provider);
      return orchestration.state();
    }
    case 'connect':
      await demo.initialize();
      if (command.provider) await useProvider(command.provider);
      if (command.adapter)
        await orchestration.useAdapter(command.adapter, await buildAdapter(command.adapter));
      return orchestration.connect();
    case 'disconnect':
      await active.cancel();
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
      await active.cancel();
      await orchestration.cancel();
      return null;
    case 'chat': {
      if (chatting) throw new Error(`A ${providerNames[activeId]} response is already running.`);
      chatting = true;
      try {
        const history = historySchema.parse(await store({ type: 'history' }));
        const conversation = history.conversations.find(
          (c) => c.id === command.message.conversationId,
        );
        if (!conversation) throw new Error('Conversation not found.');
        agentConversationId = conversation.id;
        streamed = '';
        const response = await active.sendMessage(
          {
            ...conversation,
            messages: history.messages.filter((m) => m.conversationId === conversation.id),
          },
          await availableToolDefinitions(orchestration),
        );
        const results: Activity[] = [];
        for (const call of response.commands)
          results.push(
            await orchestration.request(call.tool, call.arguments, conversation.id, activeId),
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
            provider: providerNames[activeId],
            content: text,
            timestamp: new Date().toISOString(),
          },
        });
        return null;
      } finally {
        chatting = false;
        // The turn is over however it ended; the transcript owns the text now.
        emit({ conversationId: agentConversationId, text: streamed, done: true });
        streamed = '';
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
