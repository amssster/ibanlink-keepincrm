import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { LoginForm } from '@/components/login-form';
import { isOwner } from '@/lib/auth';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  let authenticated = false;
  try {
    authenticated = await isOwner();
  } catch {
    authenticated = false;
  }
  if (authenticated) redirect('/admin');
  const message =
    error === 'credentials'
      ? 'Неправильний пароль'
      : error === 'rate'
        ? 'Забагато спроб. Спробуйте через 15 хвилин.'
        : error === 'request'
          ? 'Некоректний запит'
          : '';
  return (
    <main className="login-shell">
      <div className="login-card">
        <Brand />
        <p className="eyebrow">КАБІНЕТ ВЛАСНИКА</p>
        <h1>
          Ваші оплати.
          <br />
          Усе під контролем.
        </h1>
        <p className="muted login-intro">
          Платіжні посилання та інтеграція з KeepinCRM в одному місці.
        </p>
        {message && (
          <p className="notice error" role="alert">
            {message}
          </p>
        )}
        <LoginForm />
        <p className="login-footer">Закритий доступ · тільки для вашого бізнесу</p>
        <p className="login-footer"><a href="https://ibanlink.online">Зв’язок і технічна підтримка</a></p>
      </div>
      <div className="login-aside" aria-hidden="true">
        <div className="login-illustration">
          <div className="login-preview-head"><span>IBAN Link</span><span>Огляд оплат</span></div>
          <div className="login-preview-body"><span className="login-preview-label">ПЛАТІЖНЕ ПОСИЛАННЯ</span><strong>Оплата за замовлення</strong><div className="login-preview-amount">2 450,00 ₴</div><div className="login-preview-row"><span>Отримувач</span><b>ФОП Петренко</b></div><div className="login-preview-row"><span>Призначення</span><b>Замовлення №104</b></div><div className="login-preview-status">● &nbsp; Очікує оплати</div></div>
        </div>
        <div className="aside-note">
          <span className="eyebrow">ВІД УГОДИ — ДО ОПЛАТИ</span>
          <p>
            Від угоди до оплати.
            <br />
            <em>Усе в одному місці.</em>
          </p>
          <span>Одне посилання. Зручний переказ на IBAN.</span>
        </div>
      </div>
    </main>
  );
}
