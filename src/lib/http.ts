export async function readJson(request: Request, max = 32768): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new Error('Потрібен Content-Type application/json');
  try {
    return JSON.parse(await readText(request, max));
  } catch {
    throw new Error('Некоректний JSON або завеликий запит');
  }
}
export async function readText(request: Request, max = 32768): Promise<string> {
  if (Number(request.headers.get('content-length')) > max) throw new Error('Запит завеликий');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Порожній запит');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new Error('Запит завеликий');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}
export const noStore = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
