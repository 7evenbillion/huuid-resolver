-- Waitlist for the public homepage's "Get Your HUUID" individual-enrollment
-- signal (Section: WAITLIST PAGE). No PII beyond email + self-reported
-- country; captured for interest-registration only, no consent flow yet
-- since individual enrollment is not built (Section 5.3 of the Resolution
-- Spec describes facility-terminal enrollment only).

CREATE TABLE huuid_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE huuid_waitlist ENABLE ROW LEVEL SECURITY;

-- service_role only, matching every other huuid_ table in this shared
-- project -- writes go through POST /api/waitlist using the service
-- client, never a direct anon/authenticated insert.
GRANT SELECT, INSERT ON huuid_waitlist TO service_role;
