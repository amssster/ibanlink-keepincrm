import { authorizeMutation } from '@/lib/auth';
import { disableLink } from '@/lib/pipeline';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorizeMutation(request);
  if (denied) return denied;
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id))
    return Response.json({ error: 'Некоректний ID' }, { status: 400 });
  try {
    await disableLink(id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Не вдалося вимкнути посилання' }, { status: 400 });
  }
}
