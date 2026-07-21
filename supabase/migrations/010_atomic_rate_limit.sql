-- HUUID Resolver -- Migration 010: atomic rate-limit counting
--
-- Month 5 finding: the previous count-then-insert pattern (a plain SELECT
-- COUNT followed by a separate INSERT, as two independent round trips) is
-- not atomic under concurrency. Confirmed under real load: standard
-- resolution under-delivered legitimate successes in a 100-concurrent
-- burst (42 instead of 50), and Break-Glass silently skipped creating the
-- huuid_facility_suspensions row when 10 truly simultaneous requests all
-- read a low count before seeing each other's inserts. In both cases the
-- eventual ceiling still held -- no attacker got more than the intended
-- budget -- but the count itself, and anything gated on hitting an exact
-- threshold (the suspension row, the alert hanging off it), was unreliable
-- under a tight simultaneous burst.
--
-- IMPORTANT, and the reason this migration does more than move the same
-- two statements into a stored function: wrapping INSERT + SELECT COUNT in
-- a single RPC call does NOT by itself make concurrent CALLS to that
-- function atomic with respect to each other. Postgres transactions still
-- run independently unless something forces them to serialize. Both
-- functions below take an explicit row lock (`SELECT ... FOR UPDATE`) on
-- the requesting facility's own row in huuid_facilities before counting --
-- concurrent callers for the SAME facility queue behind that lock one at a
-- time (in commit order), so each one's COUNT is guaranteed to reflect
-- every prior committed request for that facility, not a racing snapshot.
-- Concurrent callers for DIFFERENT facilities are unaffected -- the lock
-- is per-row, not per-table. Plain (non-locking) reads of huuid_facilities
-- elsewhere in the app (the JWT public-key lookup) are never blocked by
-- this lock either -- row locks only block other FOR UPDATE/FOR SHARE/
-- UPDATE/DELETE statements on the same row, never plain SELECTs.
--
-- Trade-off, stated plainly: this serializes concurrent requests FROM THE
-- SAME FACILITY through the lock, which reduces the raw throughput a
-- single facility can achieve during a simultaneous burst (each request
-- now waits its turn at the DB layer instead of racing). Requests from
-- different facilities remain fully parallel. This is the correct
-- trade-off here -- precision under burst load is exactly what the Month 5
-- finding was about -- but it is a real, deliberate cost, not a free fix.

-- ── Break-Glass rate limiting ──
--
-- Returns NULL when the facility is already at/over the 10-request
-- ceiling for the rolling 24h window -- the caller must treat NULL as
-- "reject with 429, do not process," and this request is deliberately NOT
-- recorded in huuid_bg_rate_limit, matching the original behavior where an
-- 11th+ request was never inserted either.
--
-- Otherwise records the request, returns the new count (1-10), marks the
-- just-inserted row's `suspended` flag when this is the 10th, and -- in
-- the same locked transaction, so it can never be silently skipped the
-- way it was found to be under concurrency -- opens the
-- huuid_facility_suspensions row exactly once, on exactly the 10th
-- request. Patient safety note preserved: the 10th request itself is
-- still accepted (returns 10, not NULL) and the caller still processes
-- it -- only the 11th onward is rejected.
CREATE OR REPLACE FUNCTION increment_bg_rate_limit(
  p_facility_did TEXT,
  p_request_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_prior_count INTEGER;
  v_new_count INTEGER;
BEGIN
  PERFORM 1 FROM huuid_facilities WHERE facility_did = p_facility_did FOR UPDATE;

  SELECT COUNT(*) INTO v_prior_count
  FROM huuid_bg_rate_limit
  WHERE facility_did = p_facility_did
    AND triggered_at > now() - interval '24 hours';

  IF v_prior_count >= 10 THEN
    RETURN NULL;
  END IF;

  v_new_count := v_prior_count + 1;

  INSERT INTO huuid_bg_rate_limit (facility_did, request_id, triggered_at, suspended)
  VALUES (p_facility_did, p_request_id, now(), v_new_count >= 10);

  IF v_new_count = 10 THEN
    INSERT INTO huuid_facility_suspensions (facility_did, reason, active)
    VALUES (p_facility_did, 'bg_rate_limit_exceeded', true);
  END IF;

  RETURN v_new_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION increment_bg_rate_limit(TEXT, UUID) TO service_role;

-- ── Standard resolution rate limiting ──
--
-- Same lock-then-count shape, applied to huuid_request_log, which already
-- serves double duty: duplicate-request-id detection (a genuinely
-- unrelated concern, already atomic on its own via request_id's UNIQUE
-- constraint and ON CONFLICT DO NOTHING -- that part was never the race)
-- and, since Month 5, the rolling-60-minute rate-limit count for this
-- facility.
--
-- Returns -1 when p_request_id was already used (duplicate -- caller
-- returns 409, exactly as before). Otherwise records the request and
-- returns the new count for this facility in the trailing 60 minutes,
-- INCLUDING the request just inserted -- the caller enforces
-- count > 50 -> 429 only for Treatment/Administrative purposes; Emergency
-- and Research are exempted by the caller, not by this function, which
-- always records for duplicate-detection purposes regardless of purpose
-- code, matching the original Step 4 behavior for every purpose.
CREATE OR REPLACE FUNCTION increment_resolution_rate_limit(
  p_facility_did TEXT,
  p_request_id UUID
) RETURNS INTEGER AS $$
DECLARE
  v_row_count INTEGER;
  v_count INTEGER;
BEGIN
  PERFORM 1 FROM huuid_facilities WHERE facility_did = p_facility_did FOR UPDATE;

  INSERT INTO huuid_request_log (request_id, facility_did, logged_at)
  VALUES (p_request_id, p_facility_did, now())
  ON CONFLICT (request_id) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RETURN -1;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM huuid_request_log
  WHERE facility_did = p_facility_did
    AND logged_at > now() - interval '60 minutes';

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION increment_resolution_rate_limit(TEXT, UUID) TO service_role;
