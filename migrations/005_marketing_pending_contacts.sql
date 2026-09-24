ALTER TABLE marketing_imports
  ADD COLUMN pending_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN imported_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN opted_out_rows integer NOT NULL DEFAULT 0;

CREATE TABLE marketing_contact_profiles (
  contact_id text PRIMARY KEY REFERENCES marketing_contacts(contact_id) ON DELETE CASCADE,
  source text NOT NULL,
  registered_at timestamptz,
  visits integer,
  loyalty_points numeric(14,2),
  segment text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (visits IS NULL OR visits >= 0),
  CHECK (loyalty_points IS NULL OR loyalty_points >= 0)
);

