import sharp from "sharp";

import {
  finitePhotoCrop,
  clampPhotoScale,
  computeCropPanPixels,
  computeFitPanPixels,
  computeStickerPhotoLayout,
  DEFAULT_FRAMING_OFFSET_Y_PX,
  STICKER_OUTPUT_SIZE,
  type PhotoCropNorm,
} from "./photoCropLayout";

/**
 * Uniform scale, then a transparent square output. Crop mode uses extend+extract (Sharp disallows
 * compositing an image larger than the base onto a smaller canvas).
 */
export async function extractPhotoCover(
  imageBuffer: Buffer,
  crop: PhotoCropNorm,
  imageScale: number,
  outSize = STICKER_OUTPUT_SIZE,
): Promise<Buffer> {
  const { normX, normY } = finitePhotoCrop(crop);
  const z = clampPhotoScale(imageScale);
  const meta = await sharp(imageBuffer).metadata();
  const iw = meta.width ?? 1;
  const ih = meta.height ?? 1;

  const { scaledW, scaledH } = computeStickerPhotoLayout(iw, ih, outSize, z);

  const scaledBuf = await sharp(imageBuffer)
    .ensureAlpha()
    .resize(scaledW, scaledH, { fit: "fill" })
    .toBuffer();

  const actualMeta = await sharp(scaledBuf).metadata();
  const aw = Math.max(1, actualMeta.width ?? scaledW);
  const ah = Math.max(1, actualMeta.height ?? scaledH);
  const deltaWA = aw - outSize;
  const deltaHA = ah - outSize;

  const transparent = { r: 0, g: 0, b: 0, alpha: 0 } as const;

  if (deltaWA >= 0 && deltaHA >= 0) {
    const { wx, wy } = computeCropPanPixels(deltaWA, deltaHA, normX, normY);
    const rx = Math.round(wx);
    const ry = Math.round(wy) + DEFAULT_FRAMING_OFFSET_Y_PX;
    const needPadL = Math.max(0, -rx);
    const needPadT = Math.max(0, -ry);
    let needPadR = Math.max(0, rx + outSize - aw);
    let needPadB = Math.max(0, ry + outSize - ah);
    const exL = needPadL + rx;
    const exT = needPadT + ry;
    if (exL + outSize > aw + needPadL + needPadR) {
      needPadR += exL + outSize - (aw + needPadL + needPadR);
    }
    if (exT + outSize > ah + needPadT + needPadB) {
      needPadB += exT + outSize - (ah + needPadT + needPadB);
    }

    return sharp(scaledBuf)
      .extend({
        left: needPadL,
        top: needPadT,
        right: needPadR,
        bottom: needPadB,
        background: transparent,
      })
      .extract({
        left: needPadL + rx,
        top: needPadT + ry,
        width: outSize,
        height: outSize,
      })
      .ensureAlpha()
      .png()
      .toBuffer();
  }

  // Letterbox path composites onto an `outSize`² canvas; Sharp rejects any layer wider/taller than the base.
  // When scale lands in a "mixed" region (one side < outSize, the other > outSize), cap with `fit: inside` first.
  let letterboxBuf = scaledBuf;
  let lw = aw;
  let lh = ah;
  if (lw > outSize || lh > outSize) {
    letterboxBuf = await sharp(scaledBuf)
      .resize(outSize, outSize, {
        fit: "inside",
        background: transparent,
      })
      .ensureAlpha()
      .png()
      .toBuffer();
    const capMeta = await sharp(letterboxBuf).metadata();
    lw = Math.max(1, capMeta.width ?? lw);
    lh = Math.max(1, capMeta.height ?? lh);
  }

  const { left, top } = computeFitPanPixels(outSize, lw, lh, normX, normY);

  return sharp({
    create: {
      width: outSize,
      height: outSize,
      channels: 4,
      background: transparent,
    },
  })
    .composite([
      {
        input: letterboxBuf,
        left: Math.round(left),
        top: Math.round(top) + DEFAULT_FRAMING_OFFSET_Y_PX,
      },
    ])
    .ensureAlpha()
    .png()
    .toBuffer();
}
