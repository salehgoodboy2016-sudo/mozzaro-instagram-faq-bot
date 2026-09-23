# WhatsApp PostgreSQL production requirements

The WhatsApp webhook can receive and validate events without a database, but
automation must remain disabled until durable storage is connected.

## Required Render configuration

- PostgreSQL 13 or newer in the same Render region as the web service (currently Ohio).
- `WHATSAPP_DATABASE_URL`: the Render **internal** database URL. Do not use or log the external URL from the web service.
- `WHATSAPP_IDENTITY_KEY`: at least 32 random bytes, stored only as a Render secret. It must remain stable because it creates one-way conversation IDs.
- Maximum application pool size is 5 connections. One additional connection is used briefly by the standalone migration command.
- Minimum schema storage is small; allow growth for one row per webhook event. Add a retention policy before event volume becomes material.

Render's current free PostgreSQL plan has 1 GB and expires after 30 days. It is
appropriate for a migration/integration rehearsal, not durable production.

## Migrations

Run `pnpm db:migrate` with `WHATSAPP_DATABASE_URL` configured. Startup also runs
the same idempotent migrations before opening the HTTP listener. A PostgreSQL
advisory lock prevents concurrent service instances from applying migrations at
the same time. Applied filenames are recorded in `schema_migrations`.

Migration `001_whatsapp_state.sql` creates:

- `whatsapp_events`, keyed by Meta event ID for persistent retry deduplication.
- `whatsapp_conversations`, keyed by an HMAC identifier for human handoff and
  employee/customer activity ordering. It stores no phone number or message text.

Connecting the database does not enable replies. These must remain false until
Coexistence is completed and separately approved:

- `WHATSAPP_AUTO_REPLY_ENABLED=false`
- `WHATSAPP_LIVE_SEND_APPROVED=false`
- `WHATSAPP_COEXISTENCE_VERIFIED=false`
- `WHATSAPP_EMPLOYEE_ECHO_VERIFIED=false`

