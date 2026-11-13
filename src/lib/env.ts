export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не налаштовано ${name}`);
  return value;
}
export function appUrl(): string {
  const raw =
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);
  if (!raw) throw new Error('Не налаштовано APP_URL');
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('APP_URL повинен бути origin без шляху');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
  )
    throw new Error('APP_URL потребує HTTPS');
  return url.origin;
}
