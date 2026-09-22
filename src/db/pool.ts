import { Pool } from 'pg';

let interactivePool: Pool | undefined;

function requireConnectionString(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return connectionString;
}

export function getInteractivePool(): Pool {
  if (!interactivePool) {
    interactivePool = new Pool({ connectionString: requireConnectionString(), max: 20 });
  }
  return interactivePool;
}
