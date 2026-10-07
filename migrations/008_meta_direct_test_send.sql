CREATE TABLE meta_campaign_test_sends (
  request_id text PRIMARY KEY,
  provider text NOT NULL CHECK (provider = 'meta_direct'),
  recipient_e164 text NOT NULL,
  template_name text NOT NULL,
  status text NOT NULL CHECK (status IN
    ('reserved','preflight_failed','accepted','sent','delivered','read','failed','ambiguous')),
  provider_message_id text UNIQUE,
  error_code text,
  error_category text,
  preflight jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
