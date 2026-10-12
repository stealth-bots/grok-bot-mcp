import type { LogFn } from './types';

const SAFE_FIELDS = new Set([
  'caller',
  'method',
  'status',
  'job_id',
  'outcome',
  'bytes',
  'store',
  'path',
  'name',
]);

export function createLogger(write: (line: string) => void): LogFn {
  return (event, fields) => {
    const safeEvent = /^[a-z0-9_]+$/.test(event) ? event : 'log';
    const safe: Record<string, string | number | boolean> = { event: safeEvent };
    for (const [key, value] of Object.entries(fields)) {
      if (SAFE_FIELDS.has(key)) safe[key] = value;
    }
    write(JSON.stringify(safe));
  };
}
