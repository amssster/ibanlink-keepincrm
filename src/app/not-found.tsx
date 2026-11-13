import { CircleAlert } from 'lucide-react';
export default function NotFound() {
  return (
    <main className="closed-shell">
      <section className="closed-card">
        <CircleAlert size={45} className="closed-icon" />
        <h1>Посилання не знайдено</h1>
        <p>Перевірте адресу або зверніться до продавця за новим посиланням.</p>
      </section>
    </main>
  );
}
