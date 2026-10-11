import { describe, expect, it } from 'vitest';
import { callTool, postJson, testApp, toolText } from './helpers';

describe('message size', () => {
  it('rejects an oversized message and does not call the webhook', async () => {
    let calls = 0;
    const { app } = testApp({
      fetchImpl: async () => {
        calls += 1;
        return new Response('awake', { status: 200 });
      },
    });
    const message = 'a'.repeat(16 * 1024 + 1);
    const asked = await callTool(app, 'ask_bot', { message });
    expect(asked.rpc.result?.isError).toBe(true);
    expect(toolText(asked.rpc)).toContain('16384');
    expect(calls).toBe(0);
    expect(asked.text).not.toContain(message);
  });

  it('accepts a message at the byte limit and rejects one multibyte character over it', async () => {
    let calls = 0;
    const { app } = testApp({
      config: { waitSeconds: 0 },
      fetchImpl: async () => {
        calls += 1;
        return new Response('awake', { status: 200 });
      },
    });
    const exact = await callTool(app, 'ask_bot', { message: 'a'.repeat(16 * 1024) });
    expect(exact.rpc.result?.isError).toBeUndefined();
    expect(calls).toBe(1);

    const over = await callTool(app, 'ask_bot', { message: `${'é'.repeat(8192)}x` });
    expect(over.rpc.result?.isError).toBe(true);
    expect(calls).toBe(1);
  });

  it('rejects an oversized reply body', async () => {
    const { app } = testApp();
    const response = await postJson(
      app,
      '/api/reply',
      { job_id: '00000000-0000-4000-8000-000000000001', reply: 'x'.repeat(64 * 1024 + 1) },
      { authorization: 'Bearer reply-test-secret' },
    );
    expect(response.status).toBe(413);
  });
});
