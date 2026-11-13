import { randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 60 * 1000;

function secretsMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual ?? ''));
  const expectedBuffer = Buffer.from(String(expected ?? ''));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createAdminAuth({ secret, secureCookies }) {
  const sessions = new Map();

  function prune() {
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
  }

  function login(candidate) {
    prune();
    if (!secret || !secretsMatch(candidate, secret)) return null;
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const session = { csrf, expiresAt: Date.now() + SESSION_TTL_MS };
    sessions.set(token, session);
    return { token, ...session };
  }

  function cookieHeader(token, clear = false) {
    const parts = [`gfe_admin=${clear ? '' : token}`, 'Path=/api/admin', 'HttpOnly', 'SameSite=Strict'];
    if (secureCookies) parts.push('Secure');
    parts.push(clear ? 'Max-Age=0' : `Max-Age=${SESSION_TTL_MS / 1000}`);
    return parts.join('; ');
  }

  function tokenFromRequest(request) {
    const cookies = String(request.headers.cookie ?? '').split(';');
    const entry = cookies.find((cookie) => cookie.trim().startsWith('gfe_admin='));
    return entry ? entry.trim().slice('gfe_admin='.length) : null;
  }

  async function requireAdmin(request, reply) {
    prune();
    const token = tokenFromRequest(request);
    const session = token ? sessions.get(token) : null;
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (!session || session.expiresAt <= Date.now()) {
      return reply.code(401).send({ error: 'Administrator sign-in required.' });
    }
    if (isMutation && request.headers['x-csrf-token'] !== session.csrf) {
      return reply.code(403).send({ error: 'Invalid administrator request token.' });
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    request.adminSession = session;
  }

  function logout(token) {
    if (token) sessions.delete(token);
  }

  return { cookieHeader, login, logout, requireAdmin, tokenFromRequest };
}
