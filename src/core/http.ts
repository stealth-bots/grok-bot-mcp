export function json(body: unknown, status = 200, extra?: Record<string, string>): Response {
  const headers = new Headers(extra);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers });
}

export function unauthorized(): Response {
  return json({ error: 'unauthorized' }, 401, {
    'www-authenticate': 'Bearer realm="grok-bot-mcp"',
  });
}

export function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isJobId(value: string): boolean {
  return JOB_ID_PATTERN.test(value);
}
