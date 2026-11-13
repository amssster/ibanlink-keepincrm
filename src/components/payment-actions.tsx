'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Info } from 'lucide-react';
export function PaymentActions(props: {
  token: string;
  embedded: boolean;
  ios: boolean;
}) {
  const { token, embedded } = props;
  const router = useRouter(),
    [hint, setHint] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <div className="payment-actions">
      <p className="payment-section-label">Оберіть, як вам зручно оплатити</p>
      <div className="bank-buttons">
        <a
          className="bank-button mono"
          href={`/api/pay/${token}/open?bank=mono`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setHint(true)}
        >
          <span className="bank-monogram">m</span>
          <span>Monobank</span>
          <ArrowUpRight size={20} />
        </a>
        <a
          className="bank-button privat"
          href={`/api/pay/${token}/open?bank=privat`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setHint(true)}
        >
          <span className="privat-monogram">П</span>
          <span>Приват24</span>
          <ArrowUpRight size={20} />
        </a>
      </div>
      {(embedded || hint) && (
        <div className="notice">
          <Info size={18} />
          <span>
            Банк не відкрився? У меню Viber або Telegram оберіть «Відкрити у браузері». Або
            скопіюйте реквізити й відкрийте банківський застосунок самостійно.
          </span>
        </div>
      )}
      <p className="payment-caption">Перевірте отримувача та суму в банку перед підтвердженням.</p>
    </div>
  );
}
