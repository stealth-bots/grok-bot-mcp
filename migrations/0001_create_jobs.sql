CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  caller TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reply TEXT,
  error TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_expires_at ON jobs (expires_at);
