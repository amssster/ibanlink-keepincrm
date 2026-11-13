import { constantEqual } from './security';
import { webhookSecret } from './crm';
import { parseEvent, type EventKind } from './domain';
import { receive } from './pipeline';
import { readJson, noStore } from './http';
export async function handleWebhook(kind: EventKind, request: Request): Promise<Response> {
  const secret = webhookSecret(kind);
  if (secret.length < 32)
    return Response.json({ error: 'Інтеграцію не налаштовано' }, { status: 503 });
  if (!constantEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`))
    return Response.json({ error: 'Недозволений запит' }, { status: 401 });
  let input: unknown;
  try {
    input = await readJson(request);
    parseEvent(kind, input);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Некоректні дані' },
      { status: 400, headers: noStore },
    );
  }
  try {
    const result = await receive(kind, input);
    if (kind === 'issue' && !result.payment_url)
      return Response.json(
        { ...result, error: 'Немає активного запиту на оплату. Перевірте залишок і стан угоди.' },
        { status: 409, headers: noStore },
      );
    return Response.json(result, { status: 200, headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('конфлікт')) return Response.json({ error: message }, { status: 409 });
    if (message.startsWith('Час події')) return Response.json({ error: message }, { status: 400 });
    return Response.json(
      { error: 'Подію не збережено. Повторіть запит пізніше.' },
      { status: 503, headers: noStore },
    );
  }
}
