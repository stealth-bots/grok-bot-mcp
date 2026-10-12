import type { CompleteResult, JobRecord, JobStatus, JobStore } from './types';

export interface D1Meta {
  changes?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface JobRow {
  status: string;
  caller: string;
  created_at: number;
  reply: string | null;
  error: string | null;
  expires_at: number;
}

const INSERT_JOB = `INSERT INTO jobs (job_id, status, caller, created_at, reply, error, expires_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(job_id) DO NOTHING`;

const SELECT_JOB = `SELECT status, caller, created_at, reply, error, expires_at
FROM jobs
WHERE job_id = ?`;

/** One statement. A second completion changes zero rows and leaves the first reply in place. */
const COMPLETE_IF_PENDING = `UPDATE jobs
SET status = ?, reply = ?, error = ?
WHERE job_id = ? AND status = 'pending' AND expires_at > ?`;

/** Every store call removes expired rows, including jobs nobody reads again. */
const DELETE_EXPIRED = `DELETE FROM jobs WHERE expires_at <= ?`;

export class D1JobStore implements JobStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async create(jobId: string, job: JobRecord, ttlSeconds: number): Promise<boolean> {
    await this.purgeExpired();
    const result = await this.db
      .prepare(INSERT_JOB)
      .bind(
        jobId,
        job.status,
        job.caller,
        job.createdAt,
        job.reply ?? null,
        job.error ?? null,
        this.now() + ttlSeconds * 1000,
      )
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async get(jobId: string): Promise<JobRecord | null> {
    await this.purgeExpired();
    const row = await this.read(jobId);
    if (!row || row.expires_at <= this.now()) return null;
    return rowToJob(row);
  }

  async complete(jobId: string, job: JobRecord, _ttlSeconds: number): Promise<CompleteResult> {
    await this.purgeExpired();
    const updated = await this.db
      .prepare(COMPLETE_IF_PENDING)
      .bind(job.status, job.reply ?? null, job.error ?? null, jobId, this.now())
      .run();
    if ((updated.meta.changes ?? 0) > 0) return 'updated';

    const row = await this.read(jobId);
    if (!row || row.expires_at <= this.now()) return 'missing';
    if (row.status !== 'pending') return 'not_pending';
    return 'missing';
  }

  private async read(jobId: string): Promise<JobRow | null> {
    const row = await this.db.prepare(SELECT_JOB).bind(jobId).first<JobRow>();
    return row ?? null;
  }

  private async purgeExpired(): Promise<void> {
    await this.db.prepare(DELETE_EXPIRED).bind(this.now()).run();
  }
}

function rowToJob(row: JobRow): JobRecord | null {
  if (!isStatus(row.status) || typeof row.caller !== 'string' || typeof row.created_at !== 'number') return null;
  const job: JobRecord = { status: row.status, caller: row.caller, createdAt: row.created_at };
  if (typeof row.reply === 'string') job.reply = row.reply;
  if (typeof row.error === 'string') job.error = row.error;
  return job;
}

function isStatus(value: string): value is JobStatus {
  return value === 'pending' || value === 'done' || value === 'error';
}
