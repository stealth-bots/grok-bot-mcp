import { json, withNoStore } from './http';
import { SERVER_NAME } from './constants';
import { createMcp } from './mcp';
import { CallerRateLimit } from './rate-limit';
import { handleMcpAuth, handleReply } from './reply';
import type { AppDeps } from './types';

export interface App {
  fetch(request: Request): Promise<Response>;
  close(): Promise<void>;
}

export function createApp(deps: AppDeps): App {
  const mcp = createMcp({
    ...deps,
    rateLimit: deps.rateLimit ?? new CallerRateLimit({ now: deps.now }),
  });

  return {
    async fetch(request: Request): Promise<Response> {
      const path = normalizePath(request);
      deps.log?.('http', { method: request.method, path });

      switch (path) {
        case '/api/mcp':
          return serveMcp(request, deps, mcp);
        case '/api/reply':
          return handleReply(request, deps);
        case '/':
          return serveRoot(request);
        default:
          return json({ error: 'not_found' }, 404);
      }
    },
    close: () => mcp.close(),
  };
}

async function serveMcp(
  request: Request,
  deps: AppDeps,
  mcp: ReturnType<typeof createMcp>,
): Promise<Response> {
  if (request.method !== 'POST' && request.method !== 'GET' && request.method !== 'DELETE') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const caller = await handleMcpAuth(request, deps);
  if (caller instanceof Response) return caller;
  deps.log?.('mcp_request', { method: request.method, caller });
  const response = await mcp.fetch(request, {
    authInfo: { token: '', clientId: caller, scopes: [] },
  });
  return withNoStore(response);
}

function serveRoot(request: Request): Response {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  return json({
    name: SERVER_NAME,
    ok: true,
    mcp: '/api/mcp',
    reply: '/api/reply',
  });
}

function normalizePath(request: Request): string {
  const { pathname } = new URL(request.url);
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}
