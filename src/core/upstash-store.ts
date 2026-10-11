import { parseJobRecord, remainingTtlSeconds } from './job-record';
import type { CompleteResult, JobRecord, JobStore } from './types';

export class UpstashJobStore implements JobStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
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

  async complete(jobId: string, job: JobRecord, ttlSeconds: number): Promise<CompleteResult> {
    const current = await this.get(jobId);
    if (!current) return 'missing';
    if (current.status !== 'pending') return 'not_pending';
    const remaining = remainingTtlSeconds(current, this.now(), ttlSeconds);
    if (remaining <= 0) return 'missing';
    await this.command(['SET', this.key(jobId), JSON.stringify(job), 'EX', String(remaining)]);
    return 'updated';
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
