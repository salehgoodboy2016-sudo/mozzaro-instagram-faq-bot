# Instagram FAQ Webhook

The service is intentionally disabled by default. Set `INSTAGRAM_AUTO_REPLY_ENABLED=false` until the webhook and test results have been reviewed.
Story processing is disabled by default. Set `INSTAGRAM_MENTION_REVIEW_ENABLED=false` and `INSTAGRAM_MENTION_REPOST_ENABLED=false` until setup is complete. Publishing is not implemented.

## Required server environment variables

Set these as deployment-provider secrets or environment variables. Do not commit them:

- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_USER_ID` (`17841462669253572` for the current Mozzaro account)
- `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (a new random value used only for Meta verification)
- `INSTAGRAM_WEBHOOK_APP_SECRET`
- `INSTAGRAM_EXPECTED_USERNAME=mozzaro_pizzeria`
- `INSTAGRAM_AUTO_REPLY_ENABLED=false`
- `INSTAGRAM_MENTION_REPOST_ENABLED=false`
- `INSTAGRAM_MENTION_REVIEW_FILE=./data/story-mention-review.jsonl`

Optional: `INSTAGRAM_REPEAT_COOLDOWN_MS`, `INSTAGRAM_STATE_FILE`, and `PORT`.

## Deploy

Deploy the repository as a Docker web service. The service listens on `PORT` and exposes:

- `GET /health`
- `GET /webhooks/instagram` for Meta verification
- `POST /webhooks/instagram` for incoming Instagram events

When review is enabled, explicit Story mention events are recorded in
`data/story-mention-review.jsonl`. Media availability and the supported publishing
workflow still need verification against official documentation and a real event.
Do not treat ordinary feed mentions or Story replies as Story mentions.
It does not scrape Instagram or use password automation. The included sample
at `output/story/mozzaro-story-sample.png` is an AI-generated visual draft, not
output of an implemented template compositor.

POST requests fail closed with HTTP 503 when the app secret is missing and
HTTP 401 for invalid or missing signatures. Health status does not establish
that Meta is connected. Render Free has ephemeral storage and sleeps when
idle; durable queue/state storage is required before production activation.

In Meta's Instagram Webhooks configuration, use the deployed HTTPS URL plus `/webhooks/instagram`, and the same verify token stored in the server environment. Subscribe to the Instagram messaging event. Keep automatic replies disabled while testing.

After the test checklist passes, change only `INSTAGRAM_AUTO_REPLY_ENABLED` to `true` in the deployment provider and redeploy. No local computer process is required after deployment.
