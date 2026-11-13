import { publicLink, linkStatus } from '@/lib/queries';
import { nbuPayload } from '@/lib/payment';
import { qrSvg } from '@/lib/qr';
import { noStore } from '@/lib/http';
import { getSettings } from '@/lib/settings';

const qrCache = new Map<string, { svg: string; expiresAt: number }>();
const MAX_QR_CACHE_SIZE = 1000;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await publicLink(token);
  if (!link || linkStatus(link) !== 'active')
    return new Response('Посилання недоступне', { status: 410, headers: noStore });
  const settings = await getSettings();
  const recipient = settings.recipients.find((r) => r.key === link.recipient.key);
  if (recipient?.suspended) {
    return new Response('Посилання недоступне: отримувача призупинено', {
      status: 410,
      headers: noStore,
    });
  }

  const cached = qrCache.get(token);
  const now = Date.now();
  let svg = cached && cached.expiresAt > now ? cached.svg : '';

  if (!svg) {
    svg = await qrSvg(nbuPayload(link.recipient, Number(link.amount_minor), link.purpose));
    const expiresAt = Math.min(now + 3600000, new Date(link.expires_at).getTime());
    if (qrCache.size >= MAX_QR_CACHE_SIZE) {
      const oldest = qrCache.keys().next().value;
      if (oldest) qrCache.delete(oldest);
    }
    qrCache.set(token, { svg, expiresAt });
  }

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
}
