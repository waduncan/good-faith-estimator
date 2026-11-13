import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { createDatabase } from './db/client.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerPublicRoutes } from './routes/public.js';
import { createAdminAuth } from './services/admin-auth.js';

export async function buildApp({ databaseUrl, serveWeb = false, adminSecret, secureCookies = false } = {}) {
  const app = Fastify({
    bodyLimit: 2 * 1024 * 1024,
    logger: {
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
    },
  });

  app.addContentTypeParser(['text/csv', 'application/octet-stream'], {
    parseAs: 'buffer',
    bodyLimit: 25 * 1024 * 1024,
  }, (request, body, done) => done(null, body));

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (request.url.startsWith('/api/estimates')) reply.header('Cache-Control', 'no-store, private');
    return payload;
  });

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

  await registerPublicRoutes(app, database);
  if (database) {
    const adminAuth = createAdminAuth({ secret: adminSecret, secureCookies });
    await registerAdminRoutes(app, database, adminAuth);
  }

  app.setErrorHandler((error, request, reply) => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: 'CSV files must be 25 MB or smaller.' });
    }
    if (error.code === '23505') return reply.code(409).send({ error: 'That record already exists.' });
    request.log.error({ err: error }, 'Request failed');
    return reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500)
      .send({ error: error.statusCode && error.statusCode < 500 ? error.message : 'Unexpected server error.' });
  });

  return app;
}
