import { configFromEnv, type EnvMap } from '../core/config';
import { createLogger } from '../core/log';
import { createStore, type StoreSelection } from '../core/store-factory';
import type { AppConfig, LogFn } from '../core/types';
import type { KvBinding } from '../core/kv-store';

export function loadRuntime(
  env: EnvMap,
  options?: {
    kv?: KvBinding;
    now?: () => number;
    fetchImpl?: typeof fetch;
    log?: LogFn;
    allowMemory?: boolean;
  },
): { config: AppConfig; selection: StoreSelection; log: LogFn } {
  const config = configFromEnv(env);
  const selection = createStore(env, options);
  const log = options?.log ?? createLogger((line) => console.info(line));
  log('store_selected', { store: selection.kind });
  return { config, selection, log };
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
