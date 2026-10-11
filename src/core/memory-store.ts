import { parseJobRecord } from './job-record';
import type { CompleteResult, JobRecord, JobStore } from './types';

interface Entry {
  raw: string;
  expiresAt: number;
}

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Entry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async create(jobId: string, job: JobRecord, ttlSeconds: number): Promise<boolean> {
    if (this.read(jobId)) return false;
    this.jobs.set(jobId, {
      raw: JSON.stringify(job),
      expiresAt: this.now() + ttlSeconds * 1000,
    });
    return true;
  }

  async get(jobId: string): Promise<JobRecord | null> {
    return this.read(jobId);
  }

  async complete(jobId: string, job: JobRecord, _ttlSeconds: number): Promise<CompleteResult> {
    const current = this.read(jobId);
    if (!current) return 'missing';
    if (current.status !== 'pending') return 'not_pending';
    const existing = this.jobs.get(jobId);
    if (!existing) return 'missing';
    if (existing.expiresAt - this.now() <= 0) {
      this.jobs.delete(jobId);
      return 'missing';
    }
    this.jobs.set(jobId, { raw: JSON.stringify(job), expiresAt: existing.expiresAt });
    return 'updated';
  }

  private read(jobId: string): JobRecord | null {
    const entry = this.jobs.get(jobId);
    if (!entry) return null;
    if (this.now() >= entry.expiresAt) {
      this.jobs.delete(jobId);
      return null;
    }
    return parseJobRecord(entry.raw);
  }
}
