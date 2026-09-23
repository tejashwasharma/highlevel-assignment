import { getRedisClient } from '../../src/redis/client';

export function dedupeKey(workspaceId: string, filterHash: string): string {
  return `bulkmove:${workspaceId}:${filterHash}`;
}

export async function readDedupeHash(
  workspaceId: string,
  filterHash: string,
): Promise<Record<string, string>> {
  const client = await getRedisClient();
  return client.hGetAll(dedupeKey(workspaceId, filterHash));
}

export async function deleteDedupeKey(workspaceId: string, filterHash: string): Promise<void> {
  const client = await getRedisClient();
  await client.del(dedupeKey(workspaceId, filterHash));
}

export async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}
