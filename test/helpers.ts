import { CLIENT_CAPABILITIES_META_KEY, PROTOCOL_VERSION_META_KEY } from '@modelcontextprotocol/server';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
import { createApp, type App } from '../src/core/app';
import { configFromEnv, type EnvMap } from '../src/core/config';
import { createLogger } from '../src/core/log';
import { MemoryJobStore } from '../src/lib/job-store';
import type { AppConfig, AppDeps, LogFn, RateLimit } from '../src/core/types';

export const CLAUDE_SECRET = 'claude-test-secret';
export const CURSOR_SECRET = 'cursor-test-secret';
export const REPLY_SECRET = 'reply-test-secret';
export const WEBHOOK_KEY = 'webhook-test-key';
export const WEBHOOK_URL = 'https://bot.example/webhook';

export interface TestApp {
  app: App;
  store: MemoryJobStore;
  logs: string[];
  log: LogFn;
  config: AppConfig;
  deps: AppDeps;
}

export function testApp(options?: {
  env?: EnvMap;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  config?: Partial<AppConfig>;
  rateLimit?: RateLimit;
}): TestApp {
  const now = options?.now ?? (() => Date.now());
  const store = new MemoryJobStore(now);
  const logs: string[] = [];
  const log = createLogger((line) => {
    logs.push(line);
  });
  const config: AppConfig = {
    ...configFromEnv({
      GROK_BOT_WEBHOOK_URL: WEBHOOK_URL,
      GROK_BOT_WEBHOOK_KEY: WEBHOOK_KEY,
      REPLY_SECRET,
      MCP_API_KEY: `claude:${CLAUDE_SECRET},cursor:${CURSOR_SECRET}`,
      PUBLIC_BASE_URL: 'https://mcp.example',
      WAIT_SECONDS: '25',
      ...options?.env,
    }),
    ...options?.config,
  };
  const deps: AppDeps = {
    config,
    store,
    fetchImpl: options?.fetchImpl,
    now,
    sleep: options?.sleep,
    log,
    rateLimit: options?.rateLimit,
  };
  return { app: createApp(deps), store, logs, log, config, deps };
}

export async function postJson(
  app: App,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown; text: string; headers: Headers }> {
  const response = await app.fetch(
    new Request(`https://mcp.example${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return { status: response.status, text, json: parseBody(text), headers: response.headers };
}

export async function callTool(
  app: App,
  name: string,
  args: Record<string, unknown>,
  token = CLAUDE_SECRET,
  era: 'legacy' | 'modern' = 'legacy',
): Promise<{ status: number; rpc: JsonRpc; text: string }> {
  const response = await rpc(app, 'tools/call', { name, arguments: args }, token, era);
  return response;
}

export async function rpc(
  app: App,
  method: string,
  params: Record<string, unknown>,
  token = CLAUDE_SECRET,
  era: 'legacy' | 'modern' = 'legacy',
): Promise<{ status: number; rpc: JsonRpc; text: string }> {
  const modern = era === 'modern';
  const bodyParams = modern
    ? {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_META_KEY]: {},
        },
      }
    : params;
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (modern) {
    headers['mcp-protocol-version'] = MODERN_PROTOCOL_VERSION;
    headers['mcp-method'] = method;
    if (method === 'tools/call' && typeof params.name === 'string') headers['mcp-name'] = params.name;
  }
  const posted = await postJson(app, '/api/mcp', { jsonrpc: '2.0', id: 1, method, params: bodyParams }, headers);
  return { status: posted.status, text: posted.text, rpc: posted.json as JsonRpc };
}

export interface JsonRpc {
  jsonrpc?: string;
  id?: number | string;
  result?: {
    tools?: Array<{ name: string; description?: string }>;
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    protocolVersion?: string;
    serverInfo?: { name?: string };
  };
  error?: { code?: number; message?: string };
}

function parseBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  const data = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0);
  const last = data.at(-1);
  if (!last) throw new Error(`unreadable response: ${trimmed.slice(0, 300)}`);
  return JSON.parse(last);
}

export function toolText(rpcBody: JsonRpc): string {
  return rpcBody.result?.content?.map((block) => block.text ?? '').join('') ?? '';
}
