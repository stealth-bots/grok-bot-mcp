import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createApp } from './core/app';
import { createLogger } from './core/log';
import { loadRuntime } from './adapters/runtime';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length']);

const runtime = loadRuntime(process.env, {
  log: createLogger((line) => console.info(line)),
});

const app = createApp({
  config: runtime.config,
  store: runtime.selection.store,
  log: runtime.log,
});

const port = portFrom(process.env.PORT);
const server = createServer((req, res) => {
  void serve(req, res);
});

server.listen(port, '127.0.0.1', () => {
  console.info(JSON.stringify({ event: 'listen', path: `http://127.0.0.1:${port}` }));
});

async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const host = req.headers.host ?? `127.0.0.1:${port}`;
    const url = new URL(req.url ?? '/', `http://${host}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else {
        headers.set(key, value);
      }
    }
    const body = await readBody(req);
    if (body === 'too_large') {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: 'payload_too_large' }));
      return;
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: body ?? undefined,
    });
    const response = await app.fetch(request);
    const payload = Buffer.from(await response.arrayBuffer());
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    res.writeHead(response.status, responseHeaders);
    res.end(payload);
  } catch {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    }
    res.end(JSON.stringify({ error: 'server_error' }));
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer | 'too_large' | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 1024 * 1024) return 'too_large';
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  return Buffer.concat(chunks);
}

function portFrom(raw: string | undefined): number {
  const parsed = Number(raw ?? '3000');
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return 3000;
  return parsed;
}
