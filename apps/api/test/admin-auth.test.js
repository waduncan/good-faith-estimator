import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAuth } from '../src/services/admin-auth.js';

test('admin auth rejects the wrong secret and issues independent CSRF state', () => {
  const auth = createAdminAuth({ secret: 'correct horse battery staple', secureCookies: true });
  assert.equal(auth.login('wrong'), null);
  const first = auth.login('correct horse battery staple');
  const second = auth.login('correct horse battery staple');
  assert.ok(first.token);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.csrf, second.csrf);
  assert.match(auth.cookieHeader(first.token), /Secure/);
  assert.match(auth.cookieHeader(first.token), /SameSite=Strict/);
});
