# Instagram FAQ Webhook

The service is intentionally disabled by default. Set `INSTAGRAM_AUTO_REPLY_ENABLED=false` until the webhook and test results have been reviewed.
Story mention handling is also review-only by default. Set `INSTAGRAM_MENTION_REPOST_ENABLED=false`.

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

When a `mentions` change or Story attachment is received, the service writes a
deduplicated record to `data/story-mention-review.jsonl`. The official Meta API
does not provide a supported way to download another user's Story media and
repost it automatically, so this workflow intentionally stops at manual review.
It does not scrape Instagram or use password automation. The included sample
is at `output/story/mozzaro-story-sample.png`.

In Meta's Instagram Webhooks configuration, use the deployed HTTPS URL plus `/webhooks/instagram`, and the same verify token stored in the server environment. Subscribe to the Instagram messaging event. Keep automatic replies disabled while testing.

After the test checklist passes, change only `INSTAGRAM_AUTO_REPLY_ENABLED` to `true` in the deployment provider and redeploy. No local computer process is required after deployment.
