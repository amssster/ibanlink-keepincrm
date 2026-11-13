import { authorizeMutation } from '@/lib/auth';
import { extendLink } from '@/lib/pipeline';
import { noStore } from '@/lib/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await authorizeMutation(request);
  if (denied) return denied;
  try {
    await extendLink((await params).id);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Помилка' },
      { status: 400, headers: noStore },
    );
  }
}
