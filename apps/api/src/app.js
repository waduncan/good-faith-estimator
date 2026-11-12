import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { createDatabase } from './db/client.js';

export async function buildApp({ databaseUrl, serveWeb = false } = {}) {
  const app = Fastify({ logger: true });

  if (serveWeb) {
    const webRoot = new URL('../../web/dist/', import.meta.url);
    await access(new URL('index.html', webRoot)).catch(() => {
      throw new Error('Frontend build missing. Run npm run build first.');
    });
    await app.register(fastifyStatic, { root: fileURLToPath(webRoot) });
  }

  const database = databaseUrl ? createDatabase(databaseUrl, app.log) : null;
  if (database) {
    app.addHook('onClose', () => database.close());
  }

  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/ready', async (request, reply) => {
    if (!database) {
      return reply.code(503).send({ status: 'unavailable' });
    }

    try {
      await database.db.execute(sql`select 1`);
      return { status: 'ready' };
    } catch (error) {
      request.log.warn({ code: error.cause?.code ?? error.code }, 'PostgreSQL readiness check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  return app;
}
