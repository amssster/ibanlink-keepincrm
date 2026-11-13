import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'IBAN Link · для KeepinCRM',
  description: 'Платіжні посилання на IBAN прямо з угод KeepinCRM',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
