import { required } from './env';
/** Два незалежні секрети вхідних запитів. Доступу до API KeepinCRM немає. */
export function webhookSecret(kind: 'issue' | 'payment'): string {
  return required(kind === 'issue' ? 'WEBHOOK_ISSUE_SECRET' : 'WEBHOOK_PAYMENT_SECRET');
}
