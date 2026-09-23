CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  conversation_id text PRIMARY KEY,
  human_active boolean NOT NULL DEFAULT false,
  handoff_reason text,
  last_employee_at timestamptz,
  latest_customer_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_events (
  event_id text PRIMARY KEY,
  conversation_id text,
  event_type text NOT NULL,
  outcome text NOT NULL,
  event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_events_recent
  ON whatsapp_events (created_at DESC);

