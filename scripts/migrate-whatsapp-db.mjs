import pg from 'pg';
import { runMigrations } from '../src/db-migrations.mjs';

const databaseUrl = process.env.WHATSAPP_DATABASE_URL;
if (!databaseUrl) throw new Error('WHATSAPP_DATABASE_URL is required');

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
try {
  const applied = await runMigrations(pool);
  console.log(JSON.stringify({ service: 'whatsapp-database', migrationStatus: 'ready', appliedCount: applied.length }));
} finally {
  await pool.end();
}

