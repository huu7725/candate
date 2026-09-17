import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export function createSession(db, res, userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
    hashToken(token),
    userId,
    Date.now() + 7 * 86400000
  );
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 86400000,
    path: '/',
  });
}
export function getSessionToken(req) {
  return (req.headers.cookie || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('session='))
    ?.slice(8);
}
export function authenticate(db) {
  return (req, res, next) => {
    const token = getSessionToken(req);
    req.user = token
      ? db
          .prepare(
            'SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1'
          )
          .get(hashToken(token), Date.now())
      : null;
    next();
  };
}
export const requireRoles =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    next();
  };
