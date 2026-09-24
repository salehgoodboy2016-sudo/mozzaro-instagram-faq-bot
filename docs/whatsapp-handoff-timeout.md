# WhatsApp employee handoff timeout

The WhatsApp service stores the employee event timestamp, database-computed expiry, and the latest unanswered customer message in PostgreSQL. Employee activity starts or restarts a 15-minute pause. Explicit handoff reasons are protected and have no expiry. Only handoffs whose reason is `employee_activity` can expire automatically.

Customer messages during the pause are persisted by conversation. A newer unanswered message replaces the prior pending item and marks the prior event `pending_superseded`. At timeout the pending message is processed once through the existing allowlist, handoff, FAQ/Claude, spending, and Kapso send controls. A pending claim left in progress by a process restart can be safely reclaimed after five minutes; send reservations prevent duplicate outbound messages.

## Scheduled processing on Render

The web service also checks for an expired handoff when a new customer message arrives. That covers a customer who writes again after the 15-minute deadline. It does not wake a sleeping Free web service at the deadline. For autonomous timeout processing, create a Render Cron Job after approving its cost:

- Repository and branch: the existing Mozzaro repository, `main`.
- Schedule: `* * * * *` (UTC; polling every minute, so timeout processing may occur up to about one minute after expiry).
- Command: `pnpm whatsapp:handoff-sweep`.
- Environment: attach the same secure environment group as the web service, including its WhatsApp database, identity, Kapso, Coexistence, allowlist, and Claude configuration values.

Render documents a minimum monthly charge of USD 1 for each Cron Job service. This job has not been provisioned or scheduled without approval.
