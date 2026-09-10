import { execFile } from 'node:child_process';
import { errorText, type ProviderId } from '@orchestrai/shared-types';

/**
 * Discovery deliberately never executes a discovered binary: finding `claude`
 * on PATH says nothing about whether running it is wanted. Checking
 * authentication necessarily executes it, so verification is a separate,
 * user-initiated step that runs only the CLI's own status command.
 */
export interface VerificationResult {
  authentication: 'authenticated' | 'unauthenticated' | 'failed';
  account: string | null;
  version: string | null;
  error: string | null;
}
export const VERIFY_TIMEOUT_MS = 15000;
const MAX_OUTPUT_BYTES = 64 * 1024;

type Runner = (
  executable: string,
  args: string[],
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const defaultRunner: Runner = (executable, args) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: VERIFY_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        const failed = error as
          | (NodeJS.ErrnoException & { killed?: boolean; code?: number })
          | null;
        if (failed?.killed) return reject(new Error('The status command timed out.'));
        if (failed && typeof failed.code !== 'number' && failed.code !== undefined)
          return reject(new Error(errorText(failed)));
        resolve({ code: failed?.code ?? 0, stdout, stderr });
      },
    );
  });

/** Claude Code prints JSON; Codex prints a single human-readable line. */
function readClaude(stdout: string): VerificationResult {
  const parsed = JSON.parse(stdout) as {
    loggedIn?: unknown;
    email?: unknown;
    authMethod?: unknown;
  };
  if (typeof parsed.loggedIn !== 'boolean') throw new Error('No loggedIn field in status output.');
  return {
    authentication: parsed.loggedIn ? 'authenticated' : 'unauthenticated',
    account:
      typeof parsed.email === 'string'
        ? parsed.email
        : typeof parsed.authMethod === 'string'
          ? parsed.authMethod
          : null,
    version: null,
    error: parsed.loggedIn ? null : 'Not signed in. Run: claude auth login',
  };
}
function readCodex(stdout: string): VerificationResult {
  const text = stdout.trim();
  if (/not logged in|logged out|no credentials/i.test(text) || text === '')
    return {
      authentication: 'unauthenticated',
      account: null,
      version: null,
      error: 'Not signed in. Run: codex login',
    };
  if (!/logged in/i.test(text))
    throw new Error(`Unrecognized status output: ${text.slice(0, 120)}`);
  return {
    authentication: 'authenticated',
    account: text.replace(/^logged in (using|as)\s*/i, '').trim() || null,
    version: null,
    error: null,
  };
}
const definitions = {
  claude: { statusArgs: ['auth', 'status'], read: readClaude, signIn: 'claude auth login' },
  codex: { statusArgs: ['login', 'status'], read: readCodex, signIn: 'codex login' },
} as const;
export type VerifiableAgent = keyof typeof definitions;
export const isVerifiable = (id: ProviderId): id is VerifiableAgent => id in definitions;

export async function verifyAgent(
  id: VerifiableAgent,
  executable: string,
  run: Runner = defaultRunner,
): Promise<VerificationResult> {
  const definition = definitions[id];
  let version: string | null = null;
  try {
    const result = await run(executable, ['--version']);
    version = result.stdout.trim().split('\n')[0].slice(0, 60) || null;
  } catch {
    // A missing --version is not itself a failure to authenticate.
  }
  try {
    const { stdout, stderr, code } = await run(executable, [...definition.statusArgs]);
    const text = stdout.trim() ? stdout : stderr;
    if (!text.trim())
      return {
        authentication: 'unauthenticated',
        account: null,
        version,
        error: `No status output (exit ${code}). Sign in with: ${definition.signIn}`,
      };
    return { ...definition.read(text), version };
  } catch (error) {
    return {
      authentication: 'failed',
      account: null,
      version,
      error: errorText(error).slice(0, 300),
    };
  }
}
