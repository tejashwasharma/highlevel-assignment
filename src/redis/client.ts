import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

let client: RedisClientType | undefined;
let connecting: Promise<RedisClientType> | undefined;

async function connect(): Promise<RedisClientType> {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const instance = createClient({
    url,
    socket: {
      connectTimeout: 300,
      reconnectStrategy: false,
    },
  }) as RedisClientType;
  instance.on('error', (err) => {
    logger.warn('redis client error', { err: err instanceof Error ? err.message : String(err) });
  });
  await instance.connect();
  return instance;
}

export async function getRedisClient(): Promise<RedisClientType> {
  if (client?.isOpen) {
    return client;
  }
  if (!connecting) {
    connecting = connect()
      .then((instance) => {
        client = instance;
        return instance;
      })
      .finally(() => {
        connecting = undefined;
      });
  }
  return connecting;
}
