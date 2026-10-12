import type { JobStore } from '../lib/job-store';

export type { CompleteResult, JobRecord, JobStatus, JobStore } from '../lib/job-store';

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
