# Kapso integration status

Kapso is the selected provider for the next WhatsApp integration. The previous
direct Meta webhook remains available at `/webhooks/whatsapp`, but its outbound
automation stays disabled and it is not part of the Kapso onboarding flow.

## Safe onboarding path

For `+966565017314`, use only **Connected numbers → Connect new number →
WhatsApp Business App** in Kapso. This is Kapso's Coexistence flow. It opens
Meta Embedded Signup, pairs the existing WhatsApp Business App through a QR
code, and preserves the primary mobile application.

Stop if Meta asks for SMS or voice verification instead of Business App
pairing. Do not select **Bring your own SIM**, **Display name only**, standard
Cloud API registration, or a migration flow. The final Meta confirmation grants
Kapso access to the selected Business Portfolio and WhatsApp assets, so it must
be reviewed and approved by the account owner.

Kapso documents these Coexistence limitations: occasional disconnects, some
WhatsApp Web/contact-name sync problems, possible delay for a first inbound
message, and no calling through Kapso. Calls remain available in the Business
App. Production automation must account for those limitations.

## Implemented, disabled by default

- `POST /webhooks/kapso` accepts Kapso v2 phone-number webhook events.
- Raw-body HMAC-SHA256 validation uses `X-Webhook-Signature`.
- `X-Idempotency-Key` and WhatsApp message IDs feed the existing PostgreSQL
  deduplication store.
- Incoming messages reuse the existing Saudi Arabic FAQ and complaint rules.
- `whatsapp.message.sent` events with `message.kapso.origin=business_app` mark
  the conversation as handled by an employee and suppress automation.
- Outbound text uses Kapso's WhatsApp proxy with `X-API-Key`, but the transport
  cannot send unless every activation flag below is true.
- Logs contain event names and aggregate counts only. They exclude message
  contents, customer identifiers, phone numbers, webhook secrets, and API keys.

The centralized business facts are in `src/mozzaro-knowledge.mjs`.

## Render variables

Configure these only after the Kapso project exists. Never commit their values:

- `KAPSO_WEBHOOK_SECRET`
- `KAPSO_API_KEY`
- `KAPSO_PHONE_NUMBER_ID`
- `KAPSO_WHATSAPP_API_VERSION=v24.0`

Keep all activation controls false until Coexistence, employee-message echoes,
and a sandbox test have been verified and live replies are separately approved:

- `WHATSAPP_AUTOMATION_ENABLED=false`
- `KAPSO_AUTO_REPLY_ENABLED=false`
- `KAPSO_LIVE_SEND_APPROVED=false`
- `KAPSO_COEXISTENCE_VERIFIED=false`
- `KAPSO_EMPLOYEE_ECHO_VERIFIED=false`

The production callback will be:

`https://mozzaro-instagram-faq-bot.onrender.com/webhooks/kapso`

Subscribe the phone-number webhook to `whatsapp.message.received` and
`whatsapp.message.sent`. Do not enable buffering for the first diagnostic test;
the endpoint supports both unbuffered and buffered payloads.

## Pricing checked 24 September 2026

Kapso Free is `$0/month`, includes 2,000 inbound and outbound messages per
month, one connected number, one sandbox number, and 1 GB media storage. Meta
message fees are separate. Pro is `$25/month`; no upgrade or paid plan is
authorized by this repository work.

## Current manual gate

The Kapso dashboard is at its login page. After the owner signs in, create or
select a project named `Mozzaro`, inspect its plan, and open the WhatsApp
Business App connection flow. Stop before continuing from Kapso into Meta so
the permissions, mobile-app impact, and billing can be reviewed.

Official references:

- https://docs.kapso.ai/docs/how-to/whatsapp/connect-whatsapp
- https://docs.kapso.ai/docs/how-to/whatsapp/coexistence-troubleshooting
- https://docs.kapso.ai/docs/platform/webhooks/security
- https://docs.kapso.ai/docs/platform/webhooks/message-events
- https://docs.kapso.ai/docs/whatsapp/pricing-faq
