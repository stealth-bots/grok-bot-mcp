import { createApp, type App } from './core/app';
import { json } from './core/http';
import type { KvBinding } from './core/kv-store';
import { loadRuntime, pickEnv, type WorkerEnvKey } from './adapters/runtime';

export interface WorkerEnv extends Partial<Record<WorkerEnvKey, string>> {
  JOBS?: KvBinding;
}

let cached: { fingerprint: string; app: App } | undefined;

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      return await appFor(env).fetch(request);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      console.info(JSON.stringify({ event: 'worker_error', name }));
      return json({ error: 'server_error' }, 500);
    }
  },
};

export default worker;

function appFor(env: WorkerEnv): App {
  const fingerprint = cacheFingerprint(env);
  if (cached?.fingerprint === fingerprint) return cached.app;
  const runtime = loadRuntime(pickEnv(env), { kv: env.JOBS });
  const app = createApp({
    config: runtime.config,
    store: runtime.selection.store,
    log: runtime.log,
  });
  cached = { fingerprint, app };
  return app;
}

function cacheFingerprint(env: WorkerEnv): string {
  const values = pickEnv(env);
  const parts = Object.keys(values)
    .sort()
    .map((key) => `${key}=${values[key] ?? ''}`);
  parts.push(env.JOBS ? 'kv' : 'nokv');
  return parts.join('\n');
}
