# HUUID Protocol — Correction History

This file is the permanent, append-only record of corrections applied to the
HUUID protocol's documentation and codebase. Entries are never removed or
rewritten — only appended.

---

## July 2026 — Corrections 1–7

### Correction 1 — Root Authority identity

**Change:** Replaced every instance of "Ghana Health Service" used as Root
Authority with **"HUUID Protocol Working Group"** (contact:
josephtdnarnor@gmail.com).

**Note added wherever Root Authority is mentioned:**
> Upon successful pilot adoption, operational control transitions to the
> national health authority of the adopting country.

**Reason:** The protocol is designed to be internationally neutral at launch.
Naming a single country's health service as permanent Root Authority
misrepresented the governance model and would need correcting the moment a
second country adopted the protocol. Framing the Working Group as an interim
Root Authority, with an explicit transition clause, avoids that rework and
states the real intent plainly.

---

### Correction 2 — HUUID Foundation added above Root Authority

**Change:** Added an **L0** level above the existing top of the trust
hierarchy:

- **L0 — HUUID Foundation** (international neutral root). Currently: HUUID
  Protocol Working Group acting as Foundation. Capability: holds root keys,
  publishes resolver software, registers national Root Authorities, zero
  patient data access.
- L1 — Root Authority (per-country)
- L2 — Issuing nodes / facilities

**Reason:** Without an L0, "Root Authority" was being used to mean both the
single global root of trust *and* a per-country trust anchor at the same
time, which is inconsistent once more than one country is enrolled. Adding
L0 makes explicit that the Foundation is the neutral, non-national root that
registers Root Authorities — it does not itself act as any one country's
health authority, and it never has access to patient data.

---

### Correction 3 — Consent tracks are equal, no default

**Change:** Wherever consent is described, added explicit language that all
three consent tracks are equal and that none is a default. The applicable
track is determined by the clinical situation:

- **Track A** — patient is conscious and present
- **Track B** — patient is incapacitated (Break-Glass)
- **Track C** — patient is a minor or has a legal guardian

**Reason:** Earlier drafts implied Track A (conscious/present) as the
"normal" path with B and C as exceptions. In practice, which track applies
is a clinical determination made at the point of care, not a fallback
ordering — treating one track as default risked engineers building
Track-A-first assumptions into resolver or EMR logic where none should
exist.

---

### Correction 4 — Audit log access section

**Change:** Added, wherever the audit log is described:

> Audit log access: Root Authority via service role only. Facilities see
> only their own records. Patients can request their own access history.
> Endpoint: `GET /1.0/audit/{huuid}` — requires scoped JWT. The audit log
> never contains medical data.

**Reason:** The original audit log specification defined write access
(service_role INSERT/SELECT, immutable) but never defined *who reads it and
under what scope*. Without this, a reasonable implementer could expose the
full audit log to any authenticated party, or conversely give patients no
way to see who has resolved their own identifier — both are compliance
failures for a health identity protocol.

---

### Correction 5 — HTTP methods made explicit

**Change:** Made explicit everywhere the resolver's HTTP methods are
discussed:

- **GET** — resolution endpoint, `/1.0/identifiers/{did}`
- **POST** — Break-Glass only, `/1.0/identifiers/{did}/break-glass`

All other references to the resolver now specify GET.

**Reason:** The W3C DID Resolution Specification mandates GET for
resolution (Section 0 of HUUID-RESOLVER-API-v0.1 — a POST resolver breaks
Universal Resolver driver compatibility). Break-Glass is a distinct,
side-effecting operation and is the protocol's only legitimate POST. Leaving
this implicit risked a future engineer building a POST-based resolver by
analogy with the Break-Glass endpoint.

---

### Correction 6 — HUUID-EMR-STUB retirement warning

**Change:** Wherever HUUID-EMR-STUB is referenced, added:

> WARNING: v0.1 is retired and must never be deployed. Only
> HUUID-EMR-STUB-v0.1.1 is valid.

**Reason:** HUUID-EMR-STUB-v0.1 was superseded by v0.1.1 after a defect was
found in the original stub. Without an explicit retirement warning at every
reference point, a pilot facility or engineer working from an older copy of
the spec could deploy the retired v0.1 stub against the production resolver.

---

### Correction 7 — This file

**Change:** Created `docs/CORRECTIONS.md` as the permanent, append-only
correction history for the HUUID protocol, recording Corrections 1–6 above
with date and reason.

**Reason:** A protocol intended for national health infrastructure needs an
auditable record of *why* governance, consent, and access-control language
changed over time — not just what the current text says. This file is that
record, alongside the resolver's own `huuid_audit_log` (which records
resolution activity, not protocol/document changes).

---

*Corrections are appended below this line as they occur. Nothing above this
line is ever edited or removed.*
