CREATE TABLE IF NOT EXISTS settings (
  id boolean PRIMARY KEY DEFAULT true CHECK(id), data jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS inbox (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('issue','payment')), event_id text NOT NULL,
  deal_id text NOT NULL, event_at timestamptz NOT NULL, payload jsonb NOT NULL, payload_hash text NOT NULL,
  status text NOT NULL CHECK(status IN ('probe','queued','processed','failed','skipped')),
  result text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,event_id)
);
CREATE INDEX IF NOT EXISTS inbox_recent ON inbox(created_at DESC);
CREATE INDEX IF NOT EXISTS inbox_deal_pending ON inbox(deal_id,kind,status,event_at DESC);
CREATE TABLE IF NOT EXISTS deals (
  id text PRIMARY KEY, last_event_at timestamptz, link_id uuid
);
CREATE TABLE IF NOT EXISTS links (
  id uuid PRIMARY KEY, token text UNIQUE NOT NULL, deal_id text NOT NULL REFERENCES deals(id),
  amount_minor bigint NOT NULL CHECK(amount_minor>0), recipient jsonb NOT NULL, purpose text NOT NULL,
  fingerprint text NOT NULL, status text NOT NULL CHECK(status IN ('active','paid','partial','replaced','disabled')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz, source_event_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS links_recent ON links(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS links_one_active ON links(deal_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('event','sync','notify')), ref_id uuid NOT NULL, deal_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','done','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz, lease_id uuid, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind,ref_id)
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status,available_at);
CREATE TABLE IF NOT EXISTS login_attempts (bucket text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id bigserial PRIMARY KEY, action text NOT NULL, target text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE inbox ADD COLUMN IF NOT EXISTS config_version text NOT NULL DEFAULT '';
ALTER TABLE links ADD COLUMN IF NOT EXISTS config_version text NOT NULL DEFAULT '';
-- Розширення jobs.kind на 'notify' для існуючих таблиць
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('event','sync','notify'));
-- Міграція recipients та linkTtlDays
UPDATE settings
SET data = (data - 'recipient' - 'purposeTemplate') || jsonb_build_object(
  'recipients', jsonb_build_array(
    jsonb_build_object(
      'key', 'Основний',
      'name', COALESCE(data->'recipient'->>'name', ''),
      'brand', COALESCE(data->'recipient'->>'brand', 'Мій магазин'),
      'iban', COALESCE(data->'recipient'->>'iban', ''),
      'taxId', COALESCE(data->'recipient'->>'taxId', ''),
      'purposeTemplate', COALESCE(data->>'purposeTemplate', 'Оплата за замовлення №{deal_id}')
    )
  ),
  'linkTtlDays', COALESCE((data->>'linkTtlDays')::int, 7)
)
WHERE data ? 'recipient' AND NOT data ? 'recipients';
-- Бекфілл знімків: усім links.recipient без key дописати key:'Основний'
UPDATE links
SET recipient = recipient || jsonb_build_object('key', 'Основний')
WHERE status = 'active' AND created_at >= now() - interval '2 days' AND NOT (recipient ? 'key');

CREATE INDEX IF NOT EXISTS links_deal_id_pattern ON links(deal_id text_pattern_ops);
CREATE INDEX IF NOT EXISTS links_status_created ON links(status, created_at DESC);
CREATE INDEX IF NOT EXISTS links_active_expires ON links(expires_at) WHERE status='active';
CREATE INDEX IF NOT EXISTS inbox_deal_id ON inbox(deal_id text_pattern_ops);

CREATE TABLE IF NOT EXISTS recipient_logos (
  key text PRIMARY KEY,
  data text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO recipient_logos(key, data)
SELECT
  rec->>'key' AS key,
  rec->>'logo' AS data
FROM settings s,
jsonb_array_elements(s.data->'recipients') AS rec
WHERE rec ? 'logo' AND rec->>'logo' LIKE 'data:image/%'
ON CONFLICT (key) DO NOTHING;
