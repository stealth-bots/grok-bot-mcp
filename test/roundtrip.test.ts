import { describe, expect, it } from 'vitest';
import { REPLY_SECRET, WEBHOOK_KEY, WEBHOOK_URL, callTool, postJson, rpc, testApp, toolText } from './helpers';

describe('ask_bot round trip', () => {
  it('wakes the webhook once and returns the callback reply', async () => {
    const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    let appFetch: typeof testHandle | undefined;
    const { app, logs } = testApp({
      fetchImpl: async (input, init) => {
        const headers = new Headers(init?.headers);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ url: String(input), headers, body });
        expect(init?.redirect).toBe('manual');
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        const reply = await appFetch?.(body.job_id);
        expect(reply?.status).toBe(200);
        return new Response('awake', { status: 200 });
      },
    });

    async function testHandle(jobId: unknown) {
      return postJson(
        app,
        '/api/reply',
        { job_id: jobId, reply: 'pong from the bot' },
        { authorization: `Bearer ${REPLY_SECRET}` },
      );
    }
    appFetch = testHandle;

    const asked = await callTool(app, 'ask_bot', { message: 'Reply with pong', thread_id: 'thread-1' });
    expect(asked.status).toBe(200);
    expect(asked.rpc.result?.isError).toBeUndefined();
    expect(toolText(asked.rpc)).toBe('pong from the bot');
    expect(asked.rpc.result?.structuredContent).toMatchObject({
      status: 'done',
      reply: 'pong from the bot',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(WEBHOOK_URL);
    expect(call?.headers.get('authorization')).toBe(`Bearer ${WEBHOOK_KEY}`);
    expect(call?.headers.get('x-automation-key')).toBe(WEBHOOK_KEY);
    expect(call?.headers.get('content-type')).toBe('application/json');
    expect(call?.body).toMatchObject({
      thread_id: 'claude:thread-1',
      caller: 'claude',
      message: 'Reply with pong',
      reply_url: 'https://mcp.example/api/reply',
    });

    const jobId = String(asked.rpc.result?.structuredContent?.job_id);
    const again = await callTool(app, 'get_reply', { job_id: jobId });
    expect(toolText(again.rpc)).toBe('pong from the bot');
    expect(again.rpc.result?.structuredContent).toMatchObject({ status: 'done', job_id: jobId });

    const duplicate = await postJson(
      app,
      '/api/reply',
      { job_id: jobId, reply: 'second' },
      { authorization: `Bearer ${REPLY_SECRET}` },
    );
    expect(duplicate.status).toBe(409);

    const otherCaller = await callTool(app, 'get_reply', { job_id: jobId }, 'cursor-test-secret');
    expect(otherCaller.rpc.result?.structuredContent).toMatchObject({ status: 'not_found' });

    const logged = logs.join('\n');
    expect(logged).not.toContain('Reply with pong');
    expect(logged).not.toContain(WEBHOOK_KEY);
    expect(logged).not.toContain(REPLY_SECRET);
    expect(logged).toContain('"caller":"claude"');
  });

  it('returns pending when the bot does not call back', async () => {
    const { app, store } = testApp({
      config: { waitSeconds: 0 },
      fetchImpl: async () => new Response('awake', { status: 200 }),
    });
    const asked = await callTool(app, 'ask_bot', { message: 'hello' });
    expect(asked.rpc.result?.isError).toBeUndefined();
    expect(asked.rpc.result?.structuredContent).toMatchObject({ status: 'pending' });
    const jobId = String(asked.rpc.result?.structuredContent?.job_id);
    expect(await store.get(jobId)).toMatchObject({ status: 'pending' });
    expect((await store.get(jobId))?.error).toBeUndefined();
    const pending = await callTool(app, 'get_reply', { job_id: jobId });
    expect(pending.rpc.result?.structuredContent).toMatchObject({ status: 'pending', job_id: jobId });
    expect(toolText(pending.rpc)).toContain(jobId);
  });

  it('scopes thread_id to the caller so two callers do not share a thread', async () => {
    const threads: string[] = [];
    const { app } = testApp({
      config: { waitSeconds: 0 },
      fetchImpl: async (_input, init) => {
        threads.push(String((JSON.parse(String(init?.body)) as { thread_id: unknown }).thread_id));
        return new Response('awake', { status: 200 });
      },
    });
    await callTool(app, 'ask_bot', { message: 'hi', thread_id: 'shared' });
    await callTool(app, 'ask_bot', { message: 'hi', thread_id: 'shared' }, 'cursor-test-secret');
    expect(threads).toEqual(['claude:shared', 'cursor:shared']);
  });

  it('records the cursor key name as caller', async () => {
    let caller = '';
    const { app } = testApp({
      config: { waitSeconds: 0 },
      fetchImpl: async (_input, init) => {
        caller = String((JSON.parse(String(init?.body)) as { caller: string }).caller);
        return new Response('awake', { status: 200 });
      },
    });
    const asked = await callTool(app, 'ask_bot', { message: 'hi' }, 'cursor-test-secret');
    expect(caller).toBe('cursor');
    expect(asked.rpc.result?.isError).toBeUndefined();
  });

  it('omits thread_id as null when the caller does not send one', async () => {
    let threadId: unknown = 'unset';
    const { app } = testApp({
      config: { waitSeconds: 0 },
      fetchImpl: async (_input, init) => {
        threadId = (JSON.parse(String(init?.body)) as { thread_id: unknown }).thread_id;
        return new Response('awake', { status: 200 });
      },
    });
    await callTool(app, 'ask_bot', { message: 'hi' });
    expect(threadId).toBeNull();
  });

  it('stores a bot error and returns it from get_reply', async () => {
    let jobId = '';
    const { app } = testApp({
      fetchImpl: async (_input, init) => {
        jobId = String((JSON.parse(String(init?.body)) as { job_id: string }).job_id);
        const reply = await postJson(
          app,
          '/api/reply',
          { job_id: jobId, error: 'could not answer' },
          { authorization: `Bearer ${REPLY_SECRET}` },
        );
        expect(reply.status).toBe(200);
        return new Response('awake', { status: 200 });
      },
    });
    const asked = await callTool(app, 'ask_bot', { message: 'hi' });
    expect(asked.rpc.result?.structuredContent).toMatchObject({ status: 'error', error: 'could not answer' });
    expect(toolText(asked.rpc)).toBe('could not answer');
  });
});

describe('webhook failures', () => {
  it('does not retry a non-200 response', async () => {
    let calls = 0;
    const { app } = testApp({
      fetchImpl: async () => {
        calls += 1;
        return new Response('no', { status: 503 });
      },
    });
    const asked = await callTool(app, 'ask_bot', { message: 'hi' });
    expect(calls).toBe(1);
    expect(asked.rpc.result?.isError).toBe(true);
    expect(toolText(asked.rpc)).toContain('HTTP 503');
  });

  it('does not follow redirects', async () => {
    let calls = 0;
    const { app } = testApp({
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { location: 'https://evil.example' } });
      },
    });
    const asked = await callTool(app, 'ask_bot', { message: 'hi' });
    expect(calls).toBe(1);
    expect(asked.rpc.result?.isError).toBe(true);
    expect(toolText(asked.rpc)).toContain('HTTP 302');
  });

  it('keeps the job pending and returns job_id when the webhook times out', async () => {
    let calls = 0;
    const { app, store } = testApp({
      config: { webhookTimeoutMs: 20 },
      fetchImpl: (_input, init) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('timed out');
            error.name = 'TimeoutError';
            reject(error);
          });
        });
      },
    });
    const asked = await callTool(app, 'ask_bot', { message: 'hi' });
    expect(calls).toBe(1);
    expect(asked.rpc.result?.isError).toBeUndefined();
    const jobId = String(asked.rpc.result?.structuredContent?.job_id);
    expect(asked.rpc.result?.structuredContent).toMatchObject({ status: 'pending', job_id: jobId });
    expect(await store.get(jobId)).toMatchObject({ status: 'pending' });
    expect((await store.get(jobId))?.error).toBeUndefined();

    const reply = await postJson(
      app,
      '/api/reply',
      { job_id: jobId, reply: 'late pong' },
      { authorization: `Bearer ${REPLY_SECRET}` },
    );
    expect(reply.status).toBe(200);
    const got = await callTool(app, 'get_reply', { job_id: jobId });
    expect(got.rpc.result?.structuredContent).toMatchObject({ status: 'done', reply: 'late pong' });
  });
});

describe('protocol', () => {
  it('answers a legacy initialize and a modern tools/list', async () => {
    const { app } = testApp();
    const initialized = await rpc(app, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    });
    expect(initialized.status).toBe(200);
    expect(initialized.rpc.result?.serverInfo?.name).toBe('grok-bot-mcp');

    const modern = await rpc(app, 'tools/list', {}, CLAUDE, 'modern');
    expect(modern.status).toBe(200);
    expect(modern.rpc.error).toBeUndefined();
    expect(modern.rpc.result?.tools?.map((tool) => tool.name).sort()).toEqual(['ask_bot', 'get_reply', 'ping']);

    const modernPing = await callTool(app, 'ping', {}, CLAUDE, 'modern');
    expect(modernPing.status).toBe(200);
    expect(toolText(modernPing.rpc)).toBe('pong');
  });

  it('answers ping', async () => {
    const { app } = testApp();
    const ping = await callTool(app, 'ping', {});
    expect(toolText(ping.rpc)).toBe('pong');
    expect(ping.rpc.result?.structuredContent).toEqual({ ok: true });
  });
});

const CLAUDE = 'claude-test-secret';
