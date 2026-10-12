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

export interface NamedKey {
  name: string;
  secret: string;
}

export interface AppConfig {
  webhookUrl: string | undefined;
  webhookKey: string | undefined;
  replySecret: string | undefined;
  apiKeys: NamedKey[];
  publicBaseUrl: string | undefined;
  waitSeconds: number;
  jobTtlSeconds: number;
  maxMessageBytes: number;
  webhookTimeoutMs: number;
  pollIntervalMs: number;
}

export type LogFields = Record<string, string | number | boolean>;

export type LogFn = (event: string, fields: LogFields) => void;

export interface RateLimit {
  allow(caller: string): boolean;
}

export interface AppDeps {
  config: AppConfig;
  store: JobStore;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: LogFn;
  rateLimit?: RateLimit;
}
