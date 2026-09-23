import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultDirectory = fileURLToPath(new URL('../migrations', import.meta.url));
const lockId = 714_056_501;

export async function runMigrations(pool, { directory = defaultDirectory, advisoryLock = true } = {}) {
  const client = await pool.connect();
  try {
    if (advisoryLock) await client.query('SELECT pg_advisory_lock($1)', [lockId]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const files = (await readdir(resolve(directory)))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
      .sort((a, b) => a.localeCompare(b));
    const applied = [];
    for (const filename of files) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename]);
      if (existing.rowCount) continue;
      const sql = await readFile(resolve(directory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        applied.push(filename);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return applied;
  } finally {
    if (advisoryLock) await client.query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => {});
    client.release();
  }
}

