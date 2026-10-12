import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { D1JobStore, MemoryJobStore, UpstashJobStore, createJobStore, type D1Database } from '../src/lib/job-store';
import { fakeRedis } from './fake-upstash';
import { runJobStoreSuite } from './job-store.suite';
import { createSqliteD1 } from './sqlite-d1';

describe('memory job store', () => {
  runJobStoreSuite((clock) => new MemoryJobStore(clock.now));
});

describe('upstash job store', () => {
  runJobStoreSuite((clock) => new UpstashJobStore('https://redis.example', 'secret-token', fakeRedis(clock).fetchImpl, clock.now));
});

describe('d1 job store', () => {
  runJobStoreSuite((clock) => new D1JobStore(createSqliteD1(), clock.now));

  it('completes with one UPDATE that matches pending rows', async () => {
    const queries: string[] = [];
    const db = recordingD1(createSqliteD1(), queries);
    const store = new D1JobStore(db, () => 1_000);
    expect(await store.create('job-1', { status: 'pending', caller: 'claude', createdAt: 0 }, 60)).toBe(true);
    queries.length = 0;
    expect(await store.complete('job-1', { status: 'done', caller: 'claude', createdAt: 0, reply: 'yes' }, 60)).toBe(
      'updated',
    );
    const update = queries.find((query) => query.trimStart().startsWith('UPDATE'));
    expect(update).toContain("status = 'pending'");
    expect(update).toContain('expires_at >');
    expect(update).not.toContain('expires_at =');
    expect(await store.complete('job-1', { status: 'done', caller: 'claude', createdAt: 0, reply: 'no' }, 60)).toBe(
      'not_pending',
    );
    expect(await store.get('job-1')).toMatchObject({ reply: 'yes' });
  });

  it('deletes expired rows, including ones nobody reads, and allows the id to be reused', async () => {
    let now = 1_000_000;
    const db = createSqliteD1();
    const store = new D1JobStore(db, () => now);
    const pending = { status: 'pending' as const, caller: 'claude', createdAt: 0 };
    expect(await store.create('old', pending, 60)).toBe(true);
    expect(await store.create('fresh', pending, 60)).toBe(true);
    now += 60_000;
    expect(await store.get('fresh')).toBeNull();
    expect(await jobIds(db)).toEqual([]);

    expect(await store.create('old', pending, 60)).toBe(true);
    expect(await store.create('unread', pending, 30)).toBe(true);
    now += 30_000;
    expect(await store.get('old')).toMatchObject({ status: 'pending' });
    expect(await jobIds(db)).toEqual(['old']);
  });

  it('applies the jobs migration', () => {
    const sql = readFileSync(new URL('../migrations/0001_create_jobs.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS jobs');
    expect(sql).toContain('job_id TEXT PRIMARY KEY');
    expect(sql).toContain('expires_at INTEGER NOT NULL');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS jobs_expires_at ON jobs (expires_at)');
  });
});

describe('job store factory', () => {
  const db: D1Database = {
    prepare() {
      throw new Error('unused');
    },
  };

  it('picks D1 on workers, Upstash on node, and memory for dev', () => {
    expect(createJobStore({ target: 'worker', db }).kind).toBe('d1');
    expect(createJobStore({ target: 'node', upstash: { url: 'https://u.example', token: 't' } }).kind).toBe('upstash');
    expect(createJobStore({ target: 'dev' }).kind).toBe('memory');
    expect(() => createJobStore({ target: 'worker' })).toThrow(/D1/);
    expect(() => createJobStore({ target: 'node', upstash: null })).toThrow(/Upstash/);
  });
});

async function jobIds(db: D1Database): Promise<string[]> {
  const rows = await db.prepare('SELECT job_id FROM jobs ORDER BY job_id').all<{ job_id: string }>();
  return (rows.results ?? []).map((row) => row.job_id);
}

function recordingD1(inner: D1Database, queries: string[]): D1Database {
  return {
    prepare(query) {
      queries.push(query);
      return inner.prepare(query);
    },
  };
}
