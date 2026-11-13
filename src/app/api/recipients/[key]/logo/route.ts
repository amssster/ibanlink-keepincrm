import { createHash } from 'node:crypto';
import { getRecipientLogo } from '@/lib/settings';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const logoData = await getRecipientLogo(key);

  if (!logoData) {
    return new Response('Логотип не налаштовано', { status: 404 });
  }

  const version = new URL(request.url).searchParams.get('v');
  if (version && version !== createHash('sha256').update(logoData).digest('hex')) {
    return new Response('Логотип не налаштовано', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const match = logoData.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return new Response('Некоректний формат логотипа', { status: 500 });
  }

  const [, contentType, base64Data] = match;
  const buffer = Buffer.from(base64Data, 'base64');

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
