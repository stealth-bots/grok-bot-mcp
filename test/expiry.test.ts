import { describe, expect, it } from 'vitest';
import { callTool, testApp } from './helpers';

describe('job expiry', () => {
  it('hides a job after the TTL elapses', async () => {
    let now = 1_000_000;
    const { app, config } = testApp({
      now: () => now,
      config: { waitSeconds: 0, jobTtlSeconds: 60 },
      fetchImpl: async () => new Response('awake', { status: 200 }),
    });

    const asked = await callTool(app, 'ask_bot', { message: 'remember this' });
    const jobId = String(asked.rpc.result?.structuredContent?.job_id);
    expect(asked.rpc.result?.structuredContent).toMatchObject({ status: 'pending' });

    now += config.jobTtlSeconds * 1000;
    const expired = await callTool(app, 'get_reply', { job_id: jobId });
    expect(expired.rpc.result?.structuredContent).toMatchObject({ status: 'not_found', job_id: jobId });

    const late = await app.fetch(
      new Request('https://mcp.example/api/reply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer reply-test-secret',
        },
        body: JSON.stringify({ job_id: jobId, reply: 'too late' }),
      }),
    );
    expect(late.status).toBe(404);
  });
});
