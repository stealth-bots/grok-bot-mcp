import { expect, it } from 'vitest';
import { configFromEnv } from '../src/core/config';
import { handleReply } from '../src/core/reply';
import type { JobRecord, JobStore } from '../src/lib/job-store';

const pending = (): JobRecord => ({ status: 'pending', caller: 'claude', createdAt: 0 });

export function runJobStoreSuite(open: (clock: { now: () => number }) => JobStore): void {
  function harness() {
    let now = 1_000_000;
    const clock = {
      now: () => now,
      advance(ms: number) {
        now += ms;
      },
    };
    return { clock, store: open(clock) };
  }

  it('creates a job once', async () => {
    const { store } = harness();
    expect(await store.create('job-1', pending(), 60)).toBe(true);
    expect(await store.create('job-1', pending(), 60)).toBe(false);
    expect(await store.get('job-1')).toMatchObject({ status: 'pending', caller: 'claude' });
    expect(await store.get('missing')).toBeNull();
  });

  it('completes a pending job once and keeps the first reply', async () => {
    const { store } = harness();
    expect(await store.create('job-1', pending(), 90)).toBe(true);
    expect(await store.complete('job-1', { ...pending(), status: 'done', reply: 'first' }, 90)).toBe('updated');
    expect(await store.complete('job-1', { ...pending(), status: 'done', reply: 'second' }, 90)).toBe('not_pending');
    expect(await store.get('job-1')).toMatchObject({ status: 'done', reply: 'first' });
    expect(await store.complete('missing', { ...pending(), status: 'done', reply: 'no' }, 90)).toBe('missing');
  });

  it('returns 409 from /api/reply when a second callback arrives', async () => {
    const { store } = harness();
    const jobId = '11111111-1111-4111-8111-111111111111';
    expect(await store.create(jobId, pending(), 90)).toBe(true);
    const deps = {
      config: configFromEnv({
        REPLY_SECRET: 'reply-secret',
        MCP_API_KEY: 'caller:secret',
        PUBLIC_BASE_URL: 'https://mcp.example',
      }),
      store,
    };

    const first = await handleReply(replyRequest(jobId, 'first'), deps);
    const second = await handleReply(replyRequest(jobId, 'second'), deps);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'already_completed' });
    expect(await store.get(jobId)).toMatchObject({ status: 'done', reply: 'first' });
  });

  it('hides an expired job and refuses to complete it', async () => {
    const { store, clock } = harness();
    expect(await store.create('job-1', pending(), 60)).toBe(true);
    clock.advance(60_000);
    expect(await store.get('job-1')).toBeNull();
    expect(await store.complete('job-1', { ...pending(), status: 'done', reply: 'late' }, 60)).toBe('missing');
  });
}

function replyRequest(jobId: string, reply: string): Request {
  return new Request('https://mcp.example/api/reply', {
    method: 'POST',
    headers: {
      authorization: 'Bearer reply-secret',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ job_id: jobId, reply }),
  });
}
