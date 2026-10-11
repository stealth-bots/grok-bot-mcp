import { describe, expect, it } from 'vitest';
import { parseApiKeys } from '../src/core/auth';
import { CLAUDE_SECRET, CURSOR_SECRET, REPLY_SECRET, postJson, rpc, testApp } from './helpers';

describe('MCP auth', () => {
  it('rejects a missing, malformed, or unknown bearer token', async () => {
    const { app } = testApp();
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
    const missing = await postJson(app, '/api/mcp', body);
    const basic = await postJson(app, '/api/mcp', body, { authorization: 'Basic abc' });
    const wrong = await postJson(app, '/api/mcp', body, { authorization: 'Bearer nope' });

    expect(missing.status).toBe(401);
    expect(basic.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain('Bearer');
    expect(missing.text).not.toContain(CLAUDE_SECRET);
  });

  it('accepts each configured key and lists the tools', async () => {
    const { app } = testApp();
    const claude = await rpc(app, 'tools/list', {}, CLAUDE_SECRET);
    const cursor = await rpc(app, 'tools/list', {}, CURSOR_SECRET);

    expect(claude.status).toBe(200);
    expect(cursor.status).toBe(200);
    const names = claude.rpc.result?.tools?.map((tool) => tool.name).sort();
    expect(names).toEqual(['ask_bot', 'get_reply', 'ping']);
    expect(claude.rpc.result?.tools?.every((tool) => (tool.description ?? '').length > 0)).toBe(true);
  });

  it('rejects MCP calls when no keys are configured', async () => {
    const { app } = testApp({ env: { MCP_API_KEY: '' } });
    const response = await rpc(app, 'tools/list', {}, CLAUDE_SECRET);
    expect(response.status).toBe(401);
  });

  it('parses named keys and unnamed secrets', () => {
    expect(parseApiKeys('claude:one,cursor:two:three')).toEqual([
      { name: 'claude', secret: 'one' },
      { name: 'cursor', secret: 'two:three' },
    ]);
    expect(parseApiKeys(' only-secret ')).toEqual([{ name: 'key-1', secret: 'only-secret' }]);
    expect(() => parseApiKeys('bad name:secret')).toThrow(/MCP_API_KEY/);
  });
});

describe('reply auth', () => {
  it('rejects a missing or wrong reply secret', async () => {
    const { app } = testApp();
    const body = { job_id: '00000000-0000-4000-8000-000000000001', reply: 'hi' };
    const missing = await postJson(app, '/api/reply', body);
    const wrong = await postJson(app, '/api/reply', body, { authorization: 'Bearer wrong' });
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(wrong.text).not.toContain(REPLY_SECRET);
  });
});
