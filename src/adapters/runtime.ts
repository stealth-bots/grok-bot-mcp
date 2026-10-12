import { configFromEnv, readUpstash, type EnvMap } from '../core/config';
import { createLogger } from '../core/log';
import type { AppConfig, LogFn } from '../core/types';
import { createJobStore, type D1Database, type StoreSelection } from '../lib/job-store';

export type RuntimeOptions = {
  now?: () => number;
  fetchImpl?: typeof fetch;
  log?: LogFn;
} & ({ target: 'worker'; db?: D1Database } | { target: 'node' } | { target: 'dev' });

export function loadRuntime(
  env: EnvMap,
  options: RuntimeOptions,
): { config: AppConfig; selection: StoreSelection; log: LogFn } {
  const config = configFromEnv(env);
  const selection = selectStore(env, options);
  const log = options.log ?? createLogger((line) => console.info(line));
  log('store_selected', { store: selection.kind });
  return { config, selection, log };
}

function selectStore(env: EnvMap, options: RuntimeOptions): StoreSelection {
  switch (options.target) {
    case 'worker':
      return createJobStore({ target: 'worker', db: options.db, now: options.now });
    case 'node':
      return createJobStore({
        target: 'node',
        upstash: readUpstash(env),
        now: options.now,
        fetchImpl: options.fetchImpl,
      });
    case 'dev':
      return createJobStore({ target: 'dev', now: options.now });
    default: {
      const _never: never = options;
      return _never;
    }
  }
}

export const WORKER_ENV_KEYS = [
  'GROK_BOT_WEBHOOK_URL',
  'GROK_BOT_WEBHOOK_KEY',
  'REPLY_SECRET',
  'MCP_API_KEY',
  'PUBLIC_BASE_URL',
  'WAIT_SECONDS',
  'JOB_TTL_SECONDS',
  'MAX_MESSAGE_BYTES',
  'WEBHOOK_TIMEOUT_MS',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
] as const;

export type WorkerEnvKey = (typeof WORKER_ENV_KEYS)[number];

export function pickEnv(source: Partial<Record<WorkerEnvKey, unknown>>): EnvMap {
  const env: EnvMap = {};
  for (const key of WORKER_ENV_KEYS) {
    const value = source[key];
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}
