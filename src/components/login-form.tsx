'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, LockKeyhole } from 'lucide-react';
export function LoginForm() {
  const router = useRouter(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.get('password') }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      router.replace('/admin');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Сервіс тимчасово недоступний');
      setBusy(false);
    }
  }
  return (
    <form method="POST" action="/api/auth/login" onSubmit={submit} className="stack">
      <label>
        Пароль
        <span className="input-icon">
          <LockKeyhole size={17} />
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
          />
        </span>
      </label>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" disabled={busy}>
        {busy ? 'Входимо…' : 'Увійти до кабінету'}
        <ArrowRight size={18} />
      </button>
    </form>
  );
}
