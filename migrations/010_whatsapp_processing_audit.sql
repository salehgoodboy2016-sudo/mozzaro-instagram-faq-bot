CREATE TABLE IF NOT EXISTS whatsapp_processing_audit (
  id bigserial PRIMARY KEY,
  event_id text NOT NULL REFERENCES whatsapp_events(event_id),
  conversation_id text,
  from_outcome text NOT NULL,
  to_outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_processing_audit_event
  ON whatsapp_processing_audit(event_id,created_at);
