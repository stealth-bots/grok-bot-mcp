import { describe, expect, it } from 'vitest';
import type { D1Database } from '../src/lib/job-store';
import worker, { type WorkerEnv } from '../src/worker';

const db: D1Database = {
  prepare() {
    throw new Error('unused');
  },
};

function workerEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    GROK_BOT_WEBHOOK_URL: 'https://bot.example/webhook',
    GROK_BOT_WEBHOOK_KEY: 'webhook-key',
    REPLY_SECRET: 'reply-secret',
    MCP_API_KEY: 'claude:claude-secret',
    PUBLIC_BASE_URL: 'https://mcp.example',
    ...overrides,
  };
}

describe('worker configuration', () => {
  it('fails closed when the D1 binding is missing', async () => {
    const response = await worker.fetch(new Request('https://mcp.example/'), workerEnv());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'misconfigured' });
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('fails closed when Upstash is set and D1 is missing', async () => {
    const response = await worker.fetch(
      new Request('https://mcp.example/'),
      workerEnv({
        UPSTASH_REDIS_REST_URL: 'https://redis.example',
        UPSTASH_REDIS_REST_TOKEN: 'token',
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'misconfigured' });
  });

  it('fails closed when a required secret is missing', async () => {
    const env = workerEnv({ DB: db });
    delete env.REPLY_SECRET;
    const response = await worker.fetch(new Request('https://mcp.example/'), env);
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: 'misconfigured' });
    expect(text).not.toContain('webhook-key');
    expect(text).not.toContain('claude-secret');
  });

  it('serves when D1 and the required secrets are set', async () => {
    const response = await worker.fetch(new Request('https://mcp.example/'), workerEnv({ DB: db }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, mcp: '/api/mcp' });
  });

  it('serves when D1 is set even if Upstash credentials are incomplete', async () => {
    const response = await worker.fetch(
      new Request('https://mcp.example/'),
      workerEnv({ DB: db, UPSTASH_REDIS_REST_URL: 'https://redis.example' }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });
});
