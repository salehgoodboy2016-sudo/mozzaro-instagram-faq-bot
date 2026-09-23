CREATE TABLE IF NOT EXISTS whatsapp_ai_context (
  conversation_id text PRIMARY KEY REFERENCES whatsapp_conversations(conversation_id) ON DELETE CASCADE,
  turns jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_ai_calls (
  event_id text PRIMARY KEY REFERENCES whatsapp_events(event_id) ON DELETE CASCADE,
  month date NOT NULL,
  reserved_usd numeric(12,6) NOT NULL,
  actual_usd numeric(12,6),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_ai_budget (
  month date PRIMARY KEY,
  reserved_usd numeric(12,6) NOT NULL DEFAULT 0,
  spent_usd numeric(12,6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS whatsapp_ai_calls_month ON whatsapp_ai_calls(month);
