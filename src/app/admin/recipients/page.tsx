import { requireOwner } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { RecipientsManager } from '@/components/recipients-manager';

export default async function RecipientsPage() {
  await requireOwner();
  const settings = await getSettings();

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">КЕРУВАННЯ ОТРИМУВАЧАМИ</p>
          <h1>Отримувачі платежу</h1>
          <p className="muted">
            Налаштуйте реквізити ваших ФОП або ТОВ. Ключ кожного отримувача копіюється у випадаючий
            список угоди CRM.
          </p>
        </div>
      </div>
      <RecipientsManager initial={settings.recipients} />
    </>
  );
}
