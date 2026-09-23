# WhatsApp Webhook

WhatsApp uses an endpoint separate from Instagram. The callback URL for the
deployed Render service is:

`https://mozzaro-instagram-faq-bot.onrender.com/webhooks/whatsapp`

Set `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in Render to a private random value, then
enter that same value in Meta's Verify Token field. Also set
`WHATSAPP_WEBHOOK_APP_SECRET` in Render to the Meta App Secret for the app that
owns the WhatsApp webhook. If Instagram and WhatsApp use the same Meta app, the
secret value is the same, but this service reads it from a separate environment
variable. Do not commit either value.

`GET /webhooks/whatsapp` implements Meta's verification challenge and returns
the challenge only when `hub.mode=subscribe` and the verification token matches.
`POST /webhooks/whatsapp` validates `X-Hub-Signature-256` against the original
request bytes with HMAC-SHA256, rejects missing secrets and invalid signatures,
limits request bodies to 1 MiB, parses JSON only after signature validation,
and accepts only WhatsApp Business Account event envelopes. Valid events are
acknowledged without storing message content or sending replies. Automatic
WhatsApp replies are not implemented or enabled.

The Instagram routes and their existing settings remain independent.
