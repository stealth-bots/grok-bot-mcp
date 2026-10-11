import { describe, expect, it } from 'vitest';
import { readUpstash } from '../src/core/config';
import { KvJobStore, type KvBinding } from '../src/core/kv-store';
import { createStore } from '../src/core/store-factory';
import { UpstashJobStore } from '../src/core/upstash-store';
import type { JobRecord } from '../src/core/types';

const job = (status: JobRecord['status'] = 'pending'): JobRecord => ({
  status,
  caller: 'claude',
  createdAt: 0,
});

describe('UpstashJobStore', () => {
  it('sends REST commands and does not log the token', async () => {
    const saved = new Map<string, string>();
    const commands: string[][] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const command = JSON.parse(String(init?.body)) as string[];
      commands.push(command);
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer secret-token');
      expect(String(input)).toBe('https://redis.example');
      const [op, key, value] = command;
      if (op === 'SET' && command.includes('NX')) {
        if (saved.has(key ?? '')) return Response.json({ result: null });
        saved.set(key ?? '', value ?? '');
        return Response.json({ result: 'OK' });
      }
      if (op === 'SET') {
        saved.set(key ?? '', value ?? '');
        return Response.json({ result: 'OK' });
      }
      if (op === 'GET') return Response.json({ result: saved.get(key ?? '') ?? null });
      return Response.json({ error: 'bad command' }, { status: 200 });
    };

    const store = new UpstashJobStore('https://redis.example', 'secret-token', fetchImpl, () => 0);
    expect(await store.create('job-1', job(), 60)).toBe(true);
    expect(await store.create('job-1', job(), 60)).toBe(false);
    expect(await store.get('job-1')).toMatchObject({ status: 'pending' });
    expect(await store.complete('job-1', { ...job('done'), reply: 'yes' }, 60)).toBe('updated');
    expect(await store.complete('job-1', { ...job('done'), reply: 'no' }, 60)).toBe('not_pending');
    expect(commands.some((command) => command.includes('secret-token'))).toBe(false);
  });

  it('prefers Upstash env names, then Vercel KV names', () => {
    expect(readUpstash({ UPSTASH_REDIS_REST_URL: 'https://u.example/', UPSTASH_REDIS_REST_TOKEN: 't' })).toEqual({
      url: 'https://u.example',
      token: 't',
    });
    expect(readUpstash({ KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'k' })).toEqual({
      url: 'https://kv.example',
      token: 'k',
    });
    expect(() => readUpstash({ UPSTASH_REDIS_REST_URL: 'https://u.example' })).toThrow(/Incomplete Upstash/);
    expect(createStore({}).kind).toBe('memory');
    expect(
      createStore({ UPSTASH_REDIS_REST_URL: 'https://u.example', UPSTASH_REDIS_REST_TOKEN: 't' }, { kv: fakeKv() }).kind,
    ).toBe('upstash');
    expect(createStore({}, { kv: fakeKv() }).kind).toBe('kv');
  });
});

describe('KvJobStore', () => {
  it('writes with a TTL of at least 60 seconds', async () => {
    const kv = fakeKv();
    const store = new KvJobStore(kv, () => 0);
    expect(await store.create('job-1', job(), 10)).toBe(true);
    expect(kv.ttls.get('job:job-1')).toBe(60);
    expect(await store.get('job-1')).toMatchObject({ caller: 'claude' });
    expect(await store.complete('job-1', { ...job('error'), error: 'nope' }, 10)).toBe('updated');
    expect(await store.get('missing')).toBeNull();
  });
});

function fakeKv(): KvBinding & { ttls: Map<string, number | undefined> } {
  const values = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  return {
    ttls,
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value, options) {
      values.set(key, value);
      ttls.set(key, options?.expirationTtl);
    },
  };
}
