import { createApp, type App } from '../core/app';
import { loadRuntime } from './runtime';

let app: App | undefined;

export function getNodeApp(): App {
  if (app) return app;
  if (process.env.VERCEL && !hasRedisRest(process.env)) {
    throw new Error(
      'Upstash Redis REST credentials are required on Vercel. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL and KV_REST_API_TOKEN).',
    );
  }
  const runtime = loadRuntime(process.env, { allowMemory: !process.env.VERCEL });
  app = createApp({ config: runtime.config, store: runtime.selection.store, log: runtime.log });
  return app;
}

function hasRedisRest(env: NodeJS.ProcessEnv): boolean {
  const upstash = Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
  const kv = Boolean(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
  return upstash || kv;
}
