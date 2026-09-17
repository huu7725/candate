// The browser performs the password KDF so authentication fits Workers Free's
// CPU budget. The derived value is a password-equivalent: only send over HTTPS,
// never persist/log it. The Worker stores a salted HMAC verifier with a secret
// pepper kept outside D1. Raw passwords never leave the browser in this mode.
export const KDF_ITERATIONS = 600000;
const encoder = new TextEncoder();
export const toHex = (bytes) =>
  [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, '0')).join('');
export const fromHex = (value) =>
  Uint8Array.from(value.match(/.{2}/g) || [], (v) => parseInt(v, 16));
export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}
export async function deriveCredential(email, password) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(`candate-password-v1:${normalizeEmail(email)}`),
      iterations: KDF_ITERATIONS,
    },
    key,
    256
  );
  return toHex(bits);
}
