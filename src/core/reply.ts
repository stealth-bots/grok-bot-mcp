import { matchApiKey, readBearer, timingSafeEqual } from './auth';
import { MAX_REPLY_BODY_BYTES } from './constants';
import { json, unauthorized } from './http';
import { parseReplyBody } from './jobs';
import type { AppDeps, JobRecord } from './types';

export async function handleReply(request: Request, deps: AppDeps): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = deps.config.replySecret;
  if (!secret) return unauthorized();

  const token = readBearer(request.headers.get('authorization'));
  if (!token || !(await timingSafeEqual(token, secret))) return unauthorized();

  const contentType = request.headers.get('content-type');
  if (!contentType || !contentType.toLowerCase().startsWith('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415);
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_REPLY_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const update = parseReplyBody(parsed);
  if (update === 'invalid') return json({ error: 'invalid_body' }, 400);
  if (update === 'oversized') return json({ error: 'payload_too_large' }, 413);

  const existing = await deps.store.get(update.jobId);
  if (!existing) return json({ error: 'not_found' }, 404);

  const next: JobRecord = {
    status: update.error !== undefined ? 'error' : 'done',
    caller: existing.caller,
    createdAt: existing.createdAt,
  };
  if (update.reply !== undefined) next.reply = update.reply;
  if (update.error !== undefined) next.error = update.error;

  const result = await deps.store.complete(update.jobId, next, deps.config.jobTtlSeconds);
  deps.log?.('reply', { job_id: update.jobId, outcome: result, bytes: bytes.byteLength });

  switch (result) {
    case 'updated':
      return json({ ok: true });
    case 'missing':
      return json({ error: 'not_found' }, 404);
    case 'not_pending':
      return json({ error: 'already_completed' }, 409);
    default: {
      const _never: never = result;
      return _never;
    }
  }
}

export async function handleMcpAuth(request: Request, deps: AppDeps): Promise<string | Response> {
  if (deps.config.apiKeys.length === 0) return unauthorized();
  const token = readBearer(request.headers.get('authorization'));
  if (!token) return unauthorized();
  const caller = await matchApiKey(token, deps.config.apiKeys);
  if (!caller) return unauthorized();
  return caller;
}
