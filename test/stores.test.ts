import { describe, expect, it } from 'vitest';
import { configFromEnv, readUpstash } from '../src/core/config';
import { MAX_WAIT_SECONDS } from '../src/core/constants';
import { handleReply } from '../src/core/reply';
import { UpstashJobStore, type JobRecord } from '../src/lib/job-store';
import { fakeRedis } from './fake-upstash';

const job = (status: JobRecord['status'] = 'pending'): JobRecord => ({
  status,
  caller: 'claude',
  createdAt: 0,
});

describe('UpstashJobStore', () => {
  it('sends REST commands and does not log the token', async () => {
    const redis = fakeRedis();
    const store = new UpstashJobStore('https://redis.example', 'secret-token', redis.fetchImpl, () => 0);
    expect(await store.create('job-1', job(), 60)).toBe(true);
    expect(await store.create('job-1', job(), 60)).toBe(false);
    expect(await store.get('job-1')).toMatchObject({ status: 'pending' });
    expect(await store.complete('job-1', { ...job('done'), reply: 'yes' }, 60)).toBe('updated');
    expect(await store.complete('job-1', { ...job('done'), reply: 'no' }, 60)).toBe('not_pending');
    expect(redis.commands.some((command) => command.includes('secret-token'))).toBe(false);
  });

  it('completes with one EVAL that keeps the original TTL', async () => {
    const redis = fakeRedis();
    const store = new UpstashJobStore('https://redis.example', 'secret-token', redis.fetchImpl, () => 0);
    const key = 'grok-bot-mcp:job:job-1';
    expect(await store.create('job-1', job(), 90)).toBe(true);
    expect(redis.ttls.get(key)).toBe(90);

    expect(await store.complete('job-1', { ...job('done'), reply: 'first' }, 90)).toBe('updated');
    const evals = redis.commands.filter((command) => command[0] === 'EVAL');
    expect(evals).toHaveLength(1);
    const script = evals[0]?.[1] ?? '';
    expect(script).toContain("redis.call('GET', KEYS[1])");
    expect(script).toContain('current["status"] ~= "pending"');
    expect(script).toContain("'KEEPTTL'");
    expect(evals[0]?.slice(2)).toEqual([
      '1',
      key,
      JSON.stringify({ ...job('done'), reply: 'first' }),
    ]);
    expect(evals[0]).not.toContain('EX');
    expect(redis.ttls.get(key)).toBe(90);
    expect(await store.get('job-1')).toMatchObject({ status: 'done', reply: 'first' });

    expect(await store.complete('job-1', { ...job('done'), reply: 'second' }, 90)).toBe('not_pending');
    expect(await store.get('job-1')).toMatchObject({ reply: 'first' });
    expect(redis.ttls.get(key)).toBe(90);
    expect(await store.complete('missing', { ...job('done'), reply: 'no' }, 90)).toBe('missing');
  });

  it('returns 409 from /api/reply when a second callback arrives', async () => {
    const redis = fakeRedis();
    const store = new UpstashJobStore('https://redis.example', 'secret-token', redis.fetchImpl, () => 0);
    const jobId = '11111111-1111-4111-8111-111111111111';
    expect(await store.create(jobId, job(), 90)).toBe(true);
    const deps = {
      config: configFromEnv({
        REPLY_SECRET: 'reply-secret',
        MCP_API_KEY: 'caller:secret',
        PUBLIC_BASE_URL: 'https://mcp.example',
      }),
      store,
    };

    const first = await handleReply(replyRequest(jobId, { reply: 'first' }), deps);
    const second = await handleReply(replyRequest(jobId, { reply: 'second' }), deps);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'already_completed' });
    expect(await store.get(jobId)).toMatchObject({ status: 'done', reply: 'first' });
    expect(redis.commands.filter((command) => command[0] === 'EVAL')).toHaveLength(2);
  });

  it('prefers Upstash env names, then Vercel KV names', () => {
    expect(readUpstash({ UPSTASH_REDIS_REST_URL: 'https://u.example/', UPSTASH_REDIS_REST_TOKEN: 't' })).toEqual({
      url: 'https://u.example',
      token: 't',
    });
    expect(readUpstash({ KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'k' })).toEqual({
      url: 'https://kv.example',
      token: 'k',
    });
    expect(() => readUpstash({ UPSTASH_REDIS_REST_URL: 'https://u.example' })).toThrow(/Incomplete Upstash/);
  });
});

describe('config bounds', () => {
  it('caps WAIT_SECONDS at 50', () => {
    expect(configFromEnv({}).waitSeconds).toBe(25);
    expect(configFromEnv({ WAIT_SECONDS: '0' }).waitSeconds).toBe(0);
    expect(configFromEnv({ WAIT_SECONDS: '50' }).waitSeconds).toBe(MAX_WAIT_SECONDS);
    expect(configFromEnv({ WAIT_SECONDS: '300' }).waitSeconds).toBe(MAX_WAIT_SECONDS);
    expect(configFromEnv({ WAIT_SECONDS: 'nope' }).waitSeconds).toBe(25);
  });
});

function replyRequest(jobId: string, body: { reply: string }): Request {
  return new Request('https://mcp.example/api/reply', {
    method: 'POST',
    headers: {
      authorization: 'Bearer reply-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ job_id: jobId, ...body }),
  });
}
