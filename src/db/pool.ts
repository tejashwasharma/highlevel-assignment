import { Pool } from 'pg';

let interactivePool: Pool | undefined;
let workerPool: Pool | undefined;

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

export function getWorkerPool(): Pool {
  if (!workerPool) {
    workerPool = new Pool({ connectionString: requireConnectionString(), max: 5 });
  }
  return workerPool;
}
