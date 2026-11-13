# IBAN Link — Security Policy

## Scope and deployment

IBAN Link is a self-hosted, single-tenant application. In the standard `compose.yaml`, Caddy publishes ports 80 and 443; `web`, PgBouncer and PostgreSQL have no published host ports. The local development override publishes PostgreSQL on loopback and may publish `web` on loopback. Coolify and Vercel have different networking and access controls; configure those separately.

The application image runs as `node`; `web` and `migrate` use `no-new-privileges`. Other service images have their own users and settings. The Docker build copies the build context into an intermediate stage: inspect `.dockerignore` and exclude sensitive local files from the context before building.

Webhook secrets and session signatures use `crypto.timingSafeEqual` after a length check. Owner passwords can be stored as scrypt hashes. Owner mutations check the request origin against `APP_URL`. These controls do not replace HTTPS, restricted server access, dependency updates or infrastructure monitoring.

## Login and sessions

Login uses one shared database counter for the owner: after ten attempts within a 15-minute window, subsequent attempts are rejected until the window expires. Successful login resets the counter. The counter is not per IP, so an attacker can temporarily lock out the owner. Restrict access at the proxy or network layer if appropriate.

Session cookies are signed and expire after eight hours. A successful logout records a hash of the presented session in the database and removes the cookie; authorization rejects that revoked session. Requests already authorized before logout may still complete. Revocation records accumulate in `login_attempts` and are not removed automatically; monitor database growth. Other sessions remain valid. Changing `SESSION_SECRET` invalidates all existing sessions. Protect the database and secret, and do not assume password changes alone revoke active sessions.

## Backups and secrets

Never commit production `.env` files or credentials. Generate secrets with `npm run secrets -- --write`; the password prompt is visible in the terminal. Restrict access to the resulting file and deployment settings.

The backup script restricts file permissions but does not encrypt PostgreSQL dumps. Dumps may contain personal data and Telegram credentials. Restrict access, encrypt copies stored elsewhere and periodically test restoration. `ops/restore-check.sh` restores into a temporary database on the same PostgreSQL server and checks row counts in three tables; it does not verify every record or restore production. Restoring an older backup can also restore older session-revocation state. See [README.md](README.md) for operational guidance.

## Reporting a vulnerability

Do not publish suspected vulnerabilities in public issues. If private vulnerability reporting is enabled for the GitHub repository, use its Security tab to submit a private advisory.
