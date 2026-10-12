import {
  DEFAULT_JOB_TTL_SECONDS,
  DEFAULT_MAX_MESSAGE_BYTES,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_WAIT_SECONDS,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  MAX_WAIT_SECONDS,
  MIN_JOB_TTL_SECONDS,
} from './constants';
import { parseApiKeys } from './auth';
import type { AppConfig } from './types';

export type EnvMap = Record<string, string | undefined>;

export function configFromEnv(env: EnvMap): AppConfig {
  return {
    webhookUrl: clean(env.GROK_BOT_WEBHOOK_URL),
    webhookKey: clean(env.GROK_BOT_WEBHOOK_KEY),
    replySecret: clean(env.REPLY_SECRET),
    apiKeys: parseApiKeys(env.MCP_API_KEY),
    publicBaseUrl: stripTrailingSlash(clean(env.PUBLIC_BASE_URL)),
    waitSeconds: integerEnv(env.WAIT_SECONDS, DEFAULT_WAIT_SECONDS, 0, MAX_WAIT_SECONDS),
    jobTtlSeconds: integerEnv(env.JOB_TTL_SECONDS, DEFAULT_JOB_TTL_SECONDS, MIN_JOB_TTL_SECONDS, 7 * 24 * 60 * 60),
    maxMessageBytes: integerEnv(env.MAX_MESSAGE_BYTES, DEFAULT_MAX_MESSAGE_BYTES, 1, 64 * 1024),
    webhookTimeoutMs: integerEnv(env.WEBHOOK_TIMEOUT_MS, DEFAULT_WEBHOOK_TIMEOUT_MS, 1000, 30_000),
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };
}

export interface UpstashCredentials {
  url: string;
  token: string;
}

export function readUpstash(env: EnvMap): UpstashCredentials | null {
  const upstashUrl = clean(env.UPSTASH_REDIS_REST_URL);
  const upstashToken = clean(env.UPSTASH_REDIS_REST_TOKEN);
  if (upstashUrl || upstashToken) {
    if (!upstashUrl || !upstashToken) {
      throw new Error('Incomplete Upstash Redis REST configuration. Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
    }
    return { url: stripTrailingSlash(upstashUrl), token: upstashToken };
  }

  const kvUrl = clean(env.KV_REST_API_URL);
  const kvToken = clean(env.KV_REST_API_TOKEN);
  if (kvUrl || kvToken) {
    if (!kvUrl || !kvToken) {
      throw new Error('Incomplete Vercel KV REST configuration. Set both KV_REST_API_URL and KV_REST_API_TOKEN.');
    }
    return { url: stripTrailingSlash(kvUrl), token: kvToken };
  }

  return null;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function stripTrailingSlash(value: string): string;
function stripTrailingSlash(value: string | undefined): string | undefined;
function stripTrailingSlash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\/+$/, '');
}

function integerEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
