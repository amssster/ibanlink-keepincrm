'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Link2, Activity, Users, SlidersHorizontal } from 'lucide-react';
const items = [
  { href: '/admin', label: 'Огляд', Icon: LayoutDashboard },
  { href: '/admin/links', label: 'Посилання', Icon: Link2 },
  { href: '/admin/events', label: 'Події', Icon: Activity },
  { href: '/admin/recipients', label: 'Отримувачі', Icon: Users },
  { href: '/admin/settings', label: 'Підключення', Icon: SlidersHorizontal },
];
export function Navigation() {
  const path = usePathname();
  return (
    <nav aria-label="Кабінет">
      {items.map(({ href, label, Icon }) => {
        const active = path === href || (href !== '/admin' && path.startsWith(`${href}/`));
        return (
          <Link
            className={`nav-item ${active ? 'selected' : ''}`}
            href={href}
            key={href}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={19} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
