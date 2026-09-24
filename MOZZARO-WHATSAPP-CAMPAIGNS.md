# Mozzaro WhatsApp Campaigns

The owner dashboard is available at `/admin/campaigns`. It asks for the existing
`MOZZARO_ADMIN_API_TOKEN` and keeps that token only in the current page memory.
It is never placed in the URL or browser storage.

Phase 2 deliberately has no send endpoint or background sender. Campaign approval
and scheduling are database records for review only. The database also enforces
`sending_enabled = false` for every campaign.

## Customer import

Upload a `.csv` or `.xlsx` file no larger than 5 MB. Accepted column names include:

- `phone`
- `name`
- `consent_status`
- `consent_source`
- `consent_at`
- `consent_evidence`

A row is eligible only when the Saudi mobile number is valid, consent is affirmative,
and its source, timestamp, and evidence are present. Numbers are normalized to
`9665XXXXXXXX`, duplicates are removed, and a permanent suppression always wins over
a later import.

## Templates and costs

The sync action makes a read-only request to Kapso for approved `MARKETING` templates.
It does not create or submit a template. A campaign draft snapshots eligible contacts
and their latest documented opt-in and uses `WHATSAPP_MARKETING_RATE_USD` for the cost
estimate. This is an estimate only; the owner must refresh the official Meta rate before
any future sending phase.

Kapso's public API used by this project does not expose account credit or exact monthly
allowance usage. The dashboard therefore identifies those values as unavailable rather
than inventing them and directs the owner to the Kapso billing screen.
