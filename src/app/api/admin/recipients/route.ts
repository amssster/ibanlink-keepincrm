import { authorizeMutation } from '@/lib/auth';
import { readJson } from '@/lib/http';
import { getSettings, saveSettings, paymentCritical } from '@/lib/settings';
import { validateRecipientConfig, type RecipientConfig } from '@/lib/payment';

export async function POST(request: Request) {
  const denied = await authorizeMutation(request);
  if (denied) return denied;
  try {
    const body = (await readJson(request)) as { recipients: RecipientConfig[] };
    if (!Array.isArray(body?.recipients)) {
      return Response.json({ error: 'Очікується список отримувачів' }, { status: 400 });
    }
    const stored = await getSettings();
    const nextRecipients = body.recipients.map(validateRecipientConfig);
    const criticalOld = (stored.recipients ?? []).map(paymentCritical);
    const criticalNext = nextRecipients.map(paymentCritical);
    const changed = JSON.stringify(criticalOld) !== JSON.stringify(criticalNext);

    const integrationDisabled = changed && stored.enabled;
    await saveSettings({
      ...stored,
      recipients: nextRecipients,
      enabled: changed ? false : stored.enabled,
    });
    return Response.json({
      ok: true,
      recipients: (await getSettings()).recipients,
      integrationDisabled,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Не вдалося зберегти' },
      { status: 400 },
    );
  }
}
