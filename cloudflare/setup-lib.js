import { z } from 'zod';
import { deriveCredential, normalizeEmail } from '../shared/credentials.js';
import { hashCredential } from './auth.js';

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(12).max(128),
});
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export async function adminInsertSQL(input, secret) {
  const data = schema.parse(input);
  const email = normalizeEmail(data.email);
  const credential = await deriveCredential(email, data.password);
  const hash = await hashCredential(credential, secret);
  // Never reset an existing admin, and never elevate an existing customer.
  return `INSERT INTO users(name,email,password_hash,role) SELECT ${quote(data.name)},${quote(email)},${quote(hash)},'admin' WHERE NOT EXISTS(SELECT 1 FROM users WHERE role='admin');`;
}
