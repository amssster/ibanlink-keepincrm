import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { pool } from './db';
import { redirect } from 'next/navigation';
import { appUrl, required } from './env';
import { verifySession } from './security';
export const SESSION_COOKIE = 'iban_owner';
function sessionBucket(value: string): string {
  return `revoked:${createHash('sha256').update(value).digest('hex')}`;
}
export async function isOwner(): Promise<boolean> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value ?? '';
  if (!verifySession(value, required('SESSION_SECRET'))) return false;
  const result = await pool().query('SELECT 1 FROM login_attempts WHERE bucket=$1', [sessionBucket(value)]);
  return result.rows.length === 0;
}
export async function revokeSession(value: string): Promise<void> {
  await pool().query(
    `INSERT INTO login_attempts(bucket,attempts,reset_at) VALUES($1,0,to_timestamp($2::double precision / 1000))
     ON CONFLICT(bucket) DO UPDATE SET reset_at=EXCLUDED.reset_at`,
    [sessionBucket(value), value.split('.')[0]],
  );
}
export async function requireOwner() {
  if (!(await isOwner())) redirect('/login');
}
export function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === appUrl();
}
export async function authorizeMutation(request: Request): Promise<Response | null> {
  if (!sameOrigin(request))
    return Response.json({ error: 'Недозволене джерело запиту' }, { status: 403 });
  if (!(await isOwner())) return Response.json({ error: 'Увійдіть до кабінету' }, { status: 401 });
  return null;
}
