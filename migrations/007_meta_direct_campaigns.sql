ALTER TABLE marketing_campaigns
  ADD COLUMN provider text NOT NULL DEFAULT 'kapso'
    CHECK (provider IN ('kapso','meta_direct'));

ALTER TABLE marketing_campaign_recipients
  ADD COLUMN provider text NOT NULL DEFAULT 'kapso'
    CHECK (provider IN ('kapso','meta_direct')),
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN failed_at timestamptz,
  ADD COLUMN error_code text,
  ADD COLUMN error_detail_safe text;

CREATE INDEX marketing_campaign_recipients_provider_message_idx
  ON marketing_campaign_recipients(provider,provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE marketing_campaign_batches (
  batch_id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES marketing_campaigns(campaign_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'meta_direct'),
  status text NOT NULL CHECK (status IN ('reserved_disabled','cancelled')),
  requested_count integer NOT NULL CHECK (requested_count > 0),
  reserved_count integer NOT NULL CHECK (reserved_count >= 0),
  limit_unique integer NOT NULL CHECK (limit_unique > 0),
  used_unique integer NOT NULL CHECK (used_unique >= 0),
  available_unique integer NOT NULL CHECK (available_unique >= 0),
  capacity_observed_at timestamptz NOT NULL,
  capacity_source text NOT NULL,
  owner_authorization_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_campaign_batch_recipients (
  batch_id text NOT NULL REFERENCES marketing_campaign_batches(batch_id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  contact_id text NOT NULL,
  selection_order integer NOT NULL CHECK (selection_order > 0),
  PRIMARY KEY (batch_id,contact_id),
  UNIQUE (batch_id,selection_order),
  FOREIGN KEY (campaign_id,contact_id)
    REFERENCES marketing_campaign_recipients(campaign_id,contact_id) ON DELETE CASCADE
);
