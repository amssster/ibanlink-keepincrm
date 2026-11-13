import { cookies } from 'next/headers';
import { SESSION_COOKIE, authorizeMutation, revokeSession } from '@/lib/auth';
import { appUrl } from '@/lib/env';
export async function POST(request: Request) {
  const denied = await authorizeMutation(request);
  if (denied) return denied;
  const store = await cookies();
  const value = store.get(SESSION_COOKIE)?.value;
  if (value) await revokeSession(value);
  store.delete(SESSION_COOKIE);
  return Response.redirect(appUrl() + '/login', 303);
}
