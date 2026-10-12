export type JobStatus = 'pending' | 'done' | 'error';

export interface JobRecord {
  status: JobStatus;
  caller: string;
  createdAt: number;
  reply?: string;
  error?: string;
}

export type CompleteResult = 'updated' | 'missing' | 'not_pending';

export interface JobStore {
  create(jobId: string, job: JobRecord, ttlSeconds: number): Promise<boolean>;
  get(jobId: string): Promise<JobRecord | null>;
  complete(jobId: string, job: JobRecord, ttlSeconds: number): Promise<CompleteResult>;
}
