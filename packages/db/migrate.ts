import { readdir, readFile } from 'node:fs/promises';
import { pool } from './pool';

const MIGRATIONS = new URL('./migrations/', import.meta.url);

/**
 * Applies every file in `migrations/` that hasn't run yet, in name order, each in its own
 * transaction. Never edit a file once it has run somewhere: add a new one instead.
 */
async function migrate(): Promise<void> {
  const db = pool();
  await db.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const { rows } = await db.query<{ name: string }>(
    'select name from schema_migrations',
  );
  const applied = new Set(rows.map(({ name }) => name));
  const files = (await readdir(MIGRATIONS))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(new URL(file, MIGRATIONS), 'utf8');
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [
        file,
      ]);
      await client.query('commit');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  console.log('Database is up to date.');
  await db.end();
}

await migrate();
