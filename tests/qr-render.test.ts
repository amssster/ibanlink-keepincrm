import { expect, it } from 'vitest';
import { qrSvg } from '../src/lib/qr';
import { nbuPayload } from '../src/lib/payment';

it('QR з обов’язковим знаком гривні генерує коректний NBU SVG', async () => {
  const payload = nbuPayload(
    {
      name: 'Тестовий ФОП',
      brand: 'Магазин',
      taxId: '00000000',
      iban: 'UA890000000000000000000000000',
    },
    12345,
    'Оплата за замовлення №42',
  );
  const svg = await qrSvg(payload);
  expect(svg).toContain('<svg');
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('viewBox=');
  expect(svg).toContain('<circle cx="46.5" cy="46.5" r="12.5" fill="white"/>');
  expect(svg).toContain('<path d="M40 39 C43 34 54 35 53 41');
});
