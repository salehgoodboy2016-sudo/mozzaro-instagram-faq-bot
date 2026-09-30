ALTER TABLE marketing_contact_profiles
  ADD COLUMN last_visit timestamptz,
  ADD COLUMN campaign_selection_rank integer,
  ADD COLUMN bonat_row_order integer,
  ADD CONSTRAINT marketing_contact_profiles_selection_rank_positive
    CHECK (campaign_selection_rank IS NULL OR campaign_selection_rank > 0),
  ADD CONSTRAINT marketing_contact_profiles_bonat_row_positive
    CHECK (bonat_row_order IS NULL OR bonat_row_order > 0);

ALTER TABLE marketing_campaign_recipients
  ADD COLUMN selection_rank integer,
  ADD CONSTRAINT marketing_campaign_recipients_selection_rank_positive
    CHECK (selection_rank IS NULL OR selection_rank > 0);

CREATE UNIQUE INDEX marketing_contact_profiles_selection_rank_unique
  ON marketing_contact_profiles(campaign_selection_rank)
  WHERE campaign_selection_rank IS NOT NULL;

CREATE UNIQUE INDEX marketing_campaign_recipient_rank_unique
  ON marketing_campaign_recipients(campaign_id,selection_rank)
  WHERE selection_rank IS NOT NULL;
