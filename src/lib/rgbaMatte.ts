/**
 * LFG PNGs from Figma often anti-alias strokes against a white artboard. Those edge pixels are stored as
 * light RGB with partial alpha. When composited on darker pixels—or quantized for GIF—they read as a white
 * halo around black borders. These helpers recover cleaner straight-alpha RGB from an assumed white matte
 * and drop residual near-white semitransparent speckles before GIF encoding (GIF only has one transparent colour).
 */

/** Recover straight-alpha foreground RGB from pixels that were blended on white before export. */
export function unmatteWhiteBackground(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const aByte = rgba[i + 3];
    if (aByte === 0) continue;

    const a = aByte / 255;
    // Still skip true opaque to avoid touching solid fills; halos are almost never a=255 after export.
    if (a >= 0.999) continue;

    // Kill very faint fringe before divide (raised threshold = more aggressive clip).
    if (a < 0.1) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      rgba[i + 3] = 0;
      continue;
    }

    let r = rgba[i];
    let g = rgba[i + 1];
    let b = rgba[i + 2];

    // rgb ≈ alpha * fg + (1-alpha) * 255  →  fg = (rgb - 255*(1-a)) / a
    r = Math.round((r - 255 * (1 - a)) / a);
    g = Math.round((g - 255 * (1 - a)) / a);
    b = Math.round((b - 255 * (1 - a)) / a);

    if (
      !Number.isFinite(r) ||
      !Number.isFinite(g) ||
      !Number.isFinite(b) ||
      r < 0 ||
      g < 0 ||
      b < 0 ||
      r > 255 ||
      g > 255 ||
      b > 255
    ) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      rgba[i + 3] = 0;
      continue;
    }

    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;

    // After unmatted, residual “almost white” edge → force transparent (GIF turns these into bright spots).
    const lum = (r + g + b) / 3;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (aByte < 255 && lum > 188 && mx > 195 && mx - mn < 42) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      rgba[i + 3] = 0;
    }
  }
}

/**
 * Blend every pixel onto white and force alpha = 255 so GIF output has **no** transparent index (avoids
 * NeuQuant mapping real colors to “transparent” and removes letterbox/overlay fringes as solid white).
 */
export function flattenOntoWhite(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    rgba[i] = Math.round(rgba[i] * a + 255 * (1 - a));
    rgba[i + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
    rgba[i + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
    rgba[i + 3] = 255;
  }
}

/**
 * NeuQuant + single transparent index turns leftover near-white pixels into opaque rings / speckles.
 * (Used only if we ever reintroduce a single transparent-colour GIF export.)
 */
export function flattenGhostWhiteFringe(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 0) continue;

    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = (r + g + b) / 3;
    const sat = max - min;

    if (a < 255) {
      // Semi-transparent: broader neutral-bright band (matte + composite bleed).
      if (
        (lum > 168 && max > 178 && sat < 52) ||
        (lum > 155 && sat < 22 && max > 168)
      ) {
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
        rgba[i + 3] = 0;
      }
      continue;
    }

    // Opaque: GIF often snaps halos to nearly-white gray (not #ffffff — that’s intentional LFG letters).
    if (lum > 218 && lum < 252 && sat < 38 && min > 165) {
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      rgba[i + 3] = 0;
    }
  }
}
