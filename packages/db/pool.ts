import pg from 'pg';

let shared: pg.Pool | undefined;

/**
 * The one connection pool for this process, made on first use. The connection string holds
 * the database password, so it only ever comes from the environment and is never logged.
 */
export function pool(): pg.Pool {
  if (!shared) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      const error = new Error(
        'DATABASE_URL is not set. Put it in the .env file at the repo root.',
      );
      error.name = 'MissingDatabaseUrl';
      throw error;
    }
    shared = new pg.Pool({ connectionString, max: 5 });
  }
  return shared;
}
