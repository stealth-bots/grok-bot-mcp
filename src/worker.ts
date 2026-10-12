import { loadRuntime, pickEnv, type WorkerEnvKey } from './adapters/runtime';
import { createApp, type App } from './core/app';
import { json } from './core/http';
import type { AppConfig } from './core/types';
import { D1BindingRequiredError, type D1Database } from './lib/job-store';

export interface WorkerEnv extends Partial<Record<WorkerEnvKey, string>> {
  DB?: D1Database;
}

let cached: { fingerprint: string; app: App } | undefined;

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    try {
      return await appFor(env).fetch(request);
    } catch (error) {
      if (error instanceof D1BindingRequiredError) {
        console.info(JSON.stringify({ event: 'worker_misconfigured', missing: ['DB'] }));
        return json({ error: 'misconfigured' }, 503);
      }
      if (error instanceof WorkerConfigError) {
        console.info(JSON.stringify({ event: 'worker_misconfigured', missing: error.missing }));
        return json({ error: 'misconfigured' }, 503);
      }
      const name = error instanceof Error ? error.name : 'Error';
      console.info(JSON.stringify({ event: 'worker_error', name }));
      return json({ error: 'server_error' }, 500);
    }
  },
};

export default worker;

export class WorkerConfigError extends Error {
  constructor(readonly missing: readonly string[]) {
    super('Worker configuration is incomplete');
    this.name = 'WorkerConfigError';
  }
}

function appFor(env: WorkerEnv): App {
  const fingerprint = cacheFingerprint(env);
  if (cached?.fingerprint === fingerprint) return cached.app;
  const runtime = loadWorkerRuntime(env);
  assertWorkerSecrets(runtime.config);
  const app = createApp({
    config: runtime.config,
    store: runtime.selection.store,
    log: runtime.log,
  });
  cached = { fingerprint, app };
  return app;
}

function loadWorkerRuntime(env: WorkerEnv): ReturnType<typeof loadRuntime> {
  try {
    return loadRuntime(pickEnv(env), { target: 'worker', db: env.DB });
  } catch (error) {
    if (error instanceof D1BindingRequiredError) throw error;
    if (error instanceof Error && error.message.includes('MCP_API_KEY')) {
      throw new WorkerConfigError(['MCP_API_KEY']);
    }
    throw error;
  }
}

function assertWorkerSecrets(config: AppConfig): void {
  const missing: string[] = [];
  if (!config.webhookUrl) missing.push('GROK_BOT_WEBHOOK_URL');
  if (!config.webhookKey) missing.push('GROK_BOT_WEBHOOK_KEY');
  if (!config.replySecret) missing.push('REPLY_SECRET');
  if (!config.publicBaseUrl) missing.push('PUBLIC_BASE_URL');
  if (config.apiKeys.length === 0) missing.push('MCP_API_KEY');
  if (missing.length > 0) throw new WorkerConfigError(missing);
}

function cacheFingerprint(env: WorkerEnv): string {
  const values = pickEnv(env);
  const parts = Object.keys(values)
    .sort()
    .map((key) => `${key}=${values[key] ?? ''}`);
  parts.push(env.DB ? 'd1' : 'nod1');
  return parts.join('\n');
}
