import { CheckCircle2 } from 'lucide-react';
export default function IntegrationCheck() {
  return (
    <main className="closed-shell">
      <section className="closed-card">
        <CheckCircle2 size={48} className="closed-icon" />
        <h1>Перевірка інтеграції</h1>
        <p>Це тестове посилання. Оплата за ним недоступна.</p>
        <p>
          Якщо ви відкрили цю сторінку з поля угоди KeepinCRM, запис відповіді webhook через
          Response налаштовано. Перевірте також суми й подію проведення платежу перед активацією.
        </p>
      </section>
    </main>
  );
}
