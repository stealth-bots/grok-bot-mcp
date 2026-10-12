import { parseJobRecord } from './record';
import type { CompleteResult, JobRecord, JobStore } from './types';

/** One round trip. SET runs only while status is pending, and KEEPTTL leaves the original expiry alone. */
const COMPLETE_IF_PENDING = [
  "local raw = redis.call('GET', KEYS[1])",
  'if not raw then return "missing" end',
  'local current = cjson.decode(raw)',
  'if current["status"] ~= "pending" then return "not_pending" end',
  "redis.call('SET', KEYS[1], ARGV[1], 'KEEPTTL')",
  'return "updated"',
].join('\n');

export class UpstashJobStore implements JobStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    _now: () => number = () => Date.now(),
    private readonly keyPrefix = 'grok-bot-mcp:job:',
  ) {}

  async create(jobId: string, job: JobRecord, ttlSeconds: number): Promise<boolean> {
    const result = await this.command(['SET', this.key(jobId), JSON.stringify(job), 'EX', String(ttlSeconds), 'NX']);
    return result === 'OK';
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const result = await this.command(['GET', this.key(jobId)]);
    if (typeof result !== 'string') return null;
    return parseJobRecord(result);
  }

  async complete(jobId: string, job: JobRecord, _ttlSeconds: number): Promise<CompleteResult> {
    const result = await this.command(['EVAL', COMPLETE_IF_PENDING, '1', this.key(jobId), JSON.stringify(job)]);
    switch (result) {
      case 'missing':
      case 'not_pending':
      case 'updated':
        return result;
      default:
        throw new Error('job store command failed');
    }
  }

  private key(jobId: string): string {
    return `${this.keyPrefix}${jobId}`;
  }

  private async command(args: string[]): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(args),
        redirect: 'manual',
      });
    } catch {
      throw new Error('job store request failed');
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('job store request failed');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('job store returned invalid json');
    }
    if (!payload || typeof payload !== 'object' || !('result' in payload)) {
      throw new Error('job store returned an unexpected response');
    }
    const body = payload as { result?: unknown; error?: unknown };
    if (body.error) throw new Error('job store command failed');
    return body.result ?? null;
  }
}
