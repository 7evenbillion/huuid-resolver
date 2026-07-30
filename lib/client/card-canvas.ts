/**
 * Renders the Healthcare Identity Card to an HTML canvas — used for both
 * PNG export and as the source image dropped into the PDF. Drawn with the
 * native Canvas API rather than snapshotting the DOM card (which would
 * need html2canvas, another new dependency) — this keeps card rendering
 * to one function, reused by both export paths, with zero extra
 * dependencies beyond qrcode/jsPDF already added for this build.
 *
 * Sized 2x for retina per the Definition of Done ("PNG... high resolution
 * (2x for retina)"). Card proportions loosely follow ISO/IEC 7810 ID-1
 * (85.6mm x 53.98mm) at ~2x scale for on-screen/PNG use; the PDF export
 * places this same raster at the exact ID-1 physical size.
 */

const TEAL = '#0A6E5F';
const NAVY = '#1B3A6B';
const GREY_BG = '#F8F9FA';
const TEXT_GREY = '#5A6472';
const WHITE = '#FFFFFF';
const DANGER_RED = '#B3261E';

export const CARD_WIDTH = 856; // 85.6mm at 10px/mm
export const CARD_HEIGHT = 540; // 53.98mm at 10px/mm

export interface CardMedicalData {
  bloodType?: string | null;
  /** First/most severe allergy substance only -- card face has no room for a full list. */
  allergySubstance?: string | null;
  /** Contraindication substances with severity 'never' -- the most safety-critical field. */
  doNotGiveSubstances?: string[];
}

export interface CardData {
  fullName: string;
  huuid: string;
  countryFlag: string;
  countryName: string;
  tierLabel: string;
  enrollmentDate: string;
  qrDataUrl: string;
  medical?: CardMedicalData;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export async function renderCardToCanvas(canvas: HTMLCanvasElement, data: CardData): Promise<void> {
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const topBarH = 90;
  const bottomBarH = 70;
  const footerH = 40;
  const bodyH = CARD_HEIGHT - topBarH - bottomBarH - footerH;

  // Body background
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Top bar
  ctx.fillStyle = TEAL;
  ctx.fillRect(0, 0, CARD_WIDTH, topBarH);
  ctx.fillStyle = WHITE;
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('HUUID', 28, 42);
  ctx.font = '13px system-ui, sans-serif';
  ctx.globalAlpha = 0.9;
  ctx.fillText('Human Universal Identity Directory', 28, 64);
  ctx.globalAlpha = 1;
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('HEALTHCARE IDENTITY', CARD_WIDTH - 28, 50);
  ctx.textAlign = 'left';

  // Body
  const bodyTop = topBarH + 24;
  ctx.fillStyle = TEXT_GREY;
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(`${data.countryFlag}  ${data.countryName}`, 28, bodyTop + 14);

  ctx.fillStyle = NAVY;
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText(truncate(data.fullName, 22), 28, bodyTop + 56);

  ctx.fillStyle = TEAL;
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.fillText('Healthcare Identity', 28, bodyTop + 84);

  ctx.fillStyle = TEXT_GREY;
  ctx.font = '13px ui-monospace, monospace';
  ctx.fillText(truncate(data.huuid, 34), 28, bodyTop + 108);

  // QR code
  try {
    const qrImg = await loadImage(data.qrDataUrl);
    const qrSize = 150;
    const qrX = CARD_WIDTH - qrSize - 32;
    const qrY = bodyTop;
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    ctx.fillStyle = TEXT_GREY;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Scan to verify', qrX + qrSize / 2, qrY + qrSize + 18);
    ctx.textAlign = 'left';
  } catch {
    // QR image failed to load -- card still renders with all text fields, just without the QR graphic.
  }

  // Medical strip -- drawn between the HUUID/QR row and the bottom bar.
  // DO NOT GIVE is the single most safety-critical field on the card, so it
  // gets its own full-width red bar (not just another line of text) when
  // present; blood type/allergy share a lighter line below it.
  const medical = data.medical;
  // Must clear the "Scan to verify" caption below the QR (qrY + qrSize + 18,
  // i.e. bodyTop + 168) -- an earlier version of this strip started at
  // bodyTop + 130 and visually overlapped that caption.
  let medicalY = bodyTop + 180;
  if (medical?.doNotGiveSubstances?.length) {
    const barH = 36;
    ctx.fillStyle = DANGER_RED;
    ctx.fillRect(28, medicalY, CARD_WIDTH - 56, barH);
    ctx.fillStyle = WHITE;
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      truncate(`🚫 DO NOT GIVE: ${medical.doNotGiveSubstances.join(', ')}`, 46),
      40,
      medicalY + barH / 2 + 1
    );
    ctx.textBaseline = 'alphabetic';
    medicalY += barH + 12;
  }
  if (medical?.bloodType && medical.bloodType !== 'unknown') {
    ctx.fillStyle = NAVY;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText(`🩸 ${medical.bloodType}`, 28, medicalY + 14);
  }
  if (medical?.allergySubstance) {
    const bloodTypeWidth = medical?.bloodType && medical.bloodType !== 'unknown' ? 90 : 0;
    ctx.fillStyle = DANGER_RED;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText(truncate(`⚠️ ALLERGY: ${medical.allergySubstance}`, 34), 28 + bloodTypeWidth, medicalY + 14);
  }

  // Bottom bar
  const bottomY = topBarH + bodyH;
  ctx.fillStyle = GREY_BG;
  ctx.fillRect(0, bottomY, CARD_WIDTH, bottomBarH);
  ctx.fillStyle = TEAL;
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillText(`🛡 ${data.tierLabel}`, 28, bottomY + 30);
  ctx.fillStyle = TEXT_GREY;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('Self-Enrolled', 28, bottomY + 48);
  ctx.textAlign = 'right';
  ctx.fillText(data.enrollmentDate, CARD_WIDTH - 28, bottomY + 40);
  ctx.textAlign = 'left';

  // Footer
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, bottomY + bottomBarH, CARD_WIDTH, footerH);
  ctx.fillStyle = WHITE;
  ctx.font = 'italic 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Identity travels. Records stay.', CARD_WIDTH / 2, bottomY + bottomBarH + 25);
  ctx.textAlign = 'left';
}

export function downloadCanvasAsPng(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/**
 * ============================================================
 * PHYSICAL CARD (print/lamination target) -- redesigned to fit
 * emergency medical info at ID-1 (85.6mm x 53.98mm) size.
 *
 * Fully additive: renderCardToCanvas/CardData/CARD_WIDTH/CARD_HEIGHT
 * above are untouched. This is a separate render path with its own
 * dimensions, drawn by app/enroll/card/page.tsx's "Print & Download"
 * tab instead of the old function -- the on-screen "Digital Card" tab
 * (components/enroll/IdentityCard.tsx) and QR token generation
 * (lib/qr-token.ts) are both unmodified; this file only draws pixels
 * from data those two produce.
 *
 * PIXEL SCALE NOTE (read before changing any number below): the given
 * spec's row heights (header 52 / DO NOT GIVE 36 / footer 28) were
 * explicitly marked "(at 3x canvas)" -- i.e. literal pixels on this
 * 969x612 canvas -- and are used literally. Font sizes were NOT marked
 * that way, and taken as literal canvas pixels they compute to roughly
 * 3.5-4.5pt at this canvas's ~11.32px/mm (300dpi-equivalent) scale
 * (e.g. the spec's 9px DO NOT GIVE bar text: 9/11.32mm cap-height ->
 * ~3.2pt) -- well under the ~6pt floor normal for print body text, on
 * the one card a clinician reads off an unconscious patient. Rather
 * than draw the spec's literal sizes first and rediscover that by eye,
 * this went straight to enlarged sizes below (patient name 20px, blood
 * type 22px, DO NOT GIVE bar 15px -- roughly doubled from spec, with
 * blood type and the DO NOT GIVE bar weighted heaviest since those are
 * the two facts that can prevent an in-field medication error), then
 * confirmed legible against a real exported PNG at actual pixel size
 * (see docs/HANDOFF.md for the specific check). Do not shrink these
 * back toward the original spec numbers without re-checking a real
 * exported PNG at actual size.
 */

const RED = '#CC0000';
const AMBER = '#B45309';
const GREEN = '#166534';
const DARK_GREY = '#374151';

export const PHYSICAL_CARD_WIDTH = 969; // 85.6mm at ~11.32px/mm (3x of 96dpi == 300dpi-equivalent)
export const PHYSICAL_CARD_HEIGHT = 612; // 53.98mm at the same scale

const PC_HEADER_H = 52;
const PC_DNG_H = 36;
const PC_FOOTER_H = 28;
const PC_MARGIN = 8;

export interface PhysicalCardAllergy {
  substance: string;
  severity?: string | null;
}

export interface PhysicalCardMedicalData {
  bloodType?: string | null;
  /** Pre-filtered by the caller to severity === 'life-threatening' only -- this function does not re-filter. */
  criticalAllergies?: PhysicalCardAllergy[];
  chronicConditions?: string[];
  implantedDevices?: string[];
  organDonor?: string | null;
  pregnancyStatus?: string | null;
  /** Contraindication substances with severity 'never'. */
  doNotGive?: string[];
  medicalProfileCompleted?: boolean;
}

export interface PhysicalCardData {
  fullName: string;
  huuid: string;
  tierNumber: number;
  issuedDate: Date;
  qrDataUrl: string;
  medical?: PhysicalCardMedicalData | null;
}

/** Hand-drawn shield path (not the 🛡 emoji) so the header brand mark renders as a consistent monochrome shape regardless of the OS's emoji font -- same reasoning as the on-screen Icon.tsx set. */
function drawShieldIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const w = size;
  const h = size * 1.15;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w, h * 0.2);
  ctx.lineTo(w, h * 0.55);
  ctx.quadraticCurveTo(w, h * 0.88, w / 2, h);
  ctx.quadraticCurveTo(0, h * 0.88, 0, h * 0.55);
  ctx.lineTo(0, h * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** "A, B" if <= max items; "A, B +N more" past that -- shared by the allergy line and the DO NOT GIVE bar (different max/joiner per caller). */
function joinWithOverflow(items: string[], max: number, joiner: string, overflowFormat: (n: number) => string): string {
  if (items.length <= max) return items.join(joiner);
  return items.slice(0, max).join(joiner) + overflowFormat(items.length - max);
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + '…';
    if (ctx.measureText(candidate).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo <= 0 ? '…' : text.slice(0, lo) + '…';
}

export async function renderPhysicalCardToCanvas(canvas: HTMLCanvasElement, data: PhysicalCardData): Promise<void> {
  canvas.width = PHYSICAL_CARD_WIDTH;
  canvas.height = PHYSICAL_CARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  const medical = data.medical ?? null;
  const doNotGive = medical?.doNotGive ?? [];
  const hasDoNotGive = doNotGive.length > 0;
  const isComplete = !!medical?.medicalProfileCompleted;

  const dngH = hasDoNotGive ? PC_DNG_H : 0;
  const contentY0 = PC_HEADER_H + dngH;
  const contentH = PHYSICAL_CARD_HEIGHT - PC_HEADER_H - dngH - PC_FOOTER_H;

  // Background
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, PHYSICAL_CARD_WIDTH, PHYSICAL_CARD_HEIGHT);

  // ---------- Row 1: header ----------
  ctx.fillStyle = TEAL;
  ctx.fillRect(0, 0, PHYSICAL_CARD_WIDTH, PC_HEADER_H);

  const shieldSize = 22;
  drawShieldIcon(ctx, PC_MARGIN, (PC_HEADER_H - shieldSize * 1.15) / 2, shieldSize, WHITE);

  const brandX = PC_MARGIN + shieldSize + 8;
  ctx.fillStyle = WHITE;
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText('HUUID', brandX, 24);
  ctx.font = '9px system-ui, sans-serif';
  ctx.globalAlpha = 0.85;
  ctx.fillText('Human Universal Identity Directory', brandX, 36);
  ctx.globalAlpha = 1;

  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  try {
    // Canvas 2D Level 2 API -- Chrome/Edge support it; older engines silently
    // ignore the assignment and just render without letter-spacing.
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '1px';
  } catch {
    // no-op -- letterSpacing unsupported on this engine
  }
  ctx.fillText('HEALTHCARE IDENTITY', PHYSICAL_CARD_WIDTH - PC_MARGIN, 30);
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
  } catch {
    // no-op
  }
  ctx.textAlign = 'left';

  // ---------- Row 2: DO NOT GIVE bar ----------
  if (hasDoNotGive) {
    ctx.fillStyle = RED;
    ctx.fillRect(0, PC_HEADER_H, PHYSICAL_CARD_WIDTH, PC_DNG_H);
    ctx.fillStyle = WHITE;
    ctx.font = 'bold 19px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const dngText = `🚫 DO NOT GIVE: ${joinWithOverflow(doNotGive, 3, ' · ', (n) => ` ...and ${n} more`)}`;
    ctx.fillText(truncateToWidth(ctx, dngText, PHYSICAL_CARD_WIDTH - PC_MARGIN * 2), PC_MARGIN, PC_HEADER_H + PC_DNG_H / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // ---------- Row 3: content (QR left, medical right) ----------
  const contentX0 = PC_MARGIN;
  const contentW = PHYSICAL_CARD_WIDTH - PC_MARGIN * 2;
  const leftColW = Math.round(contentW * 0.38);
  const rightColX = contentX0 + leftColW + PC_MARGIN;
  const rightColW = contentX0 + contentW - rightColX;

  const captionH = 22;
  const qrSize = Math.min(leftColW, contentH - captionH);
  const qrX = contentX0 + (leftColW - qrSize) / 2;
  const qrY = contentY0 + Math.max(0, (contentH - captionH - qrSize) / 2);

  try {
    const qrImg = await loadImage(data.qrDataUrl);
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    ctx.fillStyle = DARK_GREY;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Scan to verify', qrX + qrSize / 2, qrY + qrSize + 16);
    ctx.textAlign = 'left';
  } catch {
    // QR image failed to load -- card still renders with all text fields, just without the QR graphic.
  }

  // Right column: sequential lines, skipping whatever doesn't apply so the
  // profile compacts upward rather than leaving gaps (spec's own framing
  // for the DO NOT GIVE bar -- "extra space goes to content row" -- applied
  // the same way to every optional line here).
  let ry = contentY0 + 10;
  const rightRight = rightColX + rightColW;

  ctx.fillStyle = NAVY;
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(truncateToWidth(ctx, data.fullName, rightColW), rightColX, ry + 22);
  ry += 38;

  if (!isComplete) {
    ctx.fillStyle = AMBER;
    ctx.font = 'italic bold 17px system-ui, sans-serif';
    ctx.fillText('⚠️ Medical info not added', rightColX, ry + 14);
    ry += 24;
    ctx.fillStyle = DARK_GREY;
    ctx.font = 'italic 15px system-ui, sans-serif';
    ctx.fillText('Scan QR for identity only', rightColX, ry + 13);
    ry += 20;
  } else {
    if (medical?.bloodType && medical.bloodType !== 'unknown') {
      ctx.fillStyle = RED;
      ctx.font = 'bold 32px system-ui, sans-serif';
      ctx.fillText(`🩸 ${medical.bloodType}`, rightColX, ry + 25);
      ry += 40;
    }

    const critical = medical?.criticalAllergies ?? [];
    if (critical.length > 0) {
      ctx.fillStyle = AMBER;
      ctx.font = 'bold 19px system-ui, sans-serif';
      const allergyText = `⚠️ ${joinWithOverflow(critical.map((a) => a.substance), 2, ', ', (n) => ` +${n} more`)}`;
      ctx.fillText(truncateToWidth(ctx, allergyText, rightColW), rightColX, ry + 16);
      ry += 27;
    }

    const conditions = medical?.chronicConditions ?? [];
    const hasCond = (needle: string) => conditions.some((c) => c.toLowerCase().includes(needle));
    const conditionIcons: string[] = [];
    if (hasCond('diabetes')) conditionIcons.push('💊');
    if (hasCond('heart')) conditionIcons.push('❤️');
    if (hasCond('epilepsy')) conditionIcons.push('🧠');
    if (conditions.some((c) => !/diabetes|heart|epilepsy/i.test(c))) conditionIcons.push('🩺');
    if (conditionIcons.length > 0) {
      ctx.fillStyle = DARK_GREY;
      ctx.font = '22px system-ui, sans-serif';
      ctx.fillText(conditionIcons.slice(0, 4).join('  '), rightColX, ry + 18);
      ry += 30;
    }

    const devices = medical?.implantedDevices ?? [];
    const hasPacemaker = devices.includes('Pacemaker');
    const hasInsulinPump = devices.includes('Insulin Pump');
    const otherDevices = devices.filter((d) => d !== 'Pacemaker' && d !== 'Insulin Pump');
    if (hasPacemaker || hasInsulinPump || otherDevices.length > 0) {
      let dx = rightColX;
      ctx.font = 'bold 19px system-ui, sans-serif';
      if (hasPacemaker) {
        ctx.fillStyle = RED;
        ctx.fillText('⚡ PACEMAKER', dx, ry + 16);
        dx += ctx.measureText('⚡ PACEMAKER').width + 14;
      }
      if (hasInsulinPump) {
        ctx.fillStyle = NAVY;
        ctx.fillText('💉 INSULIN PUMP', dx, ry + 16);
        dx += ctx.measureText('💉 INSULIN PUMP').width + 14;
      }
      if (otherDevices.length > 0 && dx < rightRight) {
        ctx.fillStyle = NAVY;
        ctx.font = '16px system-ui, sans-serif';
        ctx.fillText(truncateToWidth(ctx, otherDevices.join(', '), rightRight - dx), dx, ry + 16);
      }
      ry += 27;
    }

    if (medical?.organDonor === 'yes') {
      ctx.fillStyle = GREEN;
      ctx.font = '17px system-ui, sans-serif';
      ctx.fillText('💚 ORGAN DONOR', rightColX, ry + 14);
      ry += 23;
    }

    if (medical?.pregnancyStatus === 'pregnant') {
      ctx.fillStyle = NAVY;
      ctx.font = 'bold 19px system-ui, sans-serif';
      ctx.fillText('🤰 PREGNANT', rightColX, ry + 16);
      ry += 26;
    }
  }

  // ---------- Row 4: footer ----------
  const footerY = PHYSICAL_CARD_HEIGHT - PC_FOOTER_H;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, footerY, PHYSICAL_CARD_WIDTH, PC_FOOTER_H);
  ctx.fillStyle = WHITE;

  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(truncateToWidth(ctx, data.huuid, PHYSICAL_CARD_WIDTH * 0.4), PC_MARGIN, footerY + 18);

  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`🛡 Tier ${data.tierNumber}`, PHYSICAL_CARD_WIDTH / 2, footerY + 18);

  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  const issued = `${String(data.issuedDate.getMonth() + 1).padStart(2, '0')}/${data.issuedDate.getFullYear()}`;
  ctx.fillText(`Issued ${issued}`, PHYSICAL_CARD_WIDTH - PC_MARGIN, footerY + 18);
  ctx.textAlign = 'left';
}

/** Renders onto `canvas` (mutating it) and returns it, matching the existing buildCanvas() pattern in app/enroll/card/page.tsx. */
export async function buildPhysicalCard(canvas: HTMLCanvasElement, data: PhysicalCardData): Promise<HTMLCanvasElement> {
  await renderPhysicalCardToCanvas(canvas, data);
  return canvas;
}

export function downloadPhysicalCardPNG(canvas: HTMLCanvasElement, filename: string): void {
  downloadCanvasAsPng(canvas, filename);
}

/**
 * jsPDF page sized to the exact ISO/IEC 7810 ID-1 physical dimensions, no
 * margins -- the canvas (969x612, ~300dpi-equivalent at that physical
 * size) is placed to fill the page exactly. Async and dynamic-imports
 * jsPDF so this file has no build-time cost for callers that only need
 * the PNG path.
 */
export async function downloadPhysicalCardPDF(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: [85.6, 53.98], orientation: 'landscape' });
  const imgData = canvas.toDataURL('image/png');
  doc.addImage(imgData, 'PNG', 0, 0, 85.6, 53.98);
  doc.save(filename);
}
