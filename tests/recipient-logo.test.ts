import { expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('../src/lib/db', () => ({ pool: () => ({ query }), transaction: async (fn: (db: { query: typeof query }) => Promise<void>) => fn({ query }) }));

import { getSettings, saveSettings } from '../src/lib/settings';
import { createHash } from 'node:crypto';
import { GET } from '../src/app/api/recipients/[key]/logo/route';

const recipient = { key: 'ФОП %20', name: 'Тестовий ФОП', brand: 'Магазин', taxId: '00000000', iban: 'UA890000000000000000000000000', purposeTemplate: 'Оплата {deal_id}' };
const logo = 'data:image/png;base64,aGVsbG8=';

it('використовує вже декодований ключ маршруту', async () => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ data: logo }] });
  const response = await GET(new Request('http://localhost'), { params: Promise.resolve({ key: recipient.key }) });
  expect(query.mock.calls[0][1]).toEqual([recipient.key]);
  expect(response.status).toBe(200);
});

it('видаляє логотипи для порожнього списку', async () => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ data: { recipients: [] } }] });
  await saveSettings({ recipients: [] });
  expect(query.mock.calls.some(([sql]) => sql.includes('DELETE FROM recipient_logos WHERE NOT'))).toBe(true);
});

it('старий версійний URL не повертає нові байти', async () => {
  query.mockReset();
  query.mockResolvedValue({ rows: [{ data: logo }] });
  const oldVersion = createHash('sha256').update('old').digest('hex');
  const response = await GET(new Request(`http://localhost/logo?v=${oldVersion}`), { params: Promise.resolve({ key: recipient.key }) });
  expect(response.status).toBe(404);
});

it('не використовує застарілий кеш іншого процесу', async () => {
  query.mockReset();
  query.mockResolvedValueOnce({ rows: [{ data: { recipients: [recipient] } }] });
  query.mockResolvedValueOnce({ rows: [{ data: { recipients: [{ ...recipient, suspended: true }] } }] });
  expect((await getSettings()).recipients[0].suspended).toBeUndefined();
  expect((await getSettings()).recipients[0].suspended).toBe(true);
});
