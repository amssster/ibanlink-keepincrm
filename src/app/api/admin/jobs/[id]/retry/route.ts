import { authorizeMutation } from '@/lib/auth';
import { retryJob } from '@/lib/pipeline';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorizeMutation(request);
  if (denied) return denied;
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id))
    return Response.json({ error: 'Некоректний ID' }, { status: 400 });
  try {
    const result = await retryJob(id);
    return Response.json(result, { status: result.status === 'failed' ? 422 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не вдалося повторити операцію';
    if (
      message === 'Операцію не знайдено або повтор недоступний' ||
      message.startsWith('Право обробки втрачено')
    )
      return Response.json({ error: message }, { status: 409 });
    return Response.json(
      { error: 'Не вдалося визначити результат операції. Повтор може створити дублікат.' },
      { status: 500 },
    );
  }
}
