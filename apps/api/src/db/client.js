import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export function createDatabase(connectionString, logger) {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000,
  });

  pool.on('error', (error) => {
    logger.error({ code: error.code }, 'Idle PostgreSQL connection failed');
  });

  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}
