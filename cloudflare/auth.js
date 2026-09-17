import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { fromHex, toHex } from '../shared/credentials.js';

const encoder = new TextEncoder();
export const randomToken = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
export async function hashToken(value) {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
async function pepperKey(secret) {
  if (!secret || secret.length < 32)
    throw new Error('AUTH_SECRET chưa được cấu hình. Chạy npm run cf:secret sau lần deploy đầu.');
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}
export async function hashCredential(credential, secret) {
  const salt = randomToken();
  const hash = await crypto.subtle.sign(
    'HMAC',
    await pepperKey(secret),
    encoder.encode(`candate-v1:${salt}:${credential}`)
  );
  return `cf-v1:${salt}:${toHex(hash)}`;
}
export async function verifyCredential(credential, stored, secret) {
  const [version, salt, hash] = (stored || '').split(':');
  const valid =
    version === 'cf-v1' && /^[a-f0-9]{64}$/.test(salt || '') && /^[a-f0-9]{64}$/.test(hash || '');
  const verified = await crypto.subtle.verify(
    'HMAC',
    await pepperKey(secret),
    fromHex(valid ? hash : '0'.repeat(64)),
    encoder.encode(`candate-v1:${valid ? salt : '0'.repeat(64)}:${credential}`)
  );
  return valid && verified;
}
export async function authenticate(c, next) {
  const token = getCookie(c, 'session');
  const user =
    token && /^[a-f0-9]{64}$/.test(token)
      ? await c.env.DB.prepare(
          'SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1'
        )
          .bind(await hashToken(token), Date.now())
          .first()
      : null;
  c.set('user', user);
  await next();
}
export const requireRoles =
  (...roles) =>
  async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Vui lòng đăng nhập để tiếp tục.' }, 401);
    if (!roles.includes(user.role))
      return c.json({ error: 'Bạn không có quyền thực hiện thao tác này.' }, 403);
    await next();
  };
export function setSessionCookie(c, token) {
  setCookie(c, 'session', token, {
    httpOnly: true,
    sameSite: 'Strict',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: 7 * 86400,
    path: '/',
  });
}
export async function logout(c) {
  const token = getCookie(c, 'session');
  if (token)
    await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash=?')
      .bind(await hashToken(token))
      .run();
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ ok: true });
}
export async function authRateLimit(c, next) {
  const now = Date.now();
  const key = await hashToken(
    `${c.req.header('cf-connecting-ip') || 'local'}:${Math.floor(now / 900000)}`
  );
  const [, result] = await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM auth_attempts WHERE expires_at<=?').bind(now),
    c.env.DB.prepare(
      'INSERT INTO auth_attempts(id,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 RETURNING attempts'
    ).bind(key, now + 900000),
  ]);
  if (result.results[0].attempts > 40)
    return c.json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.' }, 429);
  await next();
}
