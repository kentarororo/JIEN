import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PUBLIC_ENV_ALIASES = {
  EXPO_PUBLIC_SUPABASE_URL: [
    'EXPO_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
  ],
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: [
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ],
};

function firstValue(environment, names) {
  for (const name of names) {
    const value = environment[name]?.trim();
    // A value such as "$SUPABASE_URL" is a UI alias, not a usable client
    // value unless the host expanded it before invoking the build.
    if (value && !value.startsWith('$')) return { name, value };
  }
  return null;
}

export function resolvePublicSupabaseEnvironment(environment) {
  const url = firstValue(environment, PUBLIC_ENV_ALIASES.EXPO_PUBLIC_SUPABASE_URL);
  const key = firstValue(
    environment,
    PUBLIC_ENV_ALIASES.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  if (!url || !key) {
    throw new Error(
      'Supabase web configuration is missing. Connect Supabase to Vercel or set '
      + 'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url.value);
  } catch {
    throw new Error(`${url.name} is not a valid absolute URL.`);
  }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error(`${url.name} must use HTTPS or HTTP.`);
  }

  return {
    EXPO_PUBLIC_SUPABASE_URL: url.value.replace(/\/$/, ''),
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key.value,
    sources: { key: key.name, url: url.name },
  };
}

function runNodeScript(projectRoot, scriptPath, args, environment) {
  const result = spawnSync(
    process.execPath,
    [path.join(projectRoot, scriptPath), ...args],
    { cwd: projectRoot, env: environment, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function buildWeb(projectRoot = process.cwd(), environment = process.env) {
  const resolved = resolvePublicSupabaseEnvironment(environment);
  const buildEnvironment = {
    ...environment,
    EXPO_PUBLIC_SUPABASE_URL: resolved.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: resolved.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };

  console.log(
    `Supabase web configuration: ${resolved.sources.url} + ${resolved.sources.key}`,
  );
  // Expo public values are compiled into the client bundle. A clean transform
  // prevents Vercel's restored Metro cache from reusing a bundle produced
  // before the Supabase integration variables existed.
  runNodeScript(
    projectRoot,
    'node_modules/expo/bin/cli',
    ['export', '--platform', 'web', '--clear'],
    buildEnvironment,
  );
  runNodeScript(projectRoot, 'scripts/finalize-web-build.mjs', [], buildEnvironment);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildWeb();
}
