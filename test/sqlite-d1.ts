import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../src/lib/job-store';

const MIGRATION = new URL('../migrations/0001_create_jobs.sql', import.meta.url);

export function createSqliteD1(): D1Database {
  const database = new DatabaseSync(':memory:');
  database.exec(readFileSync(MIGRATION, 'utf8'));
  return {
    prepare(query: string): D1PreparedStatement {
      return bind(database, query, []);
    },
  };
}

function bind(database: DatabaseSync, query: string, values: unknown[]): D1PreparedStatement {
  const statement: D1PreparedStatement = {
    bind(...more: unknown[]) {
      return bind(database, query, [...values, ...more]);
    },
    async run(): Promise<D1Result> {
      const info = database.prepare(query).run(...sqlValues(values));
      return { success: true, meta: { changes: Number(info.changes) }, results: [] };
    },
    async first<T = Record<string, unknown>>(): Promise<T | null> {
      const row = database.prepare(query).get(...sqlValues(values)) as T | undefined;
      return row ?? null;
    },
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const results = database.prepare(query).all(...sqlValues(values)) as T[];
      return { success: true, meta: { changes: 0 }, results };
    },
  };
  return statement;
}

function sqlValues(values: unknown[]): SQLInputValue[] {
  return values.map((value) => (value === undefined ? null : (value as SQLInputValue)));
}
