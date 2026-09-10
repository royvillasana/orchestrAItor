export * from './verify';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { errorText, type DiscoveredAgent } from '@orchestrai/shared-types';

export function candidatePaths(
  executable: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
) {
  const windows = platform === 'win32';
  const p = windows ? path.win32 : path.posix;
  const dirs = (env.PATH ?? env.Path ?? '').split(windows ? ';' : ':').filter(Boolean);
  dirs.push(
    ...(windows
      ? [
          p.join(home, 'AppData', 'Roaming', 'npm'),
          p.join(home, '.local', 'bin'),
          p.join(home, 'scoop', 'shims'),
        ]
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          p.join(home, '.local', 'bin'),
          p.join(home, '.npm-global', 'bin'),
          p.join(home, '.cargo', 'bin'),
        ]),
  );
  const extensions = windows
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .filter((x) => /^\.(exe|cmd|bat|com)$/i.test(x))
    : [''];
  return [
    ...new Set(
      dirs
        .filter((d) => p.isAbsolute(d))
        .flatMap((d) => extensions.map((ext) => p.join(d, executable + ext.toLowerCase()))),
    ),
  ];
}
export async function discoverAgents(
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string } = {},
): Promise<DiscoveredAgent[]> {
  const platform = options.platform ?? process.platform;
  return Promise.all(
    [
      ['claude-code', 'Claude Code', 'claude'],
      ['codex', 'Codex', 'codex'],
      ['openai-cli', 'OpenAI CLI', 'openai'],
    ].map(async ([id, name, bin]) => {
      const errors: string[] = [];
      const found = new Set<string>();
      for (const candidate of candidatePaths(
        bin,
        options.env ?? process.env,
        platform,
        options.home ?? homedir(),
      )) {
        try {
          if (!(await stat(candidate)).isFile()) continue;
          await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
          found.add(await realpath(candidate));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            errors.push(`${candidate}: ${errorText(error)}`);
        }
      }
      const executable = [...found][0] ?? null;
      return {
        id,
        name,
        installed: executable !== null,
        executable,
        status: executable ? 'detected' : 'missing',
        // Discovery reports only what exists; authentication requires the
        // explicit, executing verification step.
        authentication: 'unverified',
        account: null,
        version: null,
        errors,
      };
    }),
  );
}
