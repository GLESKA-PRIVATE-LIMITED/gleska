#!/usr/bin/env bash
# Concurrency test for billing_reserve / billing_settle (migration 104).
# Usage: PSQL="psql -h <host> -p <port> -U postgres -d postgres -X -q" bash billing_concurrency.sh
# Requires the migration plus an employer_profiles row 'aaaaaaaa-0000-0000-0000-000000000003'
# (and its users row). Fires 50 parallel 1-credit reservations against a 10-credit wallet,
# settles every success at 0.4 credits, then checks the invariants.
set -euo pipefail
PSQL=${PSQL:?set PSQL to a psql command}
EMPLOYER=aaaaaaaa-0000-0000-0000-000000000003
ACTOR=11111111-1111-1111-1111-111111111111

ACCOUNT=$($PSQL -At -c "SELECT billing_ensure_account('$EMPLOYER')")
$PSQL -c "SELECT billing_admin_adjust('$ACCOUNT', 10, 'Concurrency test balance', '$ACTOR', 'conc-$ACCOUNT')" >/dev/null

for i in $(seq 1 50); do
  $PSQL -At -c "
    WITH e AS (
      INSERT INTO ai_usage_events (request_id, account_id, initiating_agent, executing_agent, operation, provider, model, status)
      VALUES ('conc-$ACCOUNT-$i', '$ACCOUNT', 'hiring', 'hiring', 'test', 'gemini', 'test-model', 'reserved') RETURNING id)
    SELECT billing_reserve(id, 1) FROM e;" >/dev/null 2>&1 && echo ok || echo rejected &
done > "${TMPDIR:-/tmp}/billing_conc_$$" ; wait

OK=$(grep -c '^ok$' "${TMPDIR:-/tmp}/billing_conc_$$" || true)
rm -f "${TMPDIR:-/tmp}/billing_conc_$$"
# Settle every held reservation concurrently, twice each (idempotency under contention).
for id in $($PSQL -At -c "SELECT usage_event_id FROM credit_reservations WHERE account_id = '$ACCOUNT' AND status = 'held'"); do
  $PSQL -c "SELECT billing_settle('$id', 0.4, '{\"status\":\"succeeded\"}')" >/dev/null &
  $PSQL -c "SELECT billing_settle('$id', 0.4, '{\"status\":\"succeeded\"}')" >/dev/null &
done; wait

$PSQL -At -c "
  SELECT CASE WHEN w.available = 6 AND w.reserved = 0 AND w.total_consumed = 4
              AND (SELECT sum(delta_available) FROM credit_ledger WHERE account_id = w.account_id) = w.available
              AND (SELECT count(*) FROM credit_ledger WHERE account_id = w.account_id AND entry_type = 'settle') = 10
         THEN 'CONCURRENCY PASSED: 10 of 50 reservations succeeded, balance 6, no double settlement'
         ELSE 'CONCURRENCY FAILED: available=' || w.available || ' reserved=' || w.reserved || ' consumed=' || w.total_consumed END
  FROM credit_wallets w WHERE w.account_id = '$ACCOUNT'"
[ "$OK" -eq 10 ] || { echo "CONCURRENCY FAILED: $OK reservations succeeded (expected 10)"; exit 1; }
