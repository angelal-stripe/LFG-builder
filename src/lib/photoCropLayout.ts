export const STICKER_OUTPUT_SIZE = 100;

/** Display scale for GIF preview vs Slack reaction size (linear dimensions). */
export const SLACK_REACTION_PREVIEW_SCALE = 0.3;
export const SLACK_REACTION_PREVIEW_PX = Math.round(STICKER_OUTPUT_SIZE * SLACK_REACTION_PREVIEW_SCALE);

/**
 * Multiplier on “cover” scale (uniform): 1 = photo’s smaller side exactly fills the 100px frame; below 1 =
 * smaller photo (letterboxing); above 1 = larger photo (crop). The output frame is always STICKER_OUTPUT_SIZE².
 */
export const PHOTO_SCALE_MIN = 0.25;
export const PHOTO_SCALE_MAX = 4;
export const PHOTO_SCALE_DEFAULT = 1;

/** When the user pastes a new image: slightly zoomed out so the LFG strip isn’t tight on the face. */
export const INITIAL_PASTE_PHOTO_SCALE = 0.75;

export type PhotoCropNorm = {
  /**
   * Pan control: multiply by (scaled − out) in the crop case to get pixel offset of the view into the image.
   * Unbounded — values outside [0, 1] shift the view past the usual crop window (transparency or clip at export).
   */
  normX: number;
  normY: number;
};

/** Default framing after paste: horizontally centered, crop/view anchored to the top (typical headshot + banner). */
export const INITIAL_PASTE_CROP: PhotoCropNorm = { normX: 0.5, normY: 0 };

/**
 * Extra vertical shift applied after norm-based pan so preview and `/api/render` stay aligned.
 * **Negative** moves the photo **up** in the 100×100 frame (same as increasing translateY negatively in CSS).
 */
export const DEFAULT_FRAMING_OFFSET_Y_PX = -10;

/** Use for API + render: accept any finite pan; default 0.5 when missing/invalid. */
export function finitePhotoCrop(raw: Partial<PhotoCropNorm>): PhotoCropNorm {
  const f = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return { normX: f(raw.normX, 0.5), normY: f(raw.normY, 0.5) };
}

export function clampPhotoScale(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : PHOTO_SCALE_DEFAULT;
  return Math.min(PHOTO_SCALE_MAX, Math.max(PHOTO_SCALE_MIN, n));
}

export type StickerPhotoLayout = {
  scaledW: number;
  scaledH: number;
  /** scaled - out; negative slack means letterboxing fit on that axis. */
  deltaW: number;
  deltaH: number;
};

/**
 * Crop mode (image covers the square): pixel offset into the scaled bitmap.
 * When one axis has no slack (delta === 0), use the other axis so the user can still pan vertically/horizontally;
 * the overhanging image is clipped / transparent like the export.
 */
export function computeCropPanPixels(deltaW: number, deltaH: number, normX: number, normY: number) {
  const rangeX = deltaW !== 0 ? deltaW : deltaH;
  const rangeY = deltaH !== 0 ? deltaH : deltaW;
  return { wx: normX * rangeX, wy: normY * rangeY };
}

/** Letterbox / fit mode: position of top-left of scaled image inside the square. */
export function computeFitPanPixels(out: number, scaledW: number, scaledH: number, normX: number, normY: number) {
  const slackX = out - scaledW;
  const slackY = out - scaledH;
  const sx = slackX !== 0 ? slackX : slackY;
  const sy = slackY !== 0 ? slackY : slackX;
  return { left: normX * sx, top: normY * sy };
}

/** CSS translate(tx, ty) for the photo layer (absolute top-left 0,0). */
export function computeStickerPhotoPreviewTranslate(
  layout: StickerPhotoLayout,
  normX: number,
  normY: number,
  out = STICKER_OUTPUT_SIZE,
  framingOffsetYPx: number = DEFAULT_FRAMING_OFFSET_Y_PX,
): { tx: number; ty: number } {
  const { deltaW, deltaH, scaledW, scaledH } = layout;
  if (deltaW >= 0 && deltaH >= 0) {
    const { wx, wy } = computeCropPanPixels(deltaW, deltaH, normX, normY);
    return { tx: Math.round(-wx), ty: -Math.round(wy) + framingOffsetYPx };
  }
  const { left, top } = computeFitPanPixels(out, scaledW, scaledH, normX, normY);
  return { tx: Math.round(left), ty: Math.round(top) + framingOffsetYPx };
}

/**
 * Uniform scale = cover-scale × imageScale. `deltaW` / `deltaH` are scaled size minus output side.
 */
export function computeStickerPhotoLayout(
  naturalW: number,
  naturalH: number,
  out: number,
  imageScale: number,
): StickerPhotoLayout {
  const iw = Math.max(1, naturalW);
  const ih = Math.max(1, naturalH);
  const coverScale = Math.max(out / iw, out / ih);
  const z = clampPhotoScale(imageScale);
  const effectiveScale = coverScale * z;
  const scaledW = Math.ceil(iw * effectiveScale - 1e-9);
  const scaledH = Math.ceil(ih * effectiveScale - 1e-9);
  const deltaW = scaledW - out;
  const deltaH = scaledH - out;
  return { scaledW, scaledH, deltaW, deltaH };
}
