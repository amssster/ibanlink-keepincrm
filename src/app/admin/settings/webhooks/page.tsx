import Link from 'next/link';
import { requireOwner } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { appUrl } from '@/lib/env';
import { CopyButton, MaskedSecret } from '@/components/actions';

const issueTemplate = {
  event_id: 'issue:{{id}}:{{updated_at}}',
  deal_id: '{{id}}',
  event_at: '{{updated_at}}',
  total: '{{total}}',
  paid: '{{paid}}',
  currency: 'UAH',
  stage: '{{stage.name}}',
  recipient_key: '{{<змінна поля>}}',
};

const paymentTemplate = {
  event_id: 'payment:{{id}}',
  payment_id: '{{id}}',
  deal_id: '{{parent.id}}',
  event_at: '{{created_at}}',
  total: '{{parent.total}}',
  paid: '{{parent.paid}}',
  currency: '{{currency}}',
  kind: '{{kind}}',
  planned: '{{planned}}',
};

export default async function WebhooksPage() {
  await requireOwner();
  const stored = await getSettings();
  const webhooks = [
    {
      kind: 'issue' as const,
      title: 'Створення посилання',
      table: 'Угоди',
      condition: `stage.name == '${stored.stage}'`,
      secretName: 'WEBHOOK_ISSUE_SECRET',
      secretValue: process.env.WEBHOOK_ISSUE_SECRET ?? '',
      template: issueTemplate,
    },
    {
      kind: 'payment' as const,
      title: 'Проведення платежу',
      table: 'Фінанси',
      condition: 'created_at',
      secretName: 'WEBHOOK_PAYMENT_SECRET',
      secretValue: process.env.WEBHOOK_PAYMENT_SECRET ?? '',
      template: paymentTemplate,
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">НАЛАШТУВАННЯ СЕРВІСУ</p>
          <h1>Налаштуйте webhooks у KeepinCRM</h1>
          <p className="muted">Два вихідні тригери передають дані угод і платежів до сервісу.</p>
        </div>
        <Link className="button secondary" href="/admin/settings">
          Повернутися до підключення
        </Link>
      </div>
      <section className="panel integration-guide">
        <div className="section-padding stack">
          <h2>1. Підготуйте поля</h2>
          <p>Для вихідних webhook потрібен розширений тариф KeepinCRM. У налаштуваннях користувацьких полів угод створіть поле «{stored.field}» типу текст або посилання та поле «Отримувач платежу» типу список. Значення списку мають точно збігатися з ключами отримувачів у кабінеті, включно з регістром і пробілами.</p>
          <p>Збережіть налаштування сервісу з вимкненою інтеграцією. API-ключ KeepinCRM не потрібен.</p>
          <h2>2. Створіть вихідні тригери</h2>
          <p>У KeepinCRM відкрийте «Налаштування → Тригери → Додати тригер» та додайте два тригери. Для кожного виберіть дію Webhook, метод POST, Content-Type application/json, успішний статус 200 і метод запуску «Відразу». Скопіюйте відповідний URL і JSON-шаблон нижче. У заголовку Authorization вкажіть Bearer та відповідний секрет із .env; використовуйте різні секрети.</p>
          {webhooks.map((item) => {
            const bearer = item.secretValue ? `Bearer ${item.secretValue}` : '';
            return (
              <div className="webhook-example" key={item.kind}>
                <h3>{item.title}</h3>
                <p>Таблиця з даними: <strong>{item.table}</strong></p>
                <p>Умова виконання: <code>{item.condition}</code></p>
                <p>URL вебхука:</p>
                <div className="code-line">
                  <code>{appUrl()}/api/webhooks/keepincrm/{item.kind}</code>
                  <CopyButton value={`${appUrl()}/api/webhooks/keepincrm/${item.kind}`} small />
                </div>
                <p>Заголовок: <code>Authorization</code> (Bearer токен):</p>
                <MaskedSecret
                  value={bearer}
                  placeholder={`Bearer <${item.secretName}>`}
                  copyLabel="Копіювати заголовок"
                />
                <pre>{JSON.stringify(item.template, null, 2)}</pre>
                <CopyButton value={JSON.stringify(item.template, null, 2)} label="Копіювати шаблон JSON" />
                {item.kind === 'issue' ? (
                  <p>Замініть <code>{'{{<змінна поля>}}'}</code> на системну змінну поля «Отримувач платежу» зі списку редактора тригера. Для користувацьких полів KeepinCRM використовує префікс <code>custom_fields.</code> і системну назву поля зі списку змінних. Залиште <code>{'{{updated_at}}'}</code> у event_id і валюту UAH. У блоці «Успішна відповідь (Response)» натисніть «Додати», виберіть поле «{stored.field}» і вкажіть JSON path <code>$.payment_url</code>.</p>
                ) : (
                  <p>Залиште Response порожнім. <code>{'{{parent.paid}}'}</code> має передавати накопичену суму оплат за угодою. Створюйте фактичні вхідні платежі одразу проведеними: зміна запланованого платежу на проведений не запускає тригер створення повторно. Перевірте системні змінні у вашій CRM.</p>
                )}
              </div>
            );
          })}
          <p>У полі умови вводьте лише системний вираз, без пояснювального тексту. Якщо назва етапу містить апостроф, перевірте допустимий синтаксис умови в KeepinCRM. Порожній або невідомий ключ отримувача не створює посилання. Для платежу використовуйте окремий секрет і фактичну валюту; сервіс підтримує лише UAH.</p>
          <p>Якщо умову відхилено, перевірте синтаксис. У разі HTTP 401 перевірте секрет у заголовку; якщо посилання не з’явилося — ключ отримувача і журнал «Події». За HTTP 409 перевірте timestamp у event_id, залишок, стан угоди та отримувача. Час event_at має бути у форматі ISO 8601 з часовим поясом, наприклад 2026-11-09T10:20:00+02:00; перевірте формат змінних у тестових подіях.</p>
          <h2>3. Перевірте й активуйте</h2>
          <p>Створіть тестову угоду, виберіть отримувача та переведіть її на етап оплати. У розділі «Події» перевірте подію issue зі статусом «Перевірка контракту» та тестовий URL із шляхом /integration-check у полі угоди. Створіть у цій угоді проведений вхідний платіж. У розділі «Події» перевірте подію payment: сума угоди має збігатися, оплачена сума — збільшитися, час платежу — бути не раніше події issue. В історії запиту KeepinCRM перевірте kind — debit, planned — false, валюту — UAH. Після успішної перевірки поверніться до підключення, підтвердьте перевірку й увімкніть інтеграцію. Тестові події не створюють платіжних посилань.</p>
          <p>Оплату перевіряє менеджер або бухгалтер за банківською випискою; сервіс не перевіряє надходження автоматично.</p>
          <p>Документація KeepinCRM: <a href="https://keepincrm.com/send-from-deals" target="_blank" rel="noopener noreferrer">вихідний webhook для угод</a> та <a href="https://keepincrm.com/send-from-finances" target="_blank" rel="noopener noreferrer">для фінансів</a>.</p>
        </div>
      </section>
    </>
  );
}
