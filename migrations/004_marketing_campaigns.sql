CREATE TABLE marketing_contacts (
  contact_id text PRIMARY KEY,
  phone_e164 text NOT NULL UNIQUE,
  display_name text,
  consent_status text NOT NULL CHECK (consent_status IN ('opted_in','opted_out','unknown')),
  consent_source text,
  consent_at timestamptz,
  consent_evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (consent_status <> 'opted_in' OR
    (consent_source IS NOT NULL AND consent_at IS NOT NULL AND consent_evidence IS NOT NULL))
);

CREATE TABLE marketing_consent_events (
  consent_event_id text PRIMARY KEY,
  contact_id text NOT NULL REFERENCES marketing_contacts(contact_id),
  consent_status text NOT NULL CHECK (consent_status IN ('opted_in','opted_out')),
  source text NOT NULL,
  evidence text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_suppressions (
  phone_e164 text PRIMARY KEY,
  reason text NOT NULL,
  source text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_imports (
  import_id text PRIMARY KEY,
  filename text NOT NULL,
  file_sha256 text NOT NULL,
  total_rows integer NOT NULL,
  accepted_rows integer NOT NULL,
  rejected_rows integer NOT NULL,
  duplicate_rows integer NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_templates (
  template_id text PRIMARY KEY,
  name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  quality_rating text,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_campaigns (
  campaign_id text PRIMARY KEY,
  name text NOT NULL,
  template_id text REFERENCES marketing_templates(template_id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','approved','scheduled_disabled','cancelled','completed','failed')),
  scheduled_at timestamptz,
  rate_usd numeric(12,6) NOT NULL,
  eligible_recipient_count integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(12,4) NOT NULL DEFAULT 0,
  owner_approved_at timestamptz,
  owner_approval_digest text,
  sending_enabled boolean NOT NULL DEFAULT false CHECK (sending_enabled = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_campaign_recipients (
  campaign_id text NOT NULL REFERENCES marketing_campaigns(campaign_id) ON DELETE CASCADE,
  contact_id text NOT NULL REFERENCES marketing_contacts(contact_id),
  consent_event_id text NOT NULL REFERENCES marketing_consent_events(consent_event_id),
  status text NOT NULL DEFAULT 'eligible' CHECK (status IN
    ('eligible','suppressed','sent','delivered','read','replied','failed')),
  estimated_cost_usd numeric(12,6) NOT NULL,
  provider_message_id text,
  error_category text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  PRIMARY KEY (campaign_id, contact_id)
);

CREATE TABLE marketing_campaign_events (
  event_id text PRIMARY KEY,
  campaign_id text NOT NULL REFERENCES marketing_campaigns(campaign_id) ON DELETE CASCADE,
  contact_id text REFERENCES marketing_contacts(contact_id),
  event_type text NOT NULL,
  provider_event_id text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX marketing_contacts_consent_idx ON marketing_contacts(consent_status);
CREATE INDEX marketing_campaigns_created_idx ON marketing_campaigns(created_at DESC);
CREATE INDEX marketing_campaign_recipients_status_idx ON marketing_campaign_recipients(campaign_id, status);
