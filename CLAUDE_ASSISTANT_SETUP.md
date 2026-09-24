# Mozzaro Claude assistant

The assistant is implemented in `src/claude-client.mjs` and uses Anthropic's official Messages API. It is disabled unless `WHATSAPP_CLAUDE_AI_ENABLED=true`, an API key and model are configured, both per-token prices are set, and the monthly USD cap is greater than zero. The current pilot allowlist and WhatsApp send gates still apply.

The final owner-approved two-page menu is bundled unchanged at `assets/menu/mozzaro-menu.pdf` and served over HTTPS at `https://mozzaro-instagram-faq-bot.onrender.com/menu/mozzaro.pdf`. Its SHA-256 is `c74535c6138fea6abf33a8355704984a49f74251b6e7a26efd61cdb6d8dc7e4d`. The reviewed menu knowledge covers all 30 items and prices, including focaccia. Full-menu requests use Kapso's document message with an Arabic caption and the filename `منيو موزارو.pdf`; specific items and categories use short Arabic answers. Ambiguous items, complaints, suggestions, and unverified details go to staff. No English item names appear in default Arabic replies.

`KAPSO_MENU_DOCUMENT_ENABLED` is a separate live-send gate and defaults to `false`. Keep it off until the owner explicitly approves the allowlisted live PDF test. When enabled, the existing Kapso and WhatsApp allowlist still restricts sends to `966545383080`; this gate does not broaden customer automation or enable Claude. No live PDF is sent by the automated test suite. A failed document send leads to one short Arabic fallback and conversation handoff, with no automatic retry of the document.

The editable approved facts, menu, and catering data live in `src/mozzaro-knowledge.mjs`. Menu names and SAR prices are transcribed from the official menu PDF supplied on 2026-09-24. The catering packages, inclusions, and add-ons are transcribed from the official catering PDF; explicit owner updates take precedence over conflicting PDF allocations. Package prices are starting prices; Burrata is optional and included within each fixed package total, and pizza and pasta share the same package pricing and quantities. Current catering staff are male only. The owner-approved catering contact is `0565017314` (`+966565017314`); the obsolete PDF number must not appear in customer responses. Booking confirmation, date availability, custom quantities/requests, final quotes, and unpriced distance-based services are handed to staff. `priceSar: null` for Pizza of the Month means the PDF has no fixed price; customers are directed to staff. Ingredients, allergens, current availability, and other unverified claims remain absent and must be handled by a person. WhatsApp FAQ fallback renders reviewed menu and catering answers from this same data. The catering contact answer is shared with Instagram FAQs; only that contact fact was updated in the existing Instagram reply, while its routing and automation configuration remain unchanged.

Claude classifies a message into a small set of approved topics. The Render service constructs the outgoing answer from the reviewed copy in `src/mozzaro-knowledge.mjs`; Claude never writes customer-facing facts. Missing or ambiguous questions, employee requests, complaints, refunds, and complex orders activate human handoff. The existing FAQ remains the fallback if Anthropic is unavailable. Failed/uncertain outbound sends are not retried automatically.

The assistant sends at most six recent message turns for the same allowlisted conversation to Anthropic. Render stores that short context in PostgreSQL and expires it after 24 hours. Logs contain no message text, customer number, key, or signing secret. Monthly token/cost totals and the configured cap are visible in the existing authenticated WhatsApp admin status response.

## Current verified knowledge

`src/mozzaro-knowledge.mjs` contains the reviewed opening hours, supplier statements, menu items/prices, catering package rules, add-ons, and approved contact text. Confirmed ingredients/allergens and additional restaurant policies remain absent until Mozzaro verifies them. Claude must hand those questions to an employee.

## Required account setup before any AI call

The following Render environment values are intentionally absent or disabled:

- `ANTHROPIC_API_KEY` — create in Anthropic Console and add only in Render.
- `ANTHROPIC_MODEL` — choose an available model in the Anthropic Console.
- `ANTHROPIC_INPUT_USD_PER_MILLION` and `ANTHROPIC_OUTPUT_USD_PER_MILLION` — enter the current prices for that selected model.
- `WHATSAPP_AI_MONTHLY_LIMIT_USD` — choose a monthly cap.
- `WHATSAPP_CLAUDE_AI_ENABLED=false` — remains off until separately approved after configuration and test review.

The per-request PostgreSQL budget guard and Anthropic's own organization spend limit are separate controls. Set the provider-side spend limit in Anthropic Console as well. Never put the API key in source, local logs, chat, or a browser prompt. No live Anthropic request is made by tests or while the feature flag is off.
