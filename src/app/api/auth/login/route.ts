import { cookies } from 'next/headers';
import { required, appUrl } from '@/lib/env';
import { pool } from '@/lib/db';
import { verifyPassword, signSession, constantEqual } from '@/lib/security';
import { SESSION_COOKIE, sameOrigin } from '@/lib/auth';
import { readJson, readText, noStore } from '@/lib/http';
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: 'Недозволене джерело запиту' }, { status: 403 });
  const nativeForm =
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ===
    'application/x-www-form-urlencoded';
  function failure(error: string, code: string, status: number) {
    if (nativeForm)
      return new Response(null, {
        status: 303,
        headers: { ...noStore, Location: `${appUrl()}/login?error=${code}` },
      });
    return Response.json(
      { error },
      { status, headers: { ...noStore, ...(status === 429 ? { 'Retry-After': '900' } : {}) } },
    );
  }
  const throttle = await pool()
    .query(`INSERT INTO login_attempts(bucket,attempts,reset_at) VALUES('owner',1,now()+interval '15 minutes')
    ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN login_attempts.reset_at<now() THEN 1 ELSE login_attempts.attempts+1 END,
    reset_at=CASE WHEN login_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END RETURNING attempts`);
  if (throttle.rows[0].attempts > 10)
    return failure('Забагато спроб. Спробуйте через 15 хвилин.', 'rate', 429);
  let body: unknown;
  try {
    body = nativeForm
      ? { password: new URLSearchParams(await readText(request, 2048)).get('password') }
      : await readJson(request, 2048);
  } catch {
    return failure('Некоректний запит', 'request', 400);
  }
  const password = (body as { password?: unknown })?.password;
  if (typeof password !== 'string' || password.length > 256)
    return failure('Неправильний пароль', 'credentials', 401);
  const hash = process.env.OWNER_PASSWORD_HASH;
  const plaintext = process.env.OWNER_PASSWORD;
  const valid = hash
    ? await verifyPassword(password, hash)
    : plaintext
      ? constantEqual(password, plaintext)
      : false;
  if (!valid)
    return failure('Неправильний пароль', 'credentials', 401);
  await pool().query("DELETE FROM login_attempts WHERE bucket='owner'");
  (await cookies()).set(SESSION_COOKIE, signSession(required('SESSION_SECRET')), {
    httpOnly: true,
    secure: appUrl().startsWith('https:'),
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 3600,
  });
  if (nativeForm)
    return new Response(null, {
      status: 303,
      headers: { ...noStore, Location: `${appUrl()}/admin` },
    });
  return Response.json({ ok: true }, { headers: noStore });
}
