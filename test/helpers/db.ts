import { Pool } from 'pg';
import { Database } from '../../src/db/database';

let pool: Pool | undefined;

export function getTestPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set (run tests via `npm test`, not `jest` directly)');
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

export function getTestDatabase(): Database {
  return new Database(getTestPool());
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
