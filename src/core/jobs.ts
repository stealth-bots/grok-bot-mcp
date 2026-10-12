import { MAX_REPLY_BYTES, MAX_THREAD_ID_CHARS } from './constants';
import { isJobId, utf8ByteLength } from './http';
import type { AppDeps, JobRecord, JobStatus } from './types';
import { postWebhook, type WebhookResult } from './webhook';

export interface PublicJob {
  job_id: string;
  status: JobStatus | 'not_found';
  reply?: string;
  error?: string;
}

export type AskOutcome =
  | { kind: 'result'; job: PublicJob }
  | { kind: 'tool_error'; message: string };

export async function askBot(
  deps: AppDeps,
  input: { message: string; threadId?: string; caller: string },
): Promise<AskOutcome> {
  const bytes = utf8ByteLength(input.message);
  if (bytes > deps.config.maxMessageBytes) {
    return {
      kind: 'tool_error',
      message: `message is ${bytes} bytes; the limit is ${deps.config.maxMessageBytes} bytes`,
    };
  }
  if (input.message.trim().length === 0) {
    return { kind: 'tool_error', message: 'message is empty' };
  }
  if (input.threadId !== undefined && input.threadId.length > MAX_THREAD_ID_CHARS) {
    return { kind: 'tool_error', message: `thread_id must be at most ${MAX_THREAD_ID_CHARS} characters` };
  }

  const missing = missingAskConfig(deps);
  if (missing) return { kind: 'tool_error', message: missing };

  const replyUrl = replyUrlFor(deps.config.publicBaseUrl);
  if (!replyUrl.ok) return { kind: 'tool_error', message: replyUrl.message };
  const webhookUrlError = validateHttpUrl(deps.config.webhookUrl, 'GROK_BOT_WEBHOOK_URL');
  if (webhookUrlError) return { kind: 'tool_error', message: webhookUrlError };

  if (deps.rateLimit && !deps.rateLimit.allow(input.caller)) {
    return { kind: 'tool_error', message: 'rate limit exceeded for this caller; try again shortly' };
  }

  const now = deps.now ?? Date.now;
  const jobId = crypto.randomUUID();
  const record: JobRecord = { status: 'pending', caller: input.caller, createdAt: now() };
  const created = await deps.store.create(jobId, record, deps.config.jobTtlSeconds);
  if (!created) return { kind: 'tool_error', message: 'could not store the job' };

  deps.log?.('ask_bot', { caller: input.caller, job_id: jobId, bytes });

  const webhook = await postWebhook(
    deps.fetchImpl ?? fetch,
    deps.config.webhookUrl as string,
    deps.config.webhookKey as string,
    {
      job_id: jobId,
      thread_id: scopedThreadId(input.caller, input.threadId),
      caller: input.caller,
      message: input.message,
      reply_url: replyUrl.url,
    },
    deps.config.webhookTimeoutMs,
  );

  if (!webhook.ok) {
    deps.log?.('webhook_failed', { job_id: jobId, status: webhook.status ?? 0 });
    switch (webhook.reason) {
      case 'timeout':
        return { kind: 'result', job: await jobForCaller(deps, jobId, input.caller) };
      case 'status':
      case 'network':
        await deps.store.complete(
          jobId,
          { ...record, status: 'error', error: webhookFailure(webhook) },
          deps.config.jobTtlSeconds,
        );
        return { kind: 'tool_error', message: webhookFailure(webhook) };
      default: {
        const _never: never = webhook.reason;
        return _never;
      }
    }
  }

  return { kind: 'result', job: await waitForJob(deps, jobId, input.caller) };
}

export async function getReply(deps: AppDeps, jobId: string, caller: string): Promise<PublicJob> {
  if (!isJobId(jobId)) return { job_id: jobId, status: 'not_found' };
  const job = await deps.store.get(jobId);
  if (!job || job.caller !== caller) return { job_id: jobId, status: 'not_found' };
  return toPublic(jobId, job);
}

export interface ReplyUpdate {
  jobId: string;
  reply?: string;
  error?: string;
}

export type ReplyBodyError = 'invalid' | 'oversized';

export function parseReplyBody(value: unknown): ReplyUpdate | ReplyBodyError {
  if (!value || typeof value !== 'object') return 'invalid';
  const body = value as Record<string, unknown>;
  if (typeof body.job_id !== 'string' || !isJobId(body.job_id)) return 'invalid';
  const hasReply = Object.prototype.hasOwnProperty.call(body, 'reply');
  const hasError = Object.prototype.hasOwnProperty.call(body, 'error');
  if (hasReply === hasError) return 'invalid';
  if (hasReply) {
    if (typeof body.reply !== 'string') return 'invalid';
    if (utf8ByteLength(body.reply) > MAX_REPLY_BYTES) return 'oversized';
    return { jobId: body.job_id, reply: body.reply };
  }
  if (typeof body.error !== 'string') return 'invalid';
  if (utf8ByteLength(body.error) > MAX_REPLY_BYTES) return 'oversized';
  return { jobId: body.job_id, error: body.error };
}

function missingAskConfig(deps: AppDeps): string | null {
  if (!deps.config.webhookUrl) return 'server is missing GROK_BOT_WEBHOOK_URL';
  if (!deps.config.webhookKey) return 'server is missing GROK_BOT_WEBHOOK_KEY';
  if (!deps.config.replySecret) return 'server is missing REPLY_SECRET';
  if (!deps.config.publicBaseUrl) return 'server is missing PUBLIC_BASE_URL';
  return null;
}

function validateHttpUrl(value: string | undefined, name: string): string | null {
  if (!value) return `server is missing ${name}`;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return `${name} must be an http(s) URL`;
  } catch {
    return `${name} must be an http(s) URL`;
  }
  return null;
}

function replyUrlFor(base: string | undefined): { ok: true; url: string } | { ok: false; message: string } {
  const problem = validateHttpUrl(base, 'PUBLIC_BASE_URL');
  if (problem || !base) return { ok: false, message: problem ?? 'server is missing PUBLIC_BASE_URL' };
  return { ok: true, url: `${base}/api/reply` };
}

function scopedThreadId(caller: string, threadId: string | undefined): string | null {
  if (threadId === undefined) return null;
  return `${caller}:${threadId}`;
}

async function jobForCaller(deps: AppDeps, jobId: string, caller: string): Promise<PublicJob> {
  const job = await deps.store.get(jobId);
  if (!job || job.caller !== caller) return { job_id: jobId, status: 'pending' };
  return toPublic(jobId, job);
}

function webhookFailure(result: Extract<WebhookResult, { ok: false }>): string {
  if (result.reason === 'timeout') return 'the Grok Bot webhook timed out after one attempt';
  if (result.reason === 'network') return 'the Grok Bot webhook request failed after one attempt';
  return `the Grok Bot webhook returned HTTP ${result.status ?? 0} after one attempt`;
}

async function waitForJob(deps: AppDeps, jobId: string, caller: string): Promise<PublicJob> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = now() + deps.config.waitSeconds * 1000;
  const maxPolls = Math.max(1, Math.ceil((deps.config.waitSeconds * 1000) / deps.config.pollIntervalMs) + 1);

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const job = await deps.store.get(jobId);
    if (!job || job.caller !== caller) {
      return { job_id: jobId, status: 'not_found', error: 'job expired before a reply arrived' };
    }
    if (job.status !== 'pending') return toPublic(jobId, job);
    const remaining = deadline - now();
    if (remaining <= 0) return toPublic(jobId, job);
    await sleep(Math.min(deps.config.pollIntervalMs, remaining));
  }

  const last = await deps.store.get(jobId);
  if (!last || last.caller !== caller) {
    return { job_id: jobId, status: 'not_found', error: 'job expired before a reply arrived' };
  }
  return toPublic(jobId, last);
}

function toPublic(jobId: string, job: JobRecord): PublicJob {
  const result: PublicJob = { job_id: jobId, status: job.status };
  if (job.reply !== undefined) result.reply = job.reply;
  if (job.error !== undefined) result.error = job.error;
  return result;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
