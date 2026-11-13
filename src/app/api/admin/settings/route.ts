import { authorizeMutation } from '@/lib/auth';
import { readJson } from '@/lib/http';
import { saveSettings, getSettings } from '@/lib/settings';
import { z } from 'zod';

const recipientSchema = z.object({
  key: z.string(),
  name: z.string(),
  brand: z.string(),
  iban: z.string(),
  taxId: z.string(),
  purposeTemplate: z.string(),
  logo: z.string().optional(),
  note: z.string().optional(),
  suspended: z.boolean().optional(),
});

const schema = z.object({
  recipients: z.array(recipientSchema).optional(),
  recipient: z
    .object({
      name: z.string(),
      brand: z.string(),
      iban: z.string(),
      taxId: z.string(),
      key: z.string().optional(),
    })
    .optional(),
  stage: z.string(),
  field: z.string(),
  linkTtlDays: z.number().int().min(1).max(30).optional(),
  telegramBotToken: z.string().optional(),
  clearTelegramBotToken: z.boolean().optional(),
  telegramChatId: z.string().optional(),
  purposeTemplate: z.string().optional(),
  enabled: z.boolean(),
  confirmed: z.boolean().optional(),
});

export async function POST(request: Request) {
  const denied = await authorizeMutation(request);
  if (denied) return denied;
  try {
    const raw = await readJson(request);
    const value = schema.parse(raw);
    const stored = await getSettings();
    if (value.enabled && !stored.enabled && !value.confirmed)
      throw new Error(
        'Підтвердьте перевірку сум, часу, подій та запису тестового посилання через Response',
      );
    let recipients = value.recipients;
    if (!recipients && value.recipient) {
      recipients = [
        {
          key: value.recipient.key || 'Основний',
          name: value.recipient.name,
          brand: value.recipient.brand,
          iban: value.recipient.iban,
          taxId: value.recipient.taxId,
          purposeTemplate: value.purposeTemplate || 'Оплата за замовлення №{deal_id}',
        },
      ];
    }
    let telegramBotToken = stored.telegramBotToken ?? '';
    if (value.clearTelegramBotToken) {
      telegramBotToken = '';
    } else if (value.telegramBotToken && value.telegramBotToken.trim().length > 0) {
      telegramBotToken = value.telegramBotToken.trim();
    }
    await saveSettings({
      recipients: recipients ?? stored.recipients,
      stage: value.stage,
      field: value.field,
      linkTtlDays: value.linkTtlDays ?? stored.linkTtlDays ?? 7,
      telegramBotToken,
      telegramChatId: value.telegramChatId ?? stored.telegramChatId ?? '',
      enabled: value.enabled,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? 'Перевірте заповнення всіх полів'
            : error instanceof Error
              ? error.message
              : 'Не вдалося зберегти',
      },
      { status: 400 },
    );
  }
}
