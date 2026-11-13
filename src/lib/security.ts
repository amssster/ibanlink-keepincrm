import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
function keyBytes(key: string) {
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('Ключ повинен містити 64 hex-символи');
  return Buffer.from(key, 'hex');
}
export function constantEqual(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(value, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(value: string, hash: string): Promise<boolean> {
  const [type, salt, expected] = hash.split(':');
  if (
    type !== 'scrypt' ||
    !/^[0-9a-f]{32}$/.test(salt ?? '') ||
    !/^[0-9a-f]{128}$/.test(expected ?? '')
  )
    return false;
  const actual = (await derive(value, salt, 64)) as Buffer;
  return constantEqual(actual.toString('hex'), expected);
}
export function signSession(key: string, now = Date.now()): string {
  keyBytes(key);
  const body = `${now + 8 * 3600 * 1000}.${randomBytes(24).toString('hex')}`;
  return `${body}.${createHmac('sha256', key).update(body).digest('hex')}`;
}
export function verifySession(value: string, key: string, now = Date.now()): boolean {
  const [expiry, nonce, signature, ...extra] = value.split('.');
  if (
    extra.length ||
    !/^\d{1,13}$/.test(expiry ?? '') ||
    !/^[a-f0-9]{48}$/.test(nonce ?? '') ||
    !signature
  )
    return false;
  const expected = createHmac('sha256', key).update(`${expiry}.${nonce}`).digest('hex');
  return (
    Number(expiry) > now &&
    Number(expiry) <= now + 8 * 3600 * 1000 &&
    constantEqual(signature, expected)
  );
}
