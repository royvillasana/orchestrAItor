'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  Snapshot,
  OrchestraAPI,
  Activity,
  ToolName,
  AdapterId,
} from '@orchestrai/shared-types';

declare global {
  interface Window {
    orchestra?: OrchestraAPI;
  }
}
const smallButton =
  'rounded-lg border border-line px-3 py-2 text-xs text-muted transition hover:border-muted hover:text-paper disabled:opacity-40';
function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M4 12v4M9 6v16M14 2v24M19 6v16M24 12v4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Icon({
  kind,
  className = '',
}: {
  kind:
    | 'play'
    | 'stop'
    | 'arrow'
    | 'plus'
    | 'check'
    | 'spark'
    | 'folder'
    | 'chat'
    | 'wave'
    | 'settings'
    | 'terminal';
  className?: string;
}) {
  const paths = {
    play: 'm8 5 11 7-11 7Z',
    stop: 'M6 6h12v12H6Z',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    plus: 'M12 5v14M5 12h14',
    check: 'm5 12 4 4L19 6',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
    folder: 'M3 7V5h6l3 3h9v12H3Z',
    chat: 'M4 4h16v12H9l-5 4Z',
    wave: 'M3 10v4M7 6v12M11 3v18M15 7v10M19 5v14M23 10v4',
    settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
    terminal: 'm5 7 5 5-5 5m8 0h6',
  };
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
function Pill({ children, green = false }: { children: ReactNode; green?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-medium tracking-wide ${green ? 'border-accent/20 bg-accent/5 text-accent' : 'border-line text-muted'}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${green ? 'bg-accent' : 'bg-muted'}`} />
      {children}
    </span>
  );
}

export function Studio({ setup = false }: { setup?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [desktop, setDesktop] = useState(true);
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [adapter, setAdapter] = useState<AdapterId>('mock');
  const end = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!window.orchestra) {
      setDesktop(false);
      return;
    }
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = await window.orchestra!.snapshot({});
        if (mounted.current) setData(next);
      } catch (e) {
        if (mounted.current) setError(String(e));
      } finally {
        polling = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 800);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (!conversationId && data?.history.conversations.length)
      setConversationId(data.history.conversations.at(-1)!.id);
  }, [data, conversationId]);
  const messages = data?.history.messages.filter((m) => m.conversationId === conversationId) ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);
  const run = async (action: (api: OrchestraAPI) => Promise<Snapshot>) => {
    if (!window.orchestra) return;
    setBusy(true);
    setError('');
    try {
      const next = await action(window.orchestra);
      setData(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const connect = async () => {
    const next = await run((api) => api.connect({ adapter }));
    if (next?.runtime?.connected) router.push('/workspace/');
  };
  const create = async () => {
    const next = await run((api) => api.createConversation({}));
    if (next) setConversationId(next.history.conversations.at(-1)!.id);
  };
  const send = async () => {
    if (!content.trim()) return;
    let id = conversationId;
    if (!id) {
      const next = await run((api) => api.createConversation({}));
      id = next?.history.conversations.at(-1)?.id ?? '';
      setConversationId(id);
    }
    if (!id) return;
    const text = content;
    setContent('');
    await run((api) => api.sendMessage({ conversationId: id, content: text }));
  };
  const tool = async (name: ToolName) => {
    await run((api) =>
      api.callTool({ tool: name, arguments: {}, conversationId: conversationId || 'system' }),
    );
  };
  const runtime = data?.runtime;
  const connected = !!runtime?.connected;
  // The bridge is offered only when it could actually connect; the reason a
  // producer cannot use it is more useful than a button that always fails.
  const bridgeUnavailable = data?.midi
    ? data.midi.available
      ? null
      : `Unavailable: ${data.midi.reason ?? 'no MIDI backend.'}${data.midi.remedy ? ` ${data.midi.remedy}` : ''}`
    : 'Unavailable: MIDI detection has not run yet. Choose Refresh detection.';
  useEffect(() => {
    if (adapter === 'bridge' && bridgeUnavailable) setAdapter('mock');
  }, [adapter, bridgeUnavailable]);
  const mode = runtime?.mode ?? data?.history.mode ?? 'ask';
  const project = runtime?.project;
  const calls = data?.history.activities ?? [];
  const pending = calls.filter((c) => c.status === 'awaiting-approval');
  const visibleCalls = [...calls].reverse();
  const canWrite = connected && mode === 'assist' && !busy && !data?.error;
  const errorBanner = (error || data?.error || !desktop) && (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 border-b border-warm/20 bg-warm/5 px-6 py-3 text-sm text-warm"
    >
      <span>
        {!desktop
          ? 'Open this interface in the Electron app to connect to local services. Use pnpm dev.'
          : error || data?.error}
      </span>
      {data?.error && (
        <button className={smallButton} onClick={() => void run((api) => api.restart({}))}>
          Restart runtime
        </button>
      )}
    </div>
  );
  const brand = (
    <Link href="/" className="flex items-center gap-3">
      <span className="text-accent">
        <Mark />
      </span>
      <span className="text-lg font-semibold tracking-tight">
        Orchestr<span className="text-accent">AI</span>
      </span>
    </Link>
  );
  if (setup)
    return (
      <main className="flex h-screen flex-col overflow-hidden bg-ink">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-6 tall:h-20 tall:px-10">
          {brand}
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-muted lg:inline">YOUR STUDIO. CONNECTED.</span>
            <Pill>Milestone 01</Pill>
          </div>
        </header>
        {errorBanner}
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 xl:max-w-6xl flex-col justify-center gap-4 px-6 py-5 tall:gap-5 tall:px-10 tall:py-8">
          <div className="flex shrink-0 items-end justify-between gap-6">
            <div className="min-w-0">
              <p className="mb-2 font-mono text-xs tracking-[0.2em] text-accent tall:mb-4">
                01 / CONNECT YOUR STUDIO
              </p>
              <h1 className="text-3xl font-medium tracking-tight tall:text-4xl">
                Your next idea starts here.
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted tall:mt-4 tall:leading-7">
                Your sounds. Your instruments. Your way of working.
                <br />
                Bring your production environment into one creative conversation.
              </p>
            </div>
            <span className="mb-2 hidden shrink-0 text-accent/20 lg:block">
              <svg width="120" height="65" viewBox="0 0 120 65" fill="none" aria-hidden="true">
                {[15, 26, 45, 60, 34, 50, 23, 40, 18, 30, 52, 22].map((h, i) => (
                  <path
                    key={i}
                    d={`M${i * 10 + 3} ${(65 - h) / 2}v${h}`}
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                ))}
              </svg>
            </span>
          </div>
          <div className="grid min-h-0 grid-cols-2 gap-4 tall:gap-5">
            <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-panel p-5 tall:p-7">
              <div className="mb-4 flex items-center justify-between tall:mb-6">
                <h2 className="text-sm font-medium">
                  <span className="mr-3 text-muted">01</span> Production environment
                </h2>
                <Icon kind="wave" className="text-muted" />
              </div>
              <div role="radiogroup" aria-label="DAW adapter" className="space-y-2">
                {(
                  [
                    {
                      id: 'mock',
                      title: 'Cubase 14 · Mock',
                      subtitle: 'Deterministic fixture · Local sandbox',
                      detail:
                        'Explore a fixture project, tempo, and transport. Your real Cubase projects are untouched.',
                      unavailable: null,
                    },
                    {
                      id: 'bridge',
                      title: 'Cubase · Live bridge',
                      subtitle: 'MIDI Remote · Changes your open session',
                      detail:
                        'Publishes an "OrchestrAI Bridge" MIDI port pair. Requires Cubase 12 or newer with the driver script paired.',
                      unavailable: bridgeUnavailable,
                    },
                  ] as const
                ).map((option) => {
                  const selected = adapter === option.id;
                  const blocked = !!option.unavailable;
                  return (
                    <button
                      key={option.id}
                      role="radio"
                      aria-checked={selected}
                      disabled={blocked || busy}
                      onClick={() => setAdapter(option.id)}
                      className={`w-full rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected ? 'border-accent/40 bg-accent/5' : 'border-line hover:border-muted'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-raised text-paper">
                          <Icon kind="wave" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-medium">{option.title}</h3>
                          <p className="mt-1 text-xs text-muted">{option.subtitle}</p>
                        </div>
                        {selected && (
                          <span className="ml-auto text-accent">
                            <Icon kind="check" />
                          </span>
                        )}
                      </div>
                      <p className="mt-3 border-t border-line/60 pt-3 text-xs leading-5 text-muted">
                        {option.unavailable ?? option.detail}
                      </p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 tall:mt-5">
                {['Ableton Live', 'Logic Pro', 'REAPER'].map((name) => (
                  <span
                    key={name}
                    className="rounded-md border border-line px-2.5 py-1.5 text-[11px] text-muted"
                  >
                    {name} · Later
                  </span>
                ))}
              </div>
            </section>
            <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-panel p-5 tall:p-7">
              <div className="mb-4 flex items-center justify-between tall:mb-6">
                <h2 className="text-sm font-medium">
                  <span className="mr-3 text-muted">02</span> Creative partner
                </h2>
                <button
                  disabled={busy || !desktop}
                  onClick={() => void run((api) => api.discover({}))}
                  className="shrink-0 text-xs text-muted hover:text-accent"
                >
                  Refresh detection ↻
                </button>
              </div>
              <div className="mb-3 flex items-center gap-4 rounded-xl border border-accent/40 bg-accent/5 p-4 tall:mb-4">
                <div className="shrink-0 rounded-lg bg-accent/10 p-3 text-accent">
                  <Icon kind="spark" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium">Demo agent</h3>
                  <p className="mt-1 text-xs text-muted">Deterministic · No account needed</p>
                </div>
                <Icon kind="check" className="ml-auto text-accent" />
              </div>
              {(
                data?.agents ?? [
                  { id: 'claude', name: 'Claude Code', installed: false, executable: null },
                  { id: 'codex', name: 'Codex', installed: false, executable: null },
                ]
              ).map((agent) => (
                <div
                  key={agent.id}
                  title={agent.executable ?? undefined}
                  className="flex items-center justify-between gap-3 border-b border-line py-2.5 text-xs tall:py-3"
                >
                  <span className="truncate">{agent.name}</span>
                  <span className="shrink-0 text-muted">
                    {agent.installed ? 'Detected · Auth unverified' : 'CLI not installed'}
                  </span>
                </div>
              ))}
              <p className="mt-3 text-[11px] leading-5 text-muted tall:mt-4">
                Live CLI sessions and OpenAI / Anthropic API connections arrive in a later
                milestone.
              </p>
            </section>
          </div>
          <div className="flex shrink-0 items-center gap-4 rounded-xl border border-dashed border-line px-5 py-4 tall:px-6 tall:py-5">
            <Icon kind="folder" className="shrink-0 text-muted" />
            <div className="min-w-0">
              <h2 className="text-sm">Your sample libraries</h2>
              <p className="mt-1 text-xs text-muted">
                Local indexing and sample search are planned for Milestone 03.
              </p>
            </div>
            <span className="ml-auto shrink-0 text-xs text-muted">Coming later</span>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-6 tall:mt-3">
            <p className="flex items-center gap-2 text-xs text-muted">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              Local first. No audio or libraries uploaded.
            </p>
            <button
              disabled={busy || !desktop || !data || !!data.error}
              onClick={() => void connect()}
              className="flex shrink-0 items-center gap-8 rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-40 tall:py-4"
            >
              {busy
                ? 'Connecting…'
                : adapter === 'bridge'
                  ? 'Connect live session'
                  : 'Open demo studio'}
              <Icon kind="arrow" />
            </button>
          </div>
          <p className="hidden shrink-0 text-center font-mono text-[10px] uppercase tracking-widest text-muted/60 tall:mt-6 tall:block">
            Built around the tools you already love.
          </p>
        </div>
      </main>
    );
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-ink">
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-line px-6">
        {brand}
        <div className="flex items-center gap-3">
          <Pill green={connected}>
            {runtime?.daw ?? 'Cubase 14 · Mock'} ·{' '}
            {connected ? (runtime?.adapter === 'bridge' ? 'live' : 'mock') : 'disconnected'}
          </Pill>
          <Pill green={connected}>Demo agent</Pill>
          <Link
            href="/"
            aria-label="Connection settings"
            className="ml-3 rounded-lg p-2 text-muted hover:bg-raised"
          >
            <Icon kind="settings" />
          </Link>
        </div>
      </header>
      {errorBanner}
      {!connected && !data?.error && (
        <div className="flex items-center justify-center gap-5 border-b border-line bg-panel py-3 text-sm text-muted">
          Connect the mock session to continue.
          <button onClick={() => void connect()} className={smallButton} disabled={busy}>
            Connect mock session
          </button>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(360px,1fr)_300px] xl:grid-cols-[230px_minmax(400px,1fr)_330px]">
        <aside className="flex min-h-0 flex-col border-r border-line bg-panel/40">
          <div className="border-b border-line p-5">
            <p className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-muted">PROJECT</p>
            <h2 className="text-sm font-medium">After hours</h2>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
              <span className="h-1 w-1 rounded-full bg-accent" />
              Session 01{' '}
              <span className="ml-auto rounded bg-raised px-1.5 py-0.5 text-[9px]">MOCK</span>
            </div>
          </div>
          <div className="px-3 py-5">
            <p className="mb-3 px-2 text-[10px] font-semibold tracking-[0.16em] text-muted">
              TRACKS <span className="float-right">{project?.tracks.length ?? 0}</span>
            </p>
            {project?.tracks.map((track, i) => (
              <div
                key={track.id}
                className="mb-1 flex items-center gap-3 rounded-lg px-2 py-3 text-sm"
              >
                <span
                  className={`h-7 w-0.5 rounded ${['bg-warm', 'bg-accent', 'bg-sky-300', 'bg-violet-300'][i % 4]}`}
                />
                <Icon kind={track.type === 'audio' ? 'wave' : 'settings'} className="text-muted" />
                <span>{track.name}</span>
                <span className="ml-auto font-mono text-[9px] text-muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
            ))}
          </div>
          <div className="mx-5 border-t border-line" />
          <div className="flex min-h-0 flex-1 flex-col px-3 py-5">
            <div className="mb-3 flex items-center justify-between px-2">
              <p className="text-[10px] font-semibold tracking-[0.16em] text-muted">
                CONVERSATIONS
              </p>
              <button
                aria-label="New conversation"
                onClick={() => void create()}
                disabled={busy}
                className="rounded p-1 text-muted hover:bg-raised hover:text-paper"
              >
                <Icon kind="plus" />
              </button>
            </div>
            <div className="overflow-y-auto">
              {data?.history.conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setConversationId(c.id)}
                  className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs ${conversationId === c.id ? 'bg-raised text-paper' : 'text-muted hover:bg-raised/50'}`}
                >
                  <Icon kind="chat" className="shrink-0" />
                  <span className="truncate">{c.title}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="border-t border-line px-5 py-5">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Icon kind="folder" />
              Sample libraries
            </div>
            <p className="mt-2 text-[10px] text-muted/60">Available in a later milestone</p>
          </div>
        </aside>
        <section className="flex min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-line px-7 py-5">
            <div>
              <h1 className="text-sm font-medium">Studio conversation</h1>
              <p className="mt-1 text-[11px] text-muted">A little direction. A new possibility.</p>
            </div>
            <div
              className="flex rounded-lg border border-line bg-panel p-1"
              aria-label="Agent mode"
            >
              {(['ask', 'assist'] as const).map((m) => (
                <button
                  key={m}
                  disabled={busy}
                  onClick={() => void run((api) => api.setMode({ mode: m }))}
                  className={`rounded-md px-3 py-1.5 text-xs capitalize ${mode === m ? 'bg-raised text-accent' : 'text-muted'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-7 py-8">
            {!messages.length ? (
              <div className="mx-auto flex h-full max-w-lg flex-col justify-center pb-6">
                <span className="mb-6 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/5 text-accent">
                  <Icon kind="spark" />
                </span>
                <p className="mb-3 font-mono text-[10px] tracking-[0.18em] text-accent">
                  SPACE FOR YOUR NEXT IDEA
                </p>
                <h2 className="text-3xl font-medium leading-tight tracking-tight">
                  Let’s work on
                  <br />
                  something good.
                </h2>
                <p className="mt-5 max-w-sm text-sm leading-7 text-muted">
                  Explore your mock session with the local Demo agent. Every action stays visible,
                  and every change starts with you.
                </p>
                <div className="mt-7 space-y-2">
                  {['Inspect the project', 'Set tempo to 124 BPM', 'Play the session'].map(
                    (prompt, i) => (
                      <button
                        key={prompt}
                        onClick={() => setContent(prompt)}
                        className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel/40 px-4 py-3 text-left text-xs transition hover:border-accent/40 hover:bg-panel"
                      >
                        <Icon
                          kind={i === 0 ? 'wave' : i === 1 ? 'settings' : 'play'}
                          className="text-muted"
                        />
                        {prompt}
                        <span className="ml-auto text-muted">↗</span>
                      </button>
                    ),
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={
                      message.role === 'user'
                        ? 'ml-10 rounded-xl border border-line bg-panel p-5'
                        : ''
                    }
                  >
                    <div className="mb-3 flex items-center gap-2 text-xs">
                      <span className={message.role === 'assistant' ? 'text-accent' : 'text-muted'}>
                        {message.role === 'assistant' ? (
                          <Icon kind="spark" />
                        ) : (
                          <Icon kind="chat" />
                        )}
                      </span>
                      <span className="font-medium">
                        {message.role === 'assistant' ? 'Demo agent' : 'You'}
                      </span>
                      <time className="ml-auto font-mono text-[9px] text-muted">
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-7 text-paper/85">
                      {message.content}
                    </p>
                  </article>
                ))}
              </div>
            )}
            {busy && (
              <p role="status" className="mt-4 text-xs text-accent">
                Working locally…
              </p>
            )}
            <div ref={end} />
          </div>
          <div className="shrink-0 px-6 pb-5">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
              className="rounded-xl border border-line bg-panel p-4 focus-within:border-accent/50"
            >
              <label htmlFor="composer" className="sr-only">
                Message Demo agent
              </label>
              <textarea
                id="composer"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={4000}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!busy && connected) void send();
                  }
                }}
                placeholder="What are we working on?"
                rows={2}
                className="w-full resize-none bg-transparent text-sm leading-6 placeholder:text-muted/60 focus-visible:ring-0"
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-[10px] text-muted">
                  <Icon kind="spark" />
                  Demo · Local only<span className="mx-1 text-line">|</span>
                  {mode === 'ask' ? 'Read-only session' : 'Changes need approval'}
                </span>
                {busy ? (
                  <button
                    type="button"
                    onClick={() => void run((api) => api.cancel({}))}
                    className={smallButton}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    aria-label="Send message"
                    disabled={!content.trim() || !connected}
                    className="rounded-lg bg-accent p-2 text-ink"
                  >
                    <Icon kind="arrow" />
                  </button>
                )}
              </div>
            </form>
            <p className="mt-2 text-center text-[9px] text-muted/60">
              Demo responses are deterministic. Your real DAW is not connected.
            </p>
          </div>
        </section>
        <aside className="flex min-h-0 flex-col border-l border-line bg-panel/40">
          <section className="border-b border-line p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[10px] font-semibold tracking-[0.16em] text-muted">
                SESSION CONTEXT
              </h2>
              <span className="text-[9px] text-muted">MOCK</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="font-mono text-2xl" data-testid="tempo">
                  {project?.tempo ?? '—'}
                </p>
                <p className="mt-1 text-[9px] text-muted">BPM</p>
              </div>
              <div>
                <p className="text-xl">
                  A <span className="text-sm text-muted">min</span>
                </p>
                <p className="mt-1 text-[9px] text-muted">KEY</p>
              </div>
              <div>
                <p className="font-mono text-xl">4/4</p>
                <p className="mt-1 text-[9px] text-muted">SIGNATURE</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-[11px] text-muted">
              <span>Execution environment</span>
              <span className="text-paper">Cubase Mock</span>
            </div>
          </section>
          <div className="flex items-center justify-between px-5 py-5">
            <h2 className="text-[10px] font-semibold tracking-[0.16em] text-muted">
              TOOL ACTIVITY
            </h2>
            <span className="rounded bg-raised px-2 py-0.5 font-mono text-[10px] text-muted">
              {pending.length ? `${pending.length} pending` : calls.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4" aria-live="polite">
            {!calls.length ? (
              <div className="rounded-xl border border-dashed border-line px-5 py-8">
                <Icon kind="terminal" className="mb-4 text-muted" />
                <p className="text-xs">A clear view of every action.</p>
                <p className="mt-3 text-[11px] leading-6 text-muted">
                  Tool requests, approvals, and results appear here as you work.
                </p>
              </div>
            ) : (
              visibleCalls.map((call) => (
                <ActivityCard
                  key={call.id}
                  call={call}
                  activeSession={runtime?.sessionId}
                  busy={busy}
                  decide={(approve) =>
                    void run((api) =>
                      api.decide({ id: call.id, sessionId: call.sessionId, approve }),
                    )
                  }
                  undo={() =>
                    void run((api) =>
                      api.undo({ id: call.id, conversationId: conversationId || 'system' }),
                    )
                  }
                />
              ))
            )}
          </div>
          <button
            onClick={() => setConsoleOpen(!consoleOpen)}
            className="flex items-center gap-2 border-t border-line px-5 py-4 text-left text-[11px] text-muted hover:text-paper"
          >
            <Icon kind="terminal" />
            Developer console <span className="ml-auto">{consoleOpen ? '−' : '+'}</span>
          </button>
        </aside>
      </div>
      {consoleOpen && (
        <section
          aria-label="Developer console"
          className="max-h-48 shrink-0 overflow-y-auto border-t border-line bg-panel px-6 py-3 font-mono text-[10px] leading-6 text-muted"
        >
          {data?.logs.slice(-50).map((log, i) => (
            <div key={i} className="break-all">
              <span className="mr-4 text-muted/60">{log.timestamp.slice(11, 19)}</span>
              <span className="mr-4 text-accent">{log.event}</span>
              {log.detail}
              {log.requestId && (
                <span className="ml-3 text-muted/50">{log.requestId.slice(0, 8)}</span>
              )}
            </div>
          ))}
        </section>
      )}
      <footer className="flex h-16 shrink-0 items-center justify-between border-t border-line bg-panel px-6">
        <div className="flex items-center gap-3">
          <button
            aria-label="Play transport"
            disabled={!canWrite}
            onClick={() => void tool('transport.play')}
            className="rounded-lg bg-accent p-2.5 text-ink"
          >
            <Icon kind="play" />
          </button>
          <button
            aria-label="Stop transport"
            disabled={!canWrite}
            onClick={() => void tool('transport.stop')}
            className="rounded-lg border border-line p-2.5 text-muted"
          >
            <Icon kind="stop" />
          </button>
          <span className="ml-2 font-mono text-xs text-muted">
            {project?.playing ? 'PLAYING' : 'STOPPED'}
          </span>
        </div>
        <div className="flex items-center gap-6 font-mono text-sm">
          <span className="text-muted">
            001 <span className="text-muted/40">. 1 . 1</span>
          </span>
          <span className="h-6 w-px bg-line" />
          <span>
            {project?.tempo ?? '—'} <span className="text-[10px] text-muted">BPM</span>
          </span>
          <span className="text-muted">4/4</span>
        </div>
        <span className="text-[10px] text-muted">Mock transport · No audio output</span>
      </footer>
    </main>
  );
}
function ActivityCard({
  call,
  activeSession,
  busy,
  decide,
  undo,
}: {
  call: Activity;
  activeSession?: string;
  busy: boolean;
  decide: (approve: boolean) => void;
  undo: () => void;
}) {
  const pending = call.status === 'awaiting-approval';
  const current = call.sessionId === activeSession;
  return (
    <article
      data-testid="activity"
      className={`rounded-xl border p-4 ${pending ? 'border-warm/40 bg-warm/5' : 'border-line bg-panel'}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={
            call.status === 'succeeded' ? 'text-accent' : pending ? 'text-warm' : 'text-muted'
          }
        >
          <Icon kind={call.status === 'succeeded' ? 'check' : pending ? 'settings' : 'terminal'} />
        </span>
        <h3 className="break-all font-mono text-[11px]">{call.tool}</h3>
      </div>
      <div className="mb-3 flex items-center gap-2 text-[9px] text-muted">
        <span className="capitalize">{call.agent}</span>
        <span>·</span>
        <span className={pending ? 'text-warm' : ''}>{call.status.replaceAll('-', ' ')}</span>
      </div>
      {Object.keys(call.arguments).length > 0 && (
        <pre className="mb-3 whitespace-pre-wrap break-all rounded bg-ink/50 p-2 font-mono text-[10px] text-muted">
          {JSON.stringify(call.arguments)}
        </pre>
      )}
      <p className="break-words text-[11px] leading-5 text-muted">{call.detail}</p>
      {pending && (
        <div className="mt-4 flex gap-2">
          <button
            disabled={busy || !current}
            onClick={() => decide(true)}
            className="flex-1 rounded-md bg-accent py-2 text-xs font-medium text-ink"
          >
            Approve
          </button>
          <button
            disabled={busy || !current}
            onClick={() => decide(false)}
            className="flex-1 rounded-md border border-line py-2 text-xs text-muted"
          >
            Cancel
          </button>
        </div>
      )}
      {call.undoable && current && (
        <button
          disabled={busy}
          onClick={undo}
          className="mt-3 text-[11px] text-accent hover:underline"
        >
          Undo change ↶
        </button>
      )}
      <p className="mt-3 font-mono text-[8px] text-muted/50">
        {call.id.slice(0, 8)} · {new Date(call.timestamp).toLocaleTimeString()}
      </p>
    </article>
  );
}
