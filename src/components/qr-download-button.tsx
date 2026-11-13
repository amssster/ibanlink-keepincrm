'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';

interface QrDownloadButtonProps {
  token: string;
  dealId: string;
  className?: string;
  label?: string;
  iconSize?: number;
}

export function QrDownloadButton({
  token,
  dealId,
  className = 'qr-download-link',
  label = 'Завантажити QR (PNG)',
  iconSize = 14,
}: QrDownloadButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const downloadPng = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    let svgUrl: string | null = null;
    let pngUrl: string | null = null;
    try {
      const res = await fetch(`/api/pay/${token}/qr`);
      if (!res.ok) throw new Error('Помилка отримання QR');
      const svgText = await res.text();
      const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
      svgUrl = URL.createObjectURL(blob);
      const img = new Image();

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = svgUrl!;
      });

      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 1000;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Не вдалося створити контекст canvas');

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1000, 1000);
      ctx.drawImage(img, 0, 0, 1000, 1000);

      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!pngBlob) throw new Error('Не вдалося створити PNG blob');

      pngUrl = URL.createObjectURL(pngBlob);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `qr-угода-${dealId}.png`;
      document.body.appendChild(a);
      try {
        a.click();
      } finally {
        a.remove();
      }
    } catch {
      setError('Не вдалося завантажити QR-код');
    } finally {
      if (svgUrl) URL.revokeObjectURL(svgUrl);
      if (pngUrl) URL.revokeObjectURL(pngUrl);
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={downloadPng}
        disabled={loading}
        aria-busy={loading}
      >
        <Download size={iconSize} />
        {loading ? 'Завантаження…' : label}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
