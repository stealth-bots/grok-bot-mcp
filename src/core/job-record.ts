import type { JobRecord, JobStatus } from './types';

export function parseJobRecord(raw: string): JobRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<JobRecord>;
  if (!isStatus(record.status) || typeof record.caller !== 'string' || typeof record.createdAt !== 'number') {
    return null;
  }
  if (record.reply !== undefined && typeof record.reply !== 'string') return null;
  if (record.error !== undefined && typeof record.error !== 'string') return null;
  const parsed: JobRecord = {
    status: record.status,
    caller: record.caller,
    createdAt: record.createdAt,
  };
  if (record.reply !== undefined) parsed.reply = record.reply;
  if (record.error !== undefined) parsed.error = record.error;
  return parsed;
}

function isStatus(value: unknown): value is JobStatus {
  return value === 'pending' || value === 'done' || value === 'error';
}

export function remainingTtlSeconds(job: JobRecord, now: number, ttlSeconds: number): number {
  const ageSeconds = Math.floor((now - job.createdAt) / 1000);
  return ttlSeconds - ageSeconds;
}
