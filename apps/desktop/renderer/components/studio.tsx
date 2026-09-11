'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BorderBeam } from 'border-beam';
import PixelArc from './originkit/ui/pixel-arc';
import { RichText } from './rich-text';
import { ThinkingBubble, StreamingMessage, ToolChip, TurnError } from './chat-states';
import type {
  Snapshot,
  OrchestraAPI,
  Activity,
  ToolName,
  AdapterId,
  ProviderId,
} from '@orchestrai/shared-types';

declare global {
  interface Window {
    orchestra?: OrchestraAPI;
  }
}
/** Why a run ended, in the producer's terms rather than the enum's. */
const runEndings: Record<string, string> = {
  'write-budget': 'change limit reached',
  'time-budget': 'time limit reached',
  stopped: 'you stopped it',
  failed: 'a change failed',
  disconnected: 'the session disconnected',
  'mode-changed': 'the mode changed',
};
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
  const [partner, setPartner] = useState<ProviderId>('demo');
  const [sampleQuery, setSampleQuery] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [runWrites, setRunWrites] = useState(6);
  const [runMinutes, setRunMinutes] = useState(2);
  // A continuously animating glow is not free, and this is an audio
  // application: it stops when the window is not on screen, and never runs for
  // someone who asked for reduced motion.
  const [windowVisible, setWindowVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyMotion = () => setReducedMotion(motion.matches);
    // Visibility, not focus: a window the producer can see should still glow
    // while they are clicking around in Cubase.
    const applyVisibility = () => setWindowVisible(document.visibilityState === 'visible');
    applyMotion();
    applyVisibility();
    motion.addEventListener('change', applyMotion);
    document.addEventListener('visibilitychange', applyVisibility);
    return () => {
      motion.removeEventListener('change', applyMotion);
      document.removeEventListener('visibilitychange', applyVisibility);
    };
  }, []);
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
    // Already in this session: this is "take me back", not a reconnection.
    if (unchanged) {
      router.push('/workspace/');
      return;
    }
    const next = await run((api) => api.connect({ adapter, provider: partner }));
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
  // What is selected here must be what is connected, or returning to this
  // screen shows a session the producer is not in.
  useEffect(() => {
    if (!runtime?.connected) return;
    setAdapter(runtime.adapter);
    setPartner(runtime.provider);
  }, [runtime?.connected, runtime?.adapter, runtime?.provider]);
  const unchanged =
    !!runtime?.connected && runtime.adapter === adapter && runtime.provider === partner;
  const connected = !!runtime?.connected;
  // The bridge is offered only when it could actually connect; the reason a
  // producer cannot use it is more useful than a button that always fails.
  const agentById = (id: string) => data?.agents.find((agent) => agent.id === id);
  const partnerOptions = [
    {
      id: 'demo' as const,
      title: 'Demo agent',
      subtitle: 'Deterministic · No account needed',
      detail: 'Fixed local responses for exercising the workspace. Never a model answer.',
      agent: undefined,
      unavailable: null as string | null,
    },
    ...(
      [
        ['claude', 'claude-code', 'Claude Code', 'claude auth login'],
        ['codex', 'codex', 'Codex', 'codex login'],
      ] as const
    ).map(([id, discoveryId, title, signIn]) => {
      const agent = agentById(discoveryId);
      const unavailable = !agent?.installed
        ? `Unavailable: the ${title} CLI was not found on this machine.`
        : agent.authentication === 'unauthenticated'
          ? `Installed but not signed in. Run: ${signIn}`
          : agent.authentication === 'failed'
            ? `Verification failed: ${agent.errors[0] ?? 'unknown reason'}`
            : agent.authentication === 'unverified'
              ? 'Installed. Verify the sign-in before connecting.'
              : null;
      return {
        id,
        title,
        subtitle:
          agent?.authentication === 'authenticated'
            ? `Signed in${agent.account ? ` · ${agent.account}` : ''}`
            : 'Live model session · Uses its own sign-in',
        detail:
          `Sends this conversation and project state to ${title}'s model provider. ${agent?.version ?? ''}`.trim(),
        agent,
        unavailable,
      };
    }),
  ];
  const partnerBlocked =
    partnerOptions.find((option) => option.id === partner)?.unavailable ?? null;
  const library = data?.library ?? { roots: [], total: 0 };
  const artifacts = data?.artifacts ?? [];
  const bridgeUnavailable = data?.midi
    ? data.midi.available
      ? null
      : `Unavailable: ${data.midi.reason ?? 'no MIDI backend.'}${data.midi.remedy ? ` ${data.midi.remedy}` : ''}`
    : 'Unavailable: MIDI detection has not run yet. Choose Refresh detection.';
  useEffect(() => {
    if (adapter === 'bridge' && bridgeUnavailable) setAdapter('mock');
  }, [adapter, bridgeUnavailable]);
  useEffect(() => {
    // A partner that stops being usable must not stay selected: the Demo agent
    // is the honest default.
    if (partner !== 'demo' && partnerBlocked) setPartner('demo');
  }, [partner, partnerBlocked]);
  const mode = runtime?.mode ?? data?.history.mode ?? 'ask';
  const project = runtime?.project;
  const calls = data?.history.activities ?? [];
  const pending = calls.filter((c) => c.status === 'awaiting-approval');
  const visibleCalls = [...calls].reverse();
  const canWrite = connected && mode === 'assist' && !busy && !data?.error;
  const providerLabel = runtime?.providerLabel ?? 'Demo agent';
  const beamActive = !reducedMotion && windowVisible;
  const currentRun = runtime?.run ?? null;
  const activeRun = currentRun && !currentRun.endedAt ? currentRun : null;
  const finishedRun = currentRun?.endedAt ? currentRun : null;
  const streaming = data?.streaming ?? null;
  // A turn is live while the request is in flight or text is still arriving.
  const turnRunning = busy || !!streaming;
  const lastActivity = calls.at(-1);
  const runningTool =
    lastActivity && ['requested', 'running'].includes(lastActivity.status) ? lastActivity : null;
  const failedTurn =
    !turnRunning && lastActivity?.status === 'failed' && lastActivity.agent !== 'user'
      ? lastActivity
      : null;
  // Milestone 1 exists to keep mock state from reading as real. The same rule
  // runs the other way: a live session must never be labelled mock.
  const isMock = project ? project.mock : runtime?.adapter !== 'bridge';
  const sessionBadge = connected ? (isMock ? 'MOCK' : 'LIVE') : 'OFFLINE';
  const environment = connected ? (runtime?.daw ?? 'Cubase') : 'Not connected';
  const [projectTitle, projectSubtitle] = (project?.name ?? 'No project').split(' / ');
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
      <main className="relative flex h-screen flex-col overflow-hidden bg-ink">
        {/* The shader sits behind everything and takes no input: the connection
            screen's buttons matter more than its pointer response. It animates,
            so it follows the same rules as the composer beam — off when the
            window is not on screen, and never for reduced motion. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          {beamActive && (
            <PixelArc
              background="#101214"
              baseColor="#2f4a2a"
              accentColor="#c8ed9c"
              highlight="#edf0ed"
              density={140}
              dotSize={82}
              speed={34}
              pointerStrength={0}
              // A horizon along the bottom. The screen is dense, so the arc
              // reads as a deliberate glow under the content rather than a
              // texture showing through the gaps between cards.
              arc={{ center: 86, drop: 34, thickness: 26, falloff: 300 }}
              // The component asks for 1200x800 minimum, which would push the
              // window into overflow at the smallest size it supports.
              style={{ minWidth: 0, minHeight: 0, width: '100%', height: '100%' }}
            />
          )}
          {/* Keeps the type readable over whatever the shader is doing. */}
          <div className="absolute inset-0 bg-gradient-to-b from-ink via-ink/85 to-ink/35" />
        </div>
        <header className="relative flex h-16 shrink-0 items-center justify-between border-b border-line px-6 tall:h-20 tall:px-10">
          {brand}
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-muted lg:inline">YOUR STUDIO. CONNECTED.</span>
            <Pill>Milestone 01</Pill>
          </div>
        </header>
        {errorBanner}
        <div className="relative mx-auto flex min-h-0 w-full max-w-5xl flex-1 xl:max-w-6xl flex-col justify-center gap-3 px-6 py-4 tall:gap-5 tall:px-10 tall:py-8">
          <div className="flex shrink-0 items-end justify-between gap-6">
            <div className="min-w-0">
              <p className="mb-2 font-mono text-xs tracking-[0.2em] text-accent tall:mb-4">
                01 / CONNECT YOUR STUDIO
              </p>
              <h1 className="text-3xl font-medium tracking-tight tall:text-4xl">
                Your next idea starts here.
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted tall:mt-4 tall:leading-7">
                Your sounds. Your instruments. Your way of working.{' '}
                <br className="hidden tall:block" />
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
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 tall:gap-5">
            <section className="flex min-h-0 min-w-0 flex-col overflow-y-auto rounded-2xl border border-line bg-panel p-4 tall:p-6">
              <div className="mb-3 flex items-center justify-between tall:mb-5">
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
                      className={`w-full rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 tall:p-4 ${
                        selected ? 'border-accent/40 bg-accent/5' : 'border-line hover:border-muted'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-raised text-paper tall:h-11 tall:w-11">
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
                      {(blocked || selected) && (
                        <p className="mt-2 border-t border-line/60 pt-2 text-[11px] leading-4 text-muted tall:mt-3 tall:pt-3 tall:text-xs tall:leading-5">
                          {option.unavailable ?? option.detail}
                        </p>
                      )}
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
            <section className="flex min-h-0 min-w-0 flex-col overflow-y-auto rounded-2xl border border-line bg-panel p-4 tall:p-6">
              <div className="mb-3 flex items-center justify-between tall:mb-5">
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
              <div role="radiogroup" aria-label="Creative partner" className="space-y-2">
                {partnerOptions.map((option) => {
                  const selected = partner === option.id;
                  const blocked = !!option.unavailable;
                  return (
                    <div
                      key={option.id}
                      className={`rounded-xl border p-3 transition tall:p-4 ${
                        selected ? 'border-accent/40 bg-accent/5' : 'border-line'
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <button
                          role="radio"
                          aria-checked={selected}
                          disabled={blocked || busy}
                          onClick={() => setPartner(option.id)}
                          className="flex min-w-0 flex-1 items-center gap-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="shrink-0 rounded-lg bg-accent/10 p-2.5 text-accent tall:p-3">
                            <Icon kind="spark" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-medium">{option.title}</h3>
                            <p className="mt-1 truncate text-xs text-muted">{option.subtitle}</p>
                          </div>
                        </button>
                        {selected && !blocked && (
                          <span className="shrink-0 text-accent">
                            <Icon kind="check" />
                          </span>
                        )}
                        {option.agent?.installed &&
                          option.agent.authentication !== 'authenticated' && (
                            <button
                              onClick={() =>
                                void run((api) =>
                                  api.verify({ agent: option.id as 'claude' | 'codex' }),
                                )
                              }
                              disabled={busy || !desktop}
                              className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[11px] text-muted transition hover:border-muted hover:text-paper disabled:opacity-40"
                            >
                              Verify sign-in
                            </button>
                          )}
                      </div>
                      {(blocked || selected) && (
                        <p className="mt-2 border-t border-line/60 pt-2 text-[11px] leading-4 text-muted tall:mt-3 tall:pt-3 tall:leading-5">
                          {option.unavailable ?? option.detail}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              {partner !== 'demo' && (
                <p className="mt-2 text-[11px] leading-4 text-warm/80 tall:mt-3 tall:leading-5">
                  A live partner sends this conversation and project state to its model provider. It
                  signs in with its own CLI; OrchestrAI stores no credentials.
                </p>
              )}
            </section>
          </div>
          <div className="shrink-0 rounded-xl border border-dashed border-line bg-panel/60 px-5 py-4 backdrop-blur-md tall:px-6 tall:py-5">
            <div className="flex items-center gap-4">
              <Icon kind="folder" className="shrink-0 text-muted" />
              <div className="min-w-0">
                <h2 className="text-sm">Your sample libraries</h2>
                <p className="mt-1 truncate text-xs text-muted">
                  {data?.analysing ??
                    data?.indexing ??
                    (library.roots.length === 0
                      ? 'Add a folder to search your own sounds. Nothing is copied or uploaded.'
                      : `${library.total} samples indexed from ${library.roots.length} folder${
                          library.roots.length === 1 ? '' : 's'
                        }${library.analysed ? `, ${library.analysed} analysed` : ''}.`)}
                </p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {library.roots.length > 0 && (
                  <>
                    <button
                      onClick={() => void run((api) => api.reindexSamples({}))}
                      disabled={busy || !desktop || !!data?.indexing || !!data?.analysing}
                      className={smallButton}
                    >
                      Re-index
                    </button>
                    <button
                      onClick={() =>
                        void run((api) =>
                          data?.analysing ? api.stopAnalysis({}) : api.analyseSamples({}),
                        )
                      }
                      disabled={busy || !desktop || !!data?.indexing}
                      className={smallButton}
                    >
                      {data?.analysing ? 'Stop analysis' : 'Analyse key & tempo'}
                    </button>
                  </>
                )}
                <button
                  onClick={() => void run((api) => api.addSampleFolder({}))}
                  disabled={busy || !desktop || !!data?.indexing}
                  className={smallButton}
                >
                  Add folder
                </button>
              </div>
            </div>
            {library.roots.length > 0 && (
              <ul className="mt-2 max-h-16 space-y-1 overflow-y-auto border-t border-line/60 pt-2 tall:mt-3 tall:max-h-28 tall:pt-3">
                {library.roots.map((root) => (
                  <li key={root.path} className="flex items-center gap-3 text-[11px] text-muted">
                    <span className="truncate" title={root.path}>
                      {root.path}
                    </span>
                    <span className="ml-auto shrink-0">
                      {root.error
                        ? `Failed: ${root.error}`
                        : `${root.count} samples${root.truncated ? ' · truncated at cap' : ''}`}
                    </span>
                    <button
                      onClick={() => void run((api) => api.removeSampleFolder({ path: root.path }))}
                      disabled={busy || !!data?.indexing}
                      aria-label={`Remove ${root.path}`}
                      className="shrink-0 rounded px-1.5 text-muted hover:text-paper disabled:opacity-40"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
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
                : unchanged
                  ? 'Back to the studio'
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
          {/* The partner is switchable here: a producer should not have to
              leave the session to change who they are working with. */}
          <div className="relative">
            <label htmlFor="partner-select" className="sr-only">
              Creative partner
            </label>
            <select
              id="partner-select"
              value={runtime?.provider ?? partner}
              disabled={busy || turnRunning || !connected}
              onChange={(event) => {
                const next = event.target.value as ProviderId;
                setPartner(next);
                void run((api) => api.setProvider({ provider: next }));
              }}
              className={`appearance-none rounded-full border py-1.5 pl-7 pr-7 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                connected ? 'border-accent/30 bg-accent/5 text-paper' : 'border-line text-muted'
              }`}
            >
              {partnerOptions.map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  disabled={!!option.unavailable}
                  className="bg-panel text-paper"
                >
                  {option.title}
                  {option.id !== 'demo' ? ' · live' : ''}
                  {option.unavailable ? ' (unavailable)' : ''}
                </option>
              ))}
            </select>
            <span
              className={`pointer-events-none absolute left-2.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full ${
                connected ? 'bg-accent' : 'bg-muted'
              }`}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-muted">
              ▼
            </span>
          </div>
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
          Connect the {adapter === 'bridge' ? 'live bridge' : 'mock session'} to continue.
          <button onClick={() => void connect()} className={smallButton} disabled={busy}>
            Connect {adapter === 'bridge' ? 'live bridge' : 'mock session'}
          </button>
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(360px,1fr)_300px] xl:grid-cols-[230px_minmax(400px,1fr)_330px]">
        <aside className="flex min-h-0 flex-col border-r border-line bg-panel/40">
          <div className="border-b border-line p-5">
            <p className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-muted">PROJECT</p>
            <h2 className="truncate text-sm font-medium" title={project?.name ?? undefined}>
              {projectTitle}
            </h2>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
              <span className="h-1 w-1 shrink-0 rounded-full bg-accent" />
              <span className="truncate">{projectSubtitle ?? environment}</span>
              <span className="ml-auto shrink-0 rounded bg-raised px-1.5 py-0.5 text-[9px]">
                {sessionBadge}
              </span>
            </div>
          </div>
          <div className="px-3 py-5">
            <p className="mb-3 px-2 text-[10px] font-semibold tracking-[0.16em] text-muted">
              TRACKS <span className="float-right">{project?.tracks.length ?? 0}</span>
            </p>
            {connected && project?.tracks.length === 0 && (
              <p className="px-2 text-[10px] leading-4 text-muted/60">
                This session has no tracks yet.
              </p>
            )}
            {project?.tracks.map((track, i) => (
              <div key={track.id} className="mb-1 rounded-lg px-2 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span
                    className={`h-7 w-0.5 rounded ${['bg-warm', 'bg-accent', 'bg-sky-300', 'bg-violet-300'][i % 4]}`}
                  />
                  <Icon
                    kind={track.type === 'audio' ? 'wave' : 'settings'}
                    className="text-muted"
                  />
                  <span className={`truncate ${track.mute ? 'text-muted line-through' : ''}`}>
                    {track.name}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 font-mono text-[9px]">
                    {track.solo && <span className="text-warm">S</span>}
                    {track.mute && <span className="text-muted">M</span>}
                    {/* The fader position the DAW reports, shown as a percentage
                        rather than a decibel figure this project would invent. */}
                    <span className="text-muted">{Math.round(track.volume * 100)}%</span>
                  </span>
                </div>
                <div className="ml-6 mt-1.5 h-0.5 rounded bg-line">
                  <div
                    className={`h-0.5 rounded ${track.mute ? 'bg-line' : 'bg-accent/60'}`}
                    style={{ width: `${Math.round(track.volume * 100)}%` }}
                  />
                </div>
                {track.plugin && (
                  <div className="ml-6 mt-2 space-y-1">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span
                        className={track.plugin.bypassed ? 'text-muted line-through' : 'text-muted'}
                      >
                        {track.plugin.name}
                      </span>
                      {track.plugin.bypassed && <span className="text-warm">bypassed</span>}
                    </div>
                    {/* Only what the session has mapped: other parameters are
                        not reachable, and an empty row would imply they were. */}
                    {track.plugin.quickControls.map((control) => (
                      <div key={control.index} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 truncate text-[9px] text-muted/70">
                          {control.name}
                        </span>
                        <span className="h-0.5 flex-1 rounded bg-line">
                          <span
                            className="block h-0.5 rounded bg-accent/40"
                            style={{ width: `${Math.round(control.value * 100)}%` }}
                          />
                        </span>
                        <span className="w-7 shrink-0 text-right font-mono text-[9px] text-muted/60">
                          {Math.round(control.value * 100)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {project?.tracksTruncated && (
              <p className="mt-2 px-2 text-[9px] leading-4 text-muted/60">
                Showing the first bank of channels; this project may have more.
              </p>
            )}
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
          <div className="flex min-h-0 shrink-0 flex-col border-t border-line px-5 py-4">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Icon kind="wave" />
              Generated clips
              <span className="ml-auto text-[10px] text-muted/60">{artifacts.length}</span>
            </div>
            {artifacts.length === 0 ? (
              <p className="mt-2 text-[10px] leading-4 text-muted/60">
                Clips you ask for appear here as MIDI files to drop onto a track.
              </p>
            ) : (
              <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
                {artifacts.map((artifact) => (
                  <li
                    key={artifact.id}
                    draggable
                    onDragStart={(event) => {
                      // The desktop process owns the drag; the browser's own
                      // drag data cannot carry a file into another application.
                      event.preventDefault();
                      void run((api) => api.dragArtifact({ id: artifact.id }));
                    }}
                    title={`${artifact.summary}\n${artifact.path}`}
                    className="group cursor-grab rounded border border-line/60 px-2 py-1.5 text-[11px] transition hover:border-accent/40 active:cursor-grabbing"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-paper/90">{artifact.kind}</span>
                      <span className="shrink-0 text-muted/70">
                        {artifact.bars} bars · {artifact.key} {artifact.scale}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => void run((api) => api.revealArtifact({ id: artifact.id }))}
                        className="text-[10px] text-muted hover:text-paper"
                      >
                        Reveal
                      </button>
                      <button
                        onClick={() => void run((api) => api.removeArtifact({ id: artifact.id }))}
                        className="text-[10px] text-muted hover:text-warm"
                      >
                        Remove
                      </button>
                      <span className="ml-auto text-[9px] text-muted/50">drag to Cubase</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex min-h-0 shrink-0 flex-col border-t border-line px-5 py-4">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Icon kind="folder" />
              Sample libraries
              <span className="ml-auto text-[10px] text-muted/60">{library.total}</span>
            </div>
            {library.roots.length === 0 ? (
              <p className="mt-2 text-[10px] leading-4 text-muted/60">
                No folder added yet. Add one in{' '}
                <Link href="/" className="underline">
                  connection settings
                </Link>
                .
              </p>
            ) : (
              <>
                <form
                  className="mt-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    // "Am" or "F#" is a key, not a filename: search musically.
                    const musical = /^([A-Ga-g][#b]?)(m|maj|min|minor|major)?$/.exec(
                      sampleQuery.trim(),
                    );
                    void run((api) =>
                      api.searchSamples(
                        musical
                          ? { query: '', key: musical[1].toUpperCase() }
                          : { query: sampleQuery },
                      ),
                    );
                  }}
                >
                  <label htmlFor="sample-search" className="sr-only">
                    Search samples
                  </label>
                  <input
                    id="sample-search"
                    value={sampleQuery}
                    onChange={(event) => setSampleQuery(event.target.value)}
                    placeholder="Search samples, or a key like Am"
                    maxLength={120}
                    className="w-full rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[11px] placeholder:text-muted/60"
                  />
                </form>
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                  {(data?.samples ?? []).map((sample) => (
                    <li key={sample.id}>
                      <button
                        onClick={() => setPreview(sample.path)}
                        title={sample.path}
                        className={`w-full truncate rounded px-1.5 py-1 text-left text-[11px] transition hover:bg-raised ${
                          preview === sample.path ? 'text-accent' : 'text-muted'
                        }`}
                      >
                        <span className="block truncate">{sample.name}</span>
                        <span className="block truncate text-[10px] text-muted/60">
                          {sample.durationMs !== null &&
                            `${(sample.durationMs / 1000).toFixed(1)}s`}
                          {/* Estimated, and said so: a key read as fact would
                              send a producer to the wrong sound. */}
                          {sample.estimatedKey &&
                            ` · ~${sample.estimatedKey}${sample.estimatedScale === 'minor' ? 'm' : ''} ${Math.round((sample.keyConfidence ?? 0) * 100)}%`}
                          {sample.estimatedTempo &&
                            ` · ~${Math.round(sample.estimatedTempo)} BPM ${Math.round((sample.tempoConfidence ?? 0) * 100)}%`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {sampleQuery && (data?.samples ?? []).length === 0 && (
                  <p className="mt-2 text-[10px] text-muted/60">
                    No sample matched. Searches run against the local index only.
                  </p>
                )}
                {preview && (
                  <audio
                    key={preview}
                    controls
                    // Served only for indexed files, through the confined protocol.
                    src={`orchestra-sample://local${encodeURI(preview)}`}
                    onError={() => setPreviewError(preview)}
                    className="mt-2 h-8 w-full"
                  />
                )}
                {previewError === preview && preview && (
                  <p className="mt-1 text-[10px] text-warm">
                    This format cannot be previewed here. The file is untouched on disk.
                  </p>
                )}
              </>
            )}
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
              {(['ask', 'assist', 'agent'] as const).map((m) => (
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
          {mode === 'agent' && (
            <div className="shrink-0 border-b border-line bg-warm/5 px-7 py-4">
              {!activeRun ? (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-warm">
                    Agent mode changes tempo, transport, and track levels{' '}
                    <strong className="font-semibold">without asking</strong>, within the limits you
                    set here.
                  </span>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span className="sr-only">Write limit</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={runWrites}
                      onChange={(event) => setRunWrites(Number(event.target.value))}
                      className="w-14 rounded border border-line bg-panel px-1.5 py-1 text-[11px]"
                    />
                    changes
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span className="sr-only">Time limit in minutes</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={runMinutes}
                      onChange={(event) => setRunMinutes(Number(event.target.value))}
                      className="w-14 rounded border border-line bg-panel px-1.5 py-1 text-[11px]"
                    />
                    minutes
                  </label>
                  <button
                    disabled={busy || !connected}
                    onClick={() =>
                      void run((api) =>
                        api.startRun({
                          budget: {
                            maxWrites: Math.max(1, Math.min(50, runWrites)),
                            maxSeconds: Math.max(10, Math.min(1800, runMinutes * 60)),
                          },
                        }),
                      )
                    }
                    className="rounded-lg bg-warm/80 px-3 py-1.5 text-[11px] font-semibold text-ink disabled:opacity-40"
                  >
                    Start run
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="flex items-center gap-2 text-warm">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warm" />
                    Run in progress
                  </span>
                  <span className="text-[11px] text-muted">
                    {activeRun.writes} of {activeRun.budget.maxWrites} changes ·{' '}
                    {Math.max(
                      0,
                      Math.ceil(
                        activeRun.budget.maxSeconds -
                          (Date.now() - new Date(activeRun.startedAt).getTime()) / 1000,
                      ),
                    )}
                    s left
                  </span>
                  {/* Always reachable while a run is going. */}
                  <button
                    onClick={() => void run((api) => api.stopRun({}))}
                    className="ml-auto rounded-lg border border-warm/50 px-3 py-1.5 text-[11px] text-warm"
                  >
                    Stop run
                  </button>
                </div>
              )}
              {finishedRun && (
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
                  <span>
                    Run ended: {runEndings[finishedRun.endedBecause ?? 'stopped']} after{' '}
                    {finishedRun.writes} change{finishedRun.writes === 1 ? '' : 's'}.
                  </span>
                  {!finishedRun.undone && (
                    <button
                      disabled={busy || !conversationId}
                      onClick={() =>
                        void run((api) => api.undoRun({ id: finishedRun.id, conversationId }))
                      }
                      className="rounded border border-line px-2 py-1 hover:border-muted hover:text-paper disabled:opacity-40"
                    >
                      Undo the run
                    </button>
                  )}
                  {finishedRun.undone && <span className="text-accent">Undone.</span>}
                </div>
              )}
            </div>
          )}
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
                  Explore your session with {runtime?.providerLabel ?? 'the Demo agent'}. Every
                  action stays visible, and every change starts with you.
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
              <div className="space-y-8" data-testid="transcript">
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
                        {/* The provider stored with the message, so a transcript
                            read later cannot confuse a fixture with a model. */}
                        {message.role === 'assistant' ? message.provider : 'You'}
                      </span>
                      <time className="ml-auto font-mono text-[9px] text-muted">
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                    {message.role === 'assistant' ? (
                      <div className="break-words text-paper/85">
                        <RichText text={message.content} />
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-sm leading-7 text-paper/85">
                        {message.content}
                      </p>
                    )}
                    {message.role === 'assistant' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {calls
                          .filter(
                            (call) =>
                              call.conversationId === message.conversationId &&
                              call.agent !== 'user' &&
                              Math.abs(
                                new Date(call.timestamp).getTime() -
                                  new Date(message.timestamp).getTime(),
                              ) < 120000,
                          )
                          .map((call) => (
                            <ToolChip
                              key={call.id}
                              tool={call.tool}
                              status={call.status}
                              args={JSON.stringify(call.arguments)}
                            />
                          ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            {turnRunning && (
              <div className="mt-8 space-y-4">
                {streaming?.text ? (
                  <StreamingMessage provider={providerLabel} text={streaming.text} />
                ) : (
                  <ThinkingBubble label={providerLabel} />
                )}
                {runningTool && (
                  <ToolChip
                    tool={runningTool.tool}
                    status={runningTool.status}
                    args={JSON.stringify(runningTool.arguments)}
                  />
                )}
              </div>
            )}
            {failedTurn && (
              <div className="mt-8">
                <TurnError
                  message={failedTurn.detail}
                  onRetry={
                    content.trim() || !connected
                      ? undefined
                      : () => {
                          const last = [...messages].reverse().find((m) => m.role === 'user');
                          if (last) setContent(last.content);
                        }
                  }
                />
              </div>
            )}
            <div ref={end} />
          </div>
          <div className="shrink-0 px-6 pb-5">
            {/* The beam only paints while active, so it stays on and its
                strength carries the state: lit at rest so the composer reads as
                the AI surface, brighter while a turn runs. */}
            <BorderBeam
              size="md"
              colorVariant="colorful"
              strength={turnRunning ? 1 : 0.8}
              active={beamActive}
              theme="dark"
              className="rounded-xl"
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
                className="rounded-xl border border-line/70 bg-panel p-4 transition-colors focus-within:border-accent/40"
              >
                <label htmlFor="composer" className="sr-only">
                  Message {runtime?.providerLabel ?? 'Demo agent'}
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
                  className="w-full resize-none bg-transparent text-sm leading-6 placeholder:text-muted/60 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <div className="mt-3 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[10px] text-muted">
                    <Icon kind="spark" />
                    {runtime?.providerLabel ?? 'Demo agent'} ·{' '}
                    {runtime?.providerLive ? 'Live model' : 'Local only'}
                    <span className="mx-1 text-line">|</span>
                    {mode === 'ask' ? 'Read-only session' : 'Changes need approval'}
                    <span className="mx-1 hidden text-line xl:inline">|</span>
                    <span className="hidden text-muted/60 xl:inline">
                      <kbd className="font-mono">↵</kbd> send · <kbd className="font-mono">⇧↵</kbd>{' '}
                      newline
                    </span>
                  </span>
                  {turnRunning ? (
                    <button
                      type="button"
                      onClick={() => void run((api) => api.cancel({}))}
                      className={`${smallButton} flex items-center gap-2`}
                    >
                      <span className="h-2 w-2 rounded-sm bg-warm" />
                      Stop
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
            </BorderBeam>
            <p className="mt-2 text-center text-[9px] text-muted/60">
              {runtime?.providerLive
                ? `${runtime.providerLabel} responses come from a live model.`
                : 'Demo responses are deterministic.'}{' '}
              {isMock ? 'Your real DAW is not connected.' : 'Writes reach the connected session.'}
            </p>
          </div>
        </section>
        <aside className="flex min-h-0 flex-col border-l border-line bg-panel/40">
          <section className="border-b border-line p-5">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-[10px] font-semibold tracking-[0.16em] text-muted">
                SESSION CONTEXT
              </h2>
              <span className="text-[9px] text-muted">{sessionBadge}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <p className="font-mono text-2xl" data-testid="tempo">
                  {project?.tempo ?? '—'}
                </p>
                <p className="mt-1 text-[9px] text-muted">BPM</p>
              </div>
              <div>
                <p className="truncate text-xl" title={project?.key ?? undefined}>
                  {project?.key ?? '—'}
                </p>
                <p className="mt-1 text-[9px] text-muted">KEY</p>
              </div>
              <div>
                <p className="font-mono text-xl">{project?.timeSignature ?? '—'}</p>
                <p className="mt-1 text-[9px] text-muted">SIGNATURE</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-[11px] text-muted">
              <span>Execution environment</span>
              <span className="truncate pl-3 text-paper">{environment}</span>
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
          <span className="text-muted">{project?.timeSignature ?? '—'}</span>
        </div>
        <span className="text-[10px] text-muted">
          {isMock ? 'Mock transport · No audio output' : `${environment} · Live transport`}
        </span>
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
