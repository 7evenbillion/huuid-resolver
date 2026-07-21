-- HUUID Resolver -- Migration 011: separate rate-limit counters per purposeCode
--
-- International protocol design decision: each purposeCode (Treatment,
-- Administrative, Research, Emergency) is a legally distinct access
-- category with independent budget, independent audit trail, and
-- independent accountability. Treatment and Administrative no longer
-- share one 50/hour counter per facility (the open question migration 010
-- flagged but did not resolve) -- each now gets its own.
--
-- huuid_request_log gains a purpose_code column so the count can be scoped
-- to (facility_did, purpose_code) instead of facility_did alone. Existing
-- rows backfill to 'Treatment' via the column default -- every row logged
-- before this migration was, in fact, a Treatment-purpose resolution
-- (Administrative/Emergency/Research testing in this build so far went
-- through separate code paths or was never volume-tested), so the default
-- does not misattribute any real historical data.
--
-- Lock strategy changed from migration 010: rather than SELECT ... FOR
-- UPDATE on the facility's row in huuid_facilities (which would serialize
-- ALL purposes for a facility through one lock, even though they now count
-- into independent buckets -- defeating the point of separating them),
-- this uses a Postgres advisory transaction lock keyed on
-- facility_did + purpose_code together. Concurrent Treatment and
-- Administrative requests for the SAME facility no longer contend with
-- each other at all -- they proceed fully in parallel. Concurrent requests
-- for the SAME facility AND SAME purpose still fully serialize, exactly as
-- migration 010's fix required (that correctness property is preserved,
-- just scoped more precisely). pg_advisory_xact_lock is automatically
-- released at transaction end, same guarantee a row lock would give for a
-- single-statement RPC call.
--
-- hashtextextended(..., 0) produces a 64-bit hash -- collision risk across
-- the small, known set of real facility+purpose combinations in this
-- protocol is not a practical concern.

ALTER TABLE huuid_request_log ADD COLUMN purpose_code TEXT NOT NULL DEFAULT 'Treatment';

DROP FUNCTION IF EXISTS increment_resolution_rate_limit(TEXT, UUID);

CREATE OR REPLACE FUNCTION increment_resolution_rate_limit(
  p_facility_did TEXT,
  p_request_id UUID,
  p_purpose_code TEXT
) RETURNS INTEGER AS $$
DECLARE
  v_row_count INTEGER;
  v_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_facility_did || ':' || p_purpose_code, 0));

  INSERT INTO huuid_request_log (request_id, facility_did, purpose_code, logged_at)
  VALUES (p_request_id, p_facility_did, p_purpose_code, now())
  ON CONFLICT (request_id) DO NOTHING;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count = 0 THEN
    RETURN -1;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM huuid_request_log
  WHERE facility_did = p_facility_did
    AND purpose_code = p_purpose_code
    AND logged_at > now() - interval '1 hour';

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION increment_resolution_rate_limit(TEXT, UUID, TEXT) TO service_role;
