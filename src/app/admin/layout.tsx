import { requireOwner } from '@/lib/auth';
import { Brand } from '@/components/brand';
import { Navigation } from '@/components/navigation';
import { ExternalLink, LogOut, ShieldCheck } from 'lucide-react';
export const dynamic = 'force-dynamic';
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">ВАШ РОБОЧИЙ ПРОСТІР</div>
          <Navigation />
          <form action="/api/auth/logout" method="POST" className="mobile-logout">
            <button className="icon-button" aria-label="Вийти" title="Вийти">
              <LogOut size={18} />
            </button>
          </form>
          <div className="sidebar-bottom">
          <div className="worker-state">
            <span>Стан сервісу не перевіряється</span>
          </div>
          <a href="https://ibanlink.online" className="nav-item">
            <ExternalLink size={18} />
            На сайт
          </a>
          <div className="owner-row">
            <span className="avatar">В</span>
            <div>
              <strong>Власник</strong>
              <small>Повний доступ</small>
            </div>
            <form action="/api/auth/logout" method="POST">
              <button className="icon-button" aria-label="Вийти" title="Вийти">
                <LogOut size={18} />
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="admin-main">
        <header className="topbar">
          <span>Платежі за реквізитами</span>
          <span className="topbar-security">
            <ShieldCheck size={15} />
            Закритий кабінет
          </span>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
