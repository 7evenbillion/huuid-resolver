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
