import { NextRequest, NextResponse } from "next/server";

import { finitePhotoCrop, clampPhotoScale } from "@/lib/photoCropLayout";
import { ALLOWED_IMAGE_MIME, MAX_IMAGE_BYTES } from "@/lib/imageConstraints";
import {
  getAnimationSettings,
  listOverlayFilenames,
  renderLfgGif,
} from "@/lib/renderSticker";
import { shuffle } from "@/lib/shuffle";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ message: "Invalid form data" }, { status: 400 });
    }

    const file = formData.get("image");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ message: 'Expected file field "image"' }, { status: 400 });
    }

    const mime = file.type || "application/octet-stream";
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      return NextResponse.json(
        { message: `Unsupported type "${mime}". Use PNG, JPEG, or WebP.` },
        { status: 400 },
      );
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { message: `Image too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB).` },
        { status: 400 },
      );
    }

    const buffers = Buffer.from(await file.arrayBuffer());
    const overlays = listOverlayFilenames();
    if (overlays.length === 0) {
      return NextResponse.json({ message: "No LFG overlays configured." }, { status: 500 });
    }

    const { frameCount, frameDelayMs } = getAnimationSettings();
    if (overlays.length < frameCount) {
      return NextResponse.json(
        {
          message: `Need at least ${frameCount} PNGs in public/lfg (listed in lfgVariants.json). Found ${overlays.length}.`,
        },
        { status: 400 },
      );
    }

    const sequence = shuffle(overlays).slice(0, frameCount);

    const rawNx = parseFloat(String(formData.get("photoCropNormX") ?? ""));
    const rawNy = parseFloat(String(formData.get("photoCropNormY") ?? ""));
    const photoCrop = finitePhotoCrop({
      normX: Number.isFinite(rawNx) ? rawNx : 0.5,
      normY: Number.isFinite(rawNy) ? rawNy : 0.5,
    });
    const rawScale = parseFloat(
      String(formData.get("photoScale") ?? formData.get("photoZoom") ?? ""),
    );
    const photoScale = clampPhotoScale(Number.isFinite(rawScale) ? rawScale : 1);

    let gif: Buffer;
    try {
      gif = await renderLfgGif(buffers, sequence, frameDelayMs, photoCrop, photoScale);
    } catch (err) {
      console.error("renderLfgGif", err);
      const message =
        err instanceof Error ? err.message : "Could not render sticker.";
      return NextResponse.json({ message }, { status: 500 });
    }

    return new NextResponse(new Uint8Array(gif), {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Content-Disposition": 'attachment; filename="lfg-sticker.gif"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("POST /api/render", err);
    return NextResponse.json(
      {
        message:
          err instanceof Error ? err.message : "Unexpected server error.",
      },
      { status: 500 },
    );
  }
}
