import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Smile ID (usesmileid.com) — biometric KYC sub-processor for face and
 * document verification. See HUUID-COMPLIANCE-v0.2.docx Section 2A for
 * the data-processing disclosure this integration depends on, and
 * HUUID-RESOLUTION-SPEC-v0.3.docx Section 3.1/3.2 for the T1-T5 weighted
 * matching model this feeds (lib/dedup-scoring.ts).
 *
 * Built against Smile ID's current V3 API (docs.usesmileid.com), verified
 * directly against their live GitBook docs on 2026-08-10/11, not assumed
 * from prior knowledge. Three real differences from the original build
 * prompt's assumptions, disclosed here:
 *
 * 1. Auth is a short-lived JWT (POST /v3/token with partner_id + api_key
 *    headers, 15-minute expiry), not a signature/timestamp on every
 *    request. getAccessToken() below handles this internally.
 *
 * 2. Every V3 verification (Biometric KYC, Document Verification,
 *    SmartSelfie) is asynchronous: the submit call returns only
 *    {job_id, user_id, created_at} with a 202, never a synchronous
 *    result. The full result (id_fields, antifraud, etc.) arrives later
 *    at the callback URL (Layer 4, app/api/smile-id/callback). So
 *    initiateDocumentVerification here returns the job handle only --
 *    parseVerificationWebhook() is what turns a webhook payload into the
 *    rich DocumentVerificationResult shape the original prompt described.
 *
 * 3. There is no standalone "check for duplicate face" endpoint. Smile ID
 *    runs duplicate detection ("Smile Secure") automatically on every
 *    Biometric KYC / Document Verification / SmartSelfie job, and reports
 *    it in the SAME webhook payload under antifraud.smile_secure
 *    (status, suspect_users[] with reasons same-id-number/same-face).
 *    checkForDuplicateFace() below is therefore a pure parser over that
 *    webhook field, called from the Layer 4 callback handler -- not a
 *    second API call.
 *
 * verifyDocumentWithAuthority() follows the same token+multipart+async
 * pattern confirmed for the other three endpoints, extrapolated to
 * Enhanced KYC's request shape (not individually fetched from the docs
 * this session) -- confirm its exact field names against
 * /api-reference/products/enhanced-kyc/perform-an-enhanced-kyc-
 * verification.md before this path is exercised against real credentials.
 *
 * Naming note: the AcceptedResponse Smile ID actually returns has
 * `job_id` and `user_id`. The DB schema (migration 036) uses the field
 * names from the original build prompt -- smile_id_job_id stores job_id,
 * smile_id_smile_reference stores user_id (the enrollee handle needed for
 * later re-verification calls like verifyFaceAtFacility). Smile ID's own
 * current docs don't use the term "smile reference" -- kept for schema
 * continuity with the prompt's design, not because it's Smile ID's term.
 */

const SANDBOX_BASE_URL = 'https://testapi.smileidentity.com';
const PRODUCTION_BASE_URL = 'https://api.smileidentity.com';

function getBaseUrl(): string {
  return process.env.SMILE_ID_ENVIRONMENT === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
}

function getCredentials(): { partnerId: string; apiKey: string } {
  const partnerId = process.env.SMILE_ID_PARTNER_ID;
  const apiKey = process.env.SMILE_ID_API_KEY;
  if (!partnerId || !apiKey) {
    throw new SmileIdNotConfiguredError();
  }
  return { partnerId, apiKey };
}

export class SmileIdNotConfiguredError extends Error {
  constructor() {
    super('Smile ID is not configured (SMILE_ID_PARTNER_ID / SMILE_ID_API_KEY missing).');
    this.name = 'SmileIdNotConfiguredError';
  }
}

export function isSmileIdConfigured(): boolean {
  return Boolean(process.env.SMILE_ID_PARTNER_ID && process.env.SMILE_ID_API_KEY);
}

type SmileIdProduct =
  | 'biometric_kyc'
  | 'document_verification'
  | 'smart_selfie_authentication'
  | 'enhanced_kyc';

/** POST /v3/token -- 15-minute JWT, generated fresh per verification call rather than cached/reused (Smile ID's own recommendation). */
async function getAccessToken(product: SmileIdProduct): Promise<string> {
  const { partnerId, apiKey } = getCredentials();

  const res = await fetch(`${getBaseUrl()}/v3/token`, {
    method: 'POST',
    headers: {
      'smileid-partner-id': partnerId,
      'smileid-api-key': apiKey,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Smile ID token request failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    throw new Error('Smile ID token response did not include a token.');
  }
  return data.token;
}

interface ConsentInput {
  noticeLanguage: string;
  noticePrivacyPolicyUrl: string;
}

function buildConsent(consent: ConsentInput) {
  return {
    granted: true,
    granted_at: new Date().toISOString(),
    notice_language: consent.noticeLanguage.toUpperCase(),
    notice_privacy_policy_url: consent.noticePrivacyPolicyUrl,
  };
}

export interface AcceptedJob {
  jobId: string;
  userId: string;
  createdAt: string;
}

async function submitJob(
  path: string,
  product: SmileIdProduct,
  form: FormData,
  userId?: string
): Promise<AcceptedJob> {
  const { partnerId } = getCredentials();
  const token = await getAccessToken(product);

  const headers: Record<string, string> = {
    'SmileID-Partner-ID': partnerId,
    'SmileID-Token': token,
  };
  if (userId) headers['User-ID'] = userId;

  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: 'POST',
    headers,
    body: form,
    cache: 'no-store',
  });

  if (res.status !== 202) {
    const body = await res.text().catch(() => '');
    throw new Error(`Smile ID ${path} returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { job_id: string; user_id: string; created_at: string };
  return { jobId: data.job_id, userId: data.user_id, createdAt: data.created_at };
}

// ------------------------------------------------------------
// Function 1: initiateDocumentVerification
// ------------------------------------------------------------

export interface DocumentVerificationInput {
  huuid: string;
  selfieImage: Blob;
  livenessImages: Blob[];
  documentFront: Blob;
  documentBack?: Blob;
  countryCode: string;
  documentType?: string;
  givenNames: string;
  lastName: string;
  email?: string;
  phone?: string;
  consent: ConsentInput;
}

/** POST /v3/document_verification. Async -- returns only the job handle; the actual document/face/liveness result arrives later via the callback (Layer 4, parseVerificationWebhook below). */
export async function initiateDocumentVerification(input: DocumentVerificationInput): Promise<AcceptedJob> {
  if (input.livenessImages.length < 6 || input.livenessImages.length > 8) {
    throw new Error('Smile ID requires 6-8 liveness images.');
  }

  const form = new FormData();
  form.append('selfie_image', input.selfieImage, 'selfie.jpg');
  for (const img of input.livenessImages) form.append('liveness_images', img, 'liveness.jpg');
  form.append('document', input.documentFront, 'document_front.jpg');
  if (input.documentBack) form.append('document_back', input.documentBack, 'document_back.jpg');
  form.append('consent', JSON.stringify(buildConsent(input.consent)));
  form.append('country', input.countryCode.toUpperCase());
  if (input.documentType) form.append('id_type', input.documentType);
  form.append(
    'user_details',
    JSON.stringify({
      given_names: input.givenNames,
      last_name: input.lastName,
      email: input.email,
      phone_number: input.phone,
    })
  );
  const callbackUrl = process.env.SMILE_ID_CALLBACK_URL;
  if (callbackUrl) form.append('callback_url', callbackUrl);
  form.append('partner_params', JSON.stringify({ huuid: input.huuid }));

  return submitJob('/v3/document_verification', 'document_verification', form);
}

// ------------------------------------------------------------
// Function 2: checkForDuplicateFace
//
// Not a live call -- Smile Secure runs automatically as part of every
// verification and its result is embedded in that same job's webhook
// payload. This parses that payload; call it from the Layer 4 callback
// handler once a verification completes.
// ------------------------------------------------------------

export interface DuplicateFaceResult {
  duplicateFound: boolean;
  matchedUserIds: string[];
  matchReasons: ('same-id-number' | 'same-face')[];
  smileSecureStatus: 'clear' | 'attention' | 'error' | 'unknown';
}

interface SmileSecureWebhookField {
  status?: string;
  suspect_users?: { user_id: string; reasons: string[] }[];
}

export function checkForDuplicateFace(smileSecure: SmileSecureWebhookField | undefined | null): DuplicateFaceResult {
  const suspects = smileSecure?.suspect_users ?? [];
  const reasons = new Set<'same-id-number' | 'same-face'>();
  for (const s of suspects) {
    for (const r of s.reasons ?? []) {
      if (r === 'same-id-number' || r === 'same-face') reasons.add(r);
    }
  }
  const status = smileSecure?.status;
  return {
    duplicateFound: suspects.length > 0,
    matchedUserIds: suspects.map((s) => s.user_id),
    matchReasons: Array.from(reasons),
    smileSecureStatus: status === 'clear' || status === 'attention' || status === 'error' ? status : 'unknown',
  };
}

// ------------------------------------------------------------
// Function 3: verifyFaceAtFacility
// ------------------------------------------------------------

export interface FacilityFaceVerificationInput {
  smileIdUserId: string; // the user_id captured at enrollment (stored as smile_id_smile_reference)
  selfieImage: Blob;
  livenessImages: Blob[];
  givenNames: string;
  lastName: string;
  email?: string;
  phone?: string;
  consent: ConsentInput;
}

/** POST /v3/authentication -- compares a freshly captured facility selfie against the patient's enrolled Smile ID image. Async; result arrives via webhook. */
export async function verifyFaceAtFacility(input: FacilityFaceVerificationInput): Promise<AcceptedJob> {
  if (input.livenessImages.length < 6 || input.livenessImages.length > 8) {
    throw new Error('Smile ID requires 6-8 liveness images.');
  }

  const form = new FormData();
  form.append('user_id', input.smileIdUserId);
  form.append('selfie_image', input.selfieImage, 'selfie.jpg');
  for (const img of input.livenessImages) form.append('liveness_images', img, 'liveness.jpg');
  form.append('consent', JSON.stringify(buildConsent(input.consent)));
  form.append(
    'user_details',
    JSON.stringify({
      given_names: input.givenNames,
      last_name: input.lastName,
      email: input.email,
      phone_number: input.phone,
    })
  );
  const callbackUrl = process.env.SMILE_ID_CALLBACK_URL;
  if (callbackUrl) form.append('callback_url', callbackUrl);

  return submitJob('/v3/authentication', 'smart_selfie_authentication', form, input.smileIdUserId);
}

// ------------------------------------------------------------
// Function 4: verifyDocumentWithAuthority
//
// Enhanced KYC -- checks a document number against the issuing
// government's own database (Ghana NIA, Nigeria NIMC, etc.), no
// selfie/liveness required. Request shape follows the same
// token+multipart+async pattern confirmed for the other three endpoints;
// NOT individually verified against Smile ID's Enhanced KYC docs page
// this session -- confirm field names there before relying on this in
// production.
// ------------------------------------------------------------

export interface DocumentAuthorityInput {
  countryCode: string;
  documentType: string;
  documentNumber: string;
  givenNames: string;
  lastName: string;
  dateOfBirth?: string;
  email?: string;
  phone?: string;
  consent: ConsentInput;
}

export async function verifyDocumentWithAuthority(input: DocumentAuthorityInput): Promise<AcceptedJob> {
  const form = new FormData();
  form.append('country', input.countryCode.toUpperCase());
  form.append('id_type', input.documentType);
  form.append('id_number', input.documentNumber);
  form.append('consent', JSON.stringify(buildConsent(input.consent)));
  form.append(
    'user_details',
    JSON.stringify({
      given_names: input.givenNames,
      last_name: input.lastName,
      date_of_birth: input.dateOfBirth,
      email: input.email,
      phone_number: input.phone,
    })
  );
  const callbackUrl = process.env.SMILE_ID_CALLBACK_URL;
  if (callbackUrl) form.append('callback_url', callbackUrl);

  return submitJob('/v3/enhanced_kyc', 'enhanced_kyc', form);
}

// ------------------------------------------------------------
// Webhook payload parsing (used by Layer 4)
// ------------------------------------------------------------

export interface VerificationWebhookResult {
  status: 'clear' | 'block' | 'error' | 'processing';
  message: string;
  reason: string | null;
  product: string;
  /** From partner_params.huuid -- set by this codebase at submission time (initiateDocumentVerification), echoed back unchanged by Smile ID on every webhook for this job. The real, reliable correlation key -- Smile ID's own job_id isn't guaranteed to appear in the webhook body itself, only in the Job-ID header and the original AcceptedResponse. */
  huuid: string | null;
  extractedFullName: string | null;
  extractedDateOfBirth: string | null;
  documentNumber: string | null;
  documentExpiry: string | null;
  duplicateFace: DuplicateFaceResult;
  raw: unknown;
}

interface RawVerificationWebhook {
  status?: string;
  message?: string;
  reason?: string | null;
  product?: string;
  partner_params?: { huuid?: string };
  id_fields?: {
    full_name?: string;
    date_of_birth?: string;
    id_number?: string;
    expiration_date?: string;
  };
  antifraud?: { smile_secure?: SmileSecureWebhookField };
}

/** Turns a raw Smile ID verification webhook body into the shape the rest of this codebase (Layer 4's callback handler) works with. */
export function parseVerificationWebhook(payload: unknown): VerificationWebhookResult {
  const p = payload as RawVerificationWebhook;
  const status = p.status === 'clear' || p.status === 'block' || p.status === 'error' || p.status === 'processing'
    ? p.status
    : 'error';

  return {
    status,
    message: p.message ?? '',
    reason: p.reason ?? null,
    product: p.product ?? 'unknown',
    huuid: p.partner_params?.huuid ?? null,
    extractedFullName: p.id_fields?.full_name ?? null,
    extractedDateOfBirth: p.id_fields?.date_of_birth ?? null,
    documentNumber: p.id_fields?.id_number ?? null,
    documentExpiry: p.id_fields?.expiration_date ?? null,
    duplicateFace: checkForDuplicateFace(p.antifraud?.smile_secure),
    raw: payload,
  };
}

// ------------------------------------------------------------
// Webhook signature verification
//
// Per docs.usesmileid.com/developer-resources/essentials/verification-
// webhooks/receive-webhooks (fetched and confirmed 2026-08-11): Smile ID
// signs each webhook with HMAC-SHA256 over
// `${Response-Timestamp}${partner_id}sid_request`, keyed with the same
// SMILE_ID_API_KEY used to generate the original v3 token, base64-encoded,
// delivered in the Response-Signature header alongside Response-Timestamp.
// ------------------------------------------------------------

export function verifyWebhookSignature(params: { timestamp: string; signature: string }): boolean {
  const partnerId = process.env.SMILE_ID_PARTNER_ID;
  const apiKey = process.env.SMILE_ID_API_KEY;
  if (!partnerId || !apiKey) return false;

  const expected = createHmac('sha256', apiKey)
    .update(`${params.timestamp}${partnerId}sid_request`)
    .digest('base64');

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(params.signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
