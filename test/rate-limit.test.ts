import { describe, expect, it } from 'vitest';
import { CallerRateLimit } from '../src/core/rate-limit';
import { callTool, testApp, toolText } from './helpers';

describe('ask_bot rate limit', () => {
  it('stops calling the webhook after the caller exceeds the limit', async () => {
    let calls = 0;
    const { app } = testApp({
      config: { waitSeconds: 0 },
      rateLimit: new CallerRateLimit({ limit: 2, windowMs: 60_000, now: () => 1_000 }),
      fetchImpl: async () => {
        calls += 1;
        return new Response('awake', { status: 200 });
      },
    });

    expect((await callTool(app, 'ask_bot', { message: 'one' })).rpc.result?.isError).toBeUndefined();
    expect((await callTool(app, 'ask_bot', { message: 'two' })).rpc.result?.isError).toBeUndefined();
    const blocked = await callTool(app, 'ask_bot', { message: 'three' });
    expect(blocked.rpc.result?.isError).toBe(true);
    expect(toolText(blocked.rpc)).toContain('rate limit exceeded');
    expect(calls).toBe(2);

    const otherCaller = await callTool(app, 'ask_bot', { message: 'still ok' }, 'cursor-test-secret');
    expect(otherCaller.rpc.result?.isError).toBeUndefined();
    expect(calls).toBe(3);
  });
});
