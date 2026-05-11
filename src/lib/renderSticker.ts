import { existsSync } from "fs";
import { createRequire } from "module";
import path from "path";
import sharp from "sharp";

import layoutManifest from "./lfgLayout.json";
import variantsManifest from "./lfgVariants.json";
import { extractPhotoCover } from "./photoCrop";
import { clampPhotoScale, type PhotoCropNorm } from "./photoCropLayout";
import { flattenOntoWhite, unmatteWhiteBackground } from "./rgbaMatte";

export const OUTPUT_SIZE = 100;

type OverlayFit = "fill" | "contain" | "cover";

type OverlayPlacement = {
  left: number;
  top: number;
  width: number;
  height: number;
  fit: OverlayFit;
};

function clampOverlayPlacement(p: OverlayPlacement): OverlayPlacement {
  const left = Math.max(0, Math.min(OUTPUT_SIZE - 1, Math.round(p.left)));
  const top = Math.max(0, Math.min(OUTPUT_SIZE - 1, Math.round(p.top)));
  const width = Math.max(1, Math.round(p.width));
  const height = Math.max(1, Math.round(p.height));
  const fit = p.fit === "contain" || p.fit === "cover" ? p.fit : "fill";
  return {
    left,
    top,
    width: Math.min(width, OUTPUT_SIZE - left),
    height: Math.min(height, OUTPUT_SIZE - top),
    fit,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseFit(v: unknown): OverlayFit {
  return v === "contain" || v === "cover" ? v : "fill";
}

function partialToPlacement(raw: Record<string, unknown> | undefined): OverlayPlacement {
  return clampOverlayPlacement({
    left: num(raw?.left, 0),
    top: num(raw?.top, 0),
    width: num(raw?.width, OUTPUT_SIZE),
    height: num(raw?.height, OUTPUT_SIZE),
    fit: parseFit(raw?.fit),
  });
}

function placementForFile(filename: string): OverlayPlacement {
  const manifest = layoutManifest as {
    overlay?: Record<string, unknown>;
    perFile?: Record<string, Record<string, unknown>>;
  };
  const baseRaw = manifest.overlay ?? {};
  const base = partialToPlacement(baseRaw);
  const overrideRaw = manifest.perFile?.[filename];
  if (!overrideRaw) {
    return base;
  }
  return partialToPlacement({ ...baseRaw, ...overrideRaw });
}

const require = createRequire(import.meta.url);
const GIFEncoder = require("gif-encoder-2") as new (
  width: number,
  height: number,
  algorithm?: string,
) => {
  start(): void;
  setRepeat(n: number): void;
  setDelay(ms: number): void;
  setQuality(q: number): void;
  addFrame(data: Uint8ClampedArray | Buffer): void;
  finish(): void;
  out: { getData(): Buffer };
};

export function listOverlayFilenames(): readonly string[] {
  return variantsManifest.files;
}

/** How many LFG variants per GIF and pause between frames (gif-encoder-2 `setDelay` = ms). */
export function getAnimationSettings(): { frameCount: number; frameDelayMs: number } {
  const manifest = variantsManifest as { animation?: Record<string, unknown> };
  const anim = manifest.animation;
  const frameCount = Math.max(2, Math.min(50, Math.floor(num(anim?.frameCount, 5))));
  const frameDelayMs = Math.max(20, Math.min(5000, Math.floor(num(anim?.frameDelayMs, 120))));
  return { frameCount, frameDelayMs };
}

export type { PhotoCropNorm } from "./photoCropLayout";

export async function renderLfgGif(
  imageBuffer: Buffer,
  overlayFilenames: readonly string[],
  frameDelayMs: number,
  photoCrop: PhotoCropNorm,
  photoScale: number,
): Promise<Buffer> {
  if (overlayFilenames.length === 0) {
    throw new Error("No overlay frames selected.");
  }

  for (const name of overlayFilenames) {
    const overlayPath = path.join(process.cwd(), "public", "lfg", name);
    if (!existsSync(overlayPath)) {
      throw new Error(`LFG overlay file missing: "${name}". Update src/lib/lfgVariants.json and public/lfg/.`);
    }
  }

  const scale = clampPhotoScale(photoScale);
  const photo = await extractPhotoCover(imageBuffer, photoCrop, scale, OUTPUT_SIZE);

  const encoder = new GIFEncoder(OUTPUT_SIZE, OUTPUT_SIZE, "neuquant");
  encoder.setRepeat(0);
  encoder.setDelay(frameDelayMs);
  encoder.setQuality(10);
  encoder.start();

  for (const overlayFilename of overlayFilenames) {
    const placement = placementForFile(overlayFilename);
    const overlayPath = path.join(process.cwd(), "public", "lfg", overlayFilename);

    const overlayRaw = await sharp(overlayPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const overlayPx = new Uint8ClampedArray(overlayRaw.data.length);
    overlayPx.set(overlayRaw.data);
    unmatteWhiteBackground(overlayPx);

    const overlay = await sharp(Buffer.from(overlayPx), {
      raw: {
        width: overlayRaw.info.width!,
        height: overlayRaw.info.height!,
        channels: 4,
      },
    })
      .resize(placement.width, placement.height, {
        fit: placement.fit,
        position: "centre",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .png()
      .toBuffer();

    const rgba = await sharp({
      create: {
        width: OUTPUT_SIZE,
        height: OUTPUT_SIZE,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([
        { input: photo, blend: "over" },
        { input: overlay, blend: "over", left: placement.left, top: placement.top },
      ])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (rgba.info.width !== OUTPUT_SIZE || rgba.info.height !== OUTPUT_SIZE) {
      throw new Error("Unexpected composite dimensions");
    }
    if (rgba.info.channels !== 4) {
      throw new Error("Expected RGBA raw output");
    }

    const gifFrame = new Uint8ClampedArray(rgba.data.length);
    gifFrame.set(rgba.data);
    flattenOntoWhite(gifFrame);
    encoder.addFrame(gifFrame);
  }

  encoder.finish();
  return encoder.out.getData();
}
