import Link from 'next/link';
import { requireOwner } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { SettingsForm } from '@/components/settings-form';

export default async function SettingsPage() {
  await requireOwner();
  const stored = await getSettings();
  const initial = {
    recipients: stored.recipients,
    stage: stored.stage,
    field: stored.field,
    linkTtlDays: stored.linkTtlDays,
    hasTelegramBotToken: !!stored.telegramBotToken,
    telegramChatId: stored.telegramChatId,
    enabled: stored.enabled,
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">НАЛАШТУВАННЯ СЕРВІСУ</p>
          <h1>Підключення</h1>
          <p className="muted">Параметри зв’язку із KeepinCRM та активація сервісу.</p>
        </div>
        <span className={`badge ${stored.enabled ? 'active' : 'probe'}`}>
          <span className="status-dot" />
          {stored.enabled ? 'Інтеграція активна' : 'Режим перевірки'}
        </span>
      </div>
      <SettingsForm initial={initial} />
      <section className="panel">
        <div className="section-padding section-header-actions">
          <div>
            <h2>Налаштування webhooks у KeepinCRM</h2>
            <p className="muted">Покрокова інструкція та шаблони для двох тригерів.</p>
          </div>
          <Link className="button secondary" href="/admin/settings/webhooks">
            Налаштувати webhooks
          </Link>
        </div>
      </section>
    </>
  );
}
