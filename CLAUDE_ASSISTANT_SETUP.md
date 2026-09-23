# Mozzaro Claude assistant

The assistant is implemented in `src/claude-client.mjs` and uses Anthropic's official Messages API. It is disabled unless `WHATSAPP_CLAUDE_AI_ENABLED=true`, an API key and model are configured, both per-token prices are set, and the monthly USD cap is greater than zero. The current pilot allowlist and WhatsApp send gates still apply.

Claude classifies a message into a small set of approved topics. The Render service constructs the outgoing answer from the reviewed copy in `src/mozzaro-knowledge.mjs`; Claude never writes customer-facing facts. Missing or ambiguous questions, employee requests, complaints, refunds, and complex orders activate human handoff. The existing FAQ remains the fallback if Anthropic is unavailable. Failed/uncertain outbound sends are not retried automatically.

The assistant sends at most six recent message turns for the same allowlisted conversation to Anthropic. Render stores that short context in PostgreSQL and expires it after 24 hours. Logs contain no message text, customer number, key, or signing secret. Monthly token/cost totals and the configured cap are visible in the existing authenticated WhatsApp admin status response.

## Current verified knowledge

`src/mozzaro-knowledge.mjs` contains the reviewed opening hours, supplier statements, and ordering/catering contact text. Menu items/prices, confirmed ingredients/allergens, and additional restaurant policies are intentionally empty until Mozzaro verifies them. Claude must hand those questions to an employee.

## Required account setup before any AI call

The following Render environment values are intentionally absent or disabled:

- `ANTHROPIC_API_KEY` — create in Anthropic Console and add only in Render.
- `ANTHROPIC_MODEL` — choose an available model in the Anthropic Console.
- `ANTHROPIC_INPUT_USD_PER_MILLION` and `ANTHROPIC_OUTPUT_USD_PER_MILLION` — enter the current prices for that selected model.
- `WHATSAPP_AI_MONTHLY_LIMIT_USD` — choose a monthly cap.
- `WHATSAPP_CLAUDE_AI_ENABLED=false` — remains off until separately approved after configuration and test review.

The per-request PostgreSQL budget guard and Anthropic's own organization spend limit are separate controls. Set the provider-side spend limit in Anthropic Console as well. Never put the API key in source, local logs, chat, or a browser prompt. No live Anthropic request is made by tests or while the feature flag is off.
