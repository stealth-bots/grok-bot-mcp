import { MIN_KV_TTL_SECONDS } from './constants';
import { parseJobRecord, remainingTtlSeconds } from './job-record';
import type { CompleteResult, JobRecord, JobStore } from './types';

export interface KvBinding {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export class KvJobStore implements JobStore {
  constructor(
    private readonly kv: KvBinding,
    private readonly now: () => number = () => Date.now(),
    private readonly keyPrefix = 'job:',
  ) {}

  async create(jobId: string, job: JobRecord, ttlSeconds: number): Promise<boolean> {
    const key = this.key(jobId);
    const existing = await this.kv.get(key);
    if (existing !== null) return false;
    await this.kv.put(key, JSON.stringify(job), { expirationTtl: kvTtl(ttlSeconds) });
    return true;
  }

  async get(jobId: string): Promise<JobRecord | null> {
    const raw = await this.kv.get(this.key(jobId));
    if (raw === null) return null;
    return parseJobRecord(raw);
  }

  async complete(jobId: string, job: JobRecord, ttlSeconds: number): Promise<CompleteResult> {
    const current = await this.get(jobId);
    if (!current) return 'missing';
    if (current.status !== 'pending') return 'not_pending';
    const remaining = remainingTtlSeconds(current, this.now(), ttlSeconds);
    if (remaining <= 0) return 'missing';
    await this.kv.put(this.key(jobId), JSON.stringify(job), { expirationTtl: kvTtl(remaining) });
    return 'updated';
  }

  private key(jobId: string): string {
    return `${this.keyPrefix}${jobId}`;
  }
}

function kvTtl(seconds: number): number {
  return Math.max(MIN_KV_TTL_SECONDS, seconds);
}
