import { publicLink, linkStatus } from '@/lib/queries';
import { nbuPayload, bankUrl } from '@/lib/payment';
import { noStore } from '@/lib/http';
import { getSettings } from '@/lib/settings';

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const link = await publicLink((await params).token);
  if (!link || linkStatus(link) !== 'active')
    return new Response('Посилання більше не діє. Зверніться до продавця.', {
      status: 410,
      headers: noStore,
    });
  const settings = await getSettings();
  const recipient = settings.recipients.find((r) => r.key === link.recipient.key);
  if (recipient?.suspended) {
    return new Response('Посилання більше не діє. Отримувача призупинено.', {
      status: 410,
      headers: noStore,
    });
  }
  const agent = request.headers.get('user-agent') ?? '';
  const platform = /Android/i.test(agent)
    ? 'android'
    : /iPhone|iPad/i.test(agent)
      ? 'ios'
      : 'desktop';
  const bank = new URL(request.url).searchParams.get('bank') === 'privat' ? 'privat' : 'mono';
  return new Response(null, {
    status: 303,
    headers: {
      ...noStore,
      Location: bankUrl(
        bank,
        platform,
        nbuPayload(link.recipient, Number(link.amount_minor), link.purpose),
      ),
    },
  });
}
