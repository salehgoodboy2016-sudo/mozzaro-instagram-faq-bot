# Instagram FAQ Webhook

The service is intentionally disabled by default. Set `INSTAGRAM_AUTO_REPLY_ENABLED=false` until the webhook and test results have been reviewed.

## Required server environment variables

Set these as deployment-provider secrets or environment variables. Do not commit them:

- `INSTAGRAM_ACCESS_TOKEN`
- `INSTAGRAM_USER_ID` (`17841462669253572` for the current Mozzaro account)
- `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` (a new random value used only for Meta verification)
- `INSTAGRAM_WEBHOOK_APP_SECRET`
- `INSTAGRAM_EXPECTED_USERNAME=mozzaro_pizzeria`
- `INSTAGRAM_AUTO_REPLY_ENABLED=false`

Optional: `INSTAGRAM_REPEAT_COOLDOWN_MS`, `INSTAGRAM_STATE_FILE`, and `PORT`.

## Deploy

Deploy the repository as a Docker web service. The service listens on `PORT` and exposes:

- `GET /health`
- `GET /webhooks/instagram` for Meta verification
- `POST /webhooks/instagram` for incoming Instagram events

In Meta's Instagram Webhooks configuration, use the deployed HTTPS URL plus `/webhooks/instagram`, and the same verify token stored in the server environment. Subscribe to the Instagram messaging event. Keep automatic replies disabled while testing.

After the test checklist passes, change only `INSTAGRAM_AUTO_REPLY_ENABLED` to `true` in the deployment provider and redeploy. No local computer process is required after deployment.
