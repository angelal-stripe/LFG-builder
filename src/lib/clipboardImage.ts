import {
  ALLOWED_IMAGE_DESCRIPTION,
  ALLOWED_IMAGE_MIME,
} from "@/lib/imageConstraints";

export type ClipboardReadResult =
  | { ok: true; blob: Blob; mime: string }
  | { ok: false; reason: "empty" | "text_only" | "unsupported" | "permission"; detail?: string };

export function clipboardFailureMessage(result: Extract<ClipboardReadResult, { ok: false }>): string {
  switch (result.reason) {
    case "empty":
      return `Your clipboard is empty or doesn't contain an image. Copy an image in ${ALLOWED_IMAGE_DESCRIPTION} format, then try again.`;
    case "text_only":
      return `Your clipboard has text, not an image. Copy an image (${ALLOWED_IMAGE_DESCRIPTION}), then try again.`;
    case "unsupported":
      return `Your clipboard doesn't contain a supported image type (${ALLOWED_IMAGE_DESCRIPTION}).${
        result.detail ? ` Found: ${result.detail}.` : ""
      }`;
    case "permission":
      return "Couldn't read the clipboard (permission denied). Paste your image on this page with ⌘V / Ctrl+V to preview, then click Generate again—or allow clipboard access for this site.";
    default:
      return `Copy an image (${ALLOWED_IMAGE_DESCRIPTION}), then try again.`;
  }
}

export async function readClipboardImage(): Promise<ClipboardReadResult> {
  try {
    const items = await navigator.clipboard.read();
    if (items.length === 0) {
      return { ok: false, reason: "empty" };
    }

    const allTypes = [...new Set(items.flatMap((i) => [...i.types]))];

    for (const item of items) {
      for (const mime of ALLOWED_IMAGE_MIME) {
        if (item.types.includes(mime)) {
          const blob = await item.getType(mime);
          return { ok: true, blob, mime };
        }
      }
    }

    const hasPlainText = allTypes.includes("text/plain");
    const imageTypes = allTypes.filter((t) => t.startsWith("image/"));
    const nonAllowedImages = imageTypes.filter((t) => !ALLOWED_IMAGE_MIME.has(t));

    if (hasPlainText && imageTypes.length === 0) {
      return { ok: false, reason: "text_only" };
    }

    if (nonAllowedImages.length > 0) {
      return { ok: false, reason: "unsupported", detail: nonAllowedImages.join(", ") };
    }

    if (imageTypes.length > 0) {
      return { ok: false, reason: "unsupported", detail: imageTypes.join(", ") };
    }

    return {
      ok: false,
      reason: "unsupported",
      detail: allTypes.length ? allTypes.join(", ") : undefined,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      return { ok: false, reason: "permission" };
    }
    return { ok: false, reason: "empty" };
  }
}

export function revokeObjectUrlsOnce(urls: readonly (string | null)[]) {
  const seen = new Set<string>();
  for (const u of urls) {
    if (u && u.startsWith("blob:") && !seen.has(u)) {
      seen.add(u);
      URL.revokeObjectURL(u);
    }
  }
}
