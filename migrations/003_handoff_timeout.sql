ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS handoff_protected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS whatsapp_conversations_expired_handoffs
  ON whatsapp_conversations (handoff_expires_at)
  WHERE human_active = true AND handoff_protected = false;

CREATE TABLE IF NOT EXISTS whatsapp_pending_messages (
  conversation_id text PRIMARY KEY REFERENCES whatsapp_conversations(conversation_id) ON DELETE CASCADE,
  event_id text NOT NULL UNIQUE REFERENCES whatsapp_events(event_id) ON DELETE CASCADE,
  sender text NOT NULL,
  message_text text NOT NULL DEFAULT '',
  message_type text NOT NULL DEFAULT 'text',
  event_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing')),
  claimed_at timestamptz,
  queued_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_pending_messages_status ON whatsapp_pending_messages (status, queued_at);
