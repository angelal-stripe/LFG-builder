"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clipboardFailureMessage,
  readClipboardImage,
  revokeObjectUrlsOnce,
} from "@/lib/clipboardImage";
import {
  ALLOWED_IMAGE_DESCRIPTION,
  ALLOWED_IMAGE_MIME,
  MAX_IMAGE_BYTES,
} from "@/lib/imageConstraints";
import {
  clampPhotoScale,
  computeStickerPhotoLayout,
  computeStickerPhotoPreviewTranslate,
  INITIAL_PASTE_CROP,
  INITIAL_PASTE_PHOTO_SCALE,
  PHOTO_SCALE_MAX,
  PHOTO_SCALE_MIN,
  SLACK_REACTION_PREVIEW_PX,
  SLACK_REACTION_PREVIEW_SCALE,
  STICKER_OUTPUT_SIZE,
} from "@/lib/photoCropLayout";
import lfgVariants from "@/lib/lfgVariants.json";

type PastedImage = { blob: Blob; mime: string };

const LFG_GUIDE_OVERLAY_SRC =
  lfgVariants.files.length > 0 ? `/lfg/${lfgVariants.files[0]}` : "/lfg/1.png";

export default function Home() {
  const [pastedImage, setPastedImage] = useState<PastedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [gifPreviewUrl, setGifPreviewUrl] = useState<string | null>(null);
  const [cropNorm, setCropNorm] = useState(INITIAL_PASTE_CROP);
  const [photoScale, setPhotoScale] = useState(INITIAL_PASTE_PHOTO_SCALE);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const photoPreviewUrlRef = useRef<string | null>(null);
  const gifPreviewUrlRef = useRef<string | null>(null);
  const cropFrameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startNormX: number;
    startNormY: number;
    rangeX: number;
    rangeY: number;
  } | null>(null);

  useEffect(() => {
    photoPreviewUrlRef.current = photoPreviewUrl;
  }, [photoPreviewUrl]);

  useEffect(() => {
    gifPreviewUrlRef.current = gifPreviewUrl;
  }, [gifPreviewUrl]);

  useEffect(() => {
    setNaturalSize(null);
  }, [photoPreviewUrl]);

  useEffect(() => {
    return () => revokeObjectUrlsOnce([photoPreviewUrlRef.current, gifPreviewUrlRef.current]);
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (busy) return;

      const cd = e.clipboardData;
      if (!cd?.items?.length) return;

      for (let i = 0; i < cd.items.length; i++) {
        const item = cd.items[i];
        if (item.kind !== "file") continue;
        const f = item.getAsFile();
        if (!f) continue;
        if (ALLOWED_IMAGE_MIME.has(f.type)) {
          e.preventDefault();
          setError(null);
          revokeObjectUrlsOnce([photoPreviewUrlRef.current, gifPreviewUrlRef.current]);
          setGifPreviewUrl(null);
          setCropNorm(INITIAL_PASTE_CROP);
          setPhotoScale(INITIAL_PASTE_PHOTO_SCALE);
          const u = URL.createObjectURL(f);
          setPhotoPreviewUrl(u);
          setPastedImage({ blob: f, mime: f.type });
          return;
        }
      }

      let sawUnsupportedImage = false;
      for (let i = 0; i < cd.items.length; i++) {
        const item = cd.items[i];
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f?.type.startsWith("image/") && !ALLOWED_IMAGE_MIME.has(f.type)) {
            sawUnsupportedImage = true;
            break;
          }
        }
      }
      if (sawUnsupportedImage) {
        e.preventDefault();
        setError(
          `Pasted image isn't a supported format (${ALLOWED_IMAGE_DESCRIPTION}). Your clipboard must contain ${ALLOWED_IMAGE_DESCRIPTION}.`,
        );
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [busy]);

  const pasteFromClipboard = useCallback(async () => {
    if (busy) return;
    setError(null);

    const read = await readClipboardImage();
    if (!read.ok) {
      setError(clipboardFailureMessage(read));
      return;
    }

    if (read.blob.size > MAX_IMAGE_BYTES) {
      setError(`Image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB).`);
      return;
    }

    revokeObjectUrlsOnce([photoPreviewUrlRef.current, gifPreviewUrlRef.current]);
    setGifPreviewUrl(null);
    setCropNorm(INITIAL_PASTE_CROP);
    setPhotoScale(INITIAL_PASTE_PHOTO_SCALE);
    const u = URL.createObjectURL(read.blob);
    setPhotoPreviewUrl(u);
    setPastedImage({ blob: read.blob, mime: read.mime });
  }, [busy]);

  const runRender = useCallback(async () => {
    setBusy(true);
    setError(null);

    revokeObjectUrlsOnce([gifPreviewUrlRef.current]);
    setGifPreviewUrl(null);

    const read = await readClipboardImage();

    let source: PastedImage | null = null;
    if (read.ok) {
      source = { blob: read.blob, mime: read.mime };
      setPastedImage(source);
      revokeObjectUrlsOnce([photoPreviewUrlRef.current]);
      setPhotoPreviewUrl(URL.createObjectURL(source.blob));
    } else if (read.reason === "permission" && pastedImage) {
      source = pastedImage;
    }

    if (!source) {
      setError(read.ok ? "Couldn't read an image from the clipboard." : clipboardFailureMessage(read));
      setBusy(false);
      return;
    }

    if (source.blob.size > MAX_IMAGE_BYTES) {
      setError(`Image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB).`);
      setBusy(false);
      return;
    }

    const file = new File([source.blob], "clipboard-image", { type: source.mime });
    const s = clampPhotoScale(photoScale);
    const body = new FormData();
    body.append("image", file);
    body.append("photoCropNormX", String(cropNorm.normX));
    body.append("photoCropNormY", String(cropNorm.normY));
    body.append("photoScale", String(s));

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        body,
      });

      const buf = await res.arrayBuffer();
      if (!res.ok) {
        const text = new TextDecoder().decode(buf);
        let parsed: { message?: string } | null = null;
        try {
          parsed = JSON.parse(text) as { message?: string };
        } catch {
          /* not JSON (e.g. Next HTML error page) */
        }
        if (parsed?.message) {
          throw new Error(parsed.message);
        }
        if (text.trimStart().startsWith("<!DOCTYPE") || text.includes("__NEXT_DATA__")) {
          throw new Error(
            "The dev server returned an HTML error instead of the GIF (often a broken `.next` cache). Stop the server, run `npm run dev:reset`, wait until it says Ready, then try Generate again.",
          );
        }
        throw new Error(`Request failed (${res.status})`);
      }

      const blob = new Blob([buf], {
        type: res.headers.get("content-type") || "image/gif",
      });
      const url = URL.createObjectURL(blob);
      setGifPreviewUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, [pastedImage, cropNorm, photoScale]);

  const downloadGif = () => {
    if (!gifPreviewUrl) return;
    const a = document.createElement("a");
    a.href = gifPreviewUrl;
    a.download = "lfg-sticker.gif";
    a.click();
  };

  const onPhotoLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
  }, []);

  const onCropPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (busy || !naturalSize) return;
      e.preventDefault();
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      const { deltaW, deltaH } = computeStickerPhotoLayout(
        naturalSize.w,
        naturalSize.h,
        STICKER_OUTPUT_SIZE,
        photoScale,
      );
      const rangeX = deltaW !== 0 ? deltaW : deltaH;
      const rangeY = deltaH !== 0 ? deltaH : deltaW;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startNormX: cropNorm.normX,
        startNormY: cropNorm.normY,
        rangeX,
        rangeY,
      };
    },
    [busy, naturalSize, photoScale, cropNorm.normX, cropNorm.normY],
  );

  const onCropPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    setCropNorm({
      normX: d.rangeX !== 0 ? d.startNormX - dx / d.rangeX : d.startNormX,
      normY: d.rangeY !== 0 ? d.startNormY - dy / d.rangeY : d.startNormY,
    });
  }, []);

  const endCropDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const el = cropFrameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPhotoScale((prev) => clampPhotoScale(prev * Math.exp(-e.deltaY * 0.002)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [naturalSize, photoPreviewUrl]);

  const layout =
    naturalSize != null
      ? computeStickerPhotoLayout(
          naturalSize.w,
          naturalSize.h,
          STICKER_OUTPUT_SIZE,
          photoScale,
        )
      : null;
  const previewTranslate =
    layout != null
      ? computeStickerPhotoPreviewTranslate(layout, cropNorm.normX, cropNorm.normY, STICKER_OUTPUT_SIZE)
      : { tx: 0, ty: 0 };
  const canDragPhoto = Boolean(photoPreviewUrl && naturalSize && !busy);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">

      <section className="sd-card space-y-8 p-8">
        <h2 className="sd-heading text-xl">LFG emoji builder</h2>

        {error ? <div className="sd-error">{error}</div> : null}

        <ol className="m-0 list-none space-y-8 p-0">
          {/* Step 1 */}
          <li className="border-b border-[var(--sd-border)] pb-8">
            <p className="font-medium text-[var(--sd-text)]">
              <span className="tabular-nums text-[var(--sd-text-secondary)]">1.</span> Copy a profile photo from{" "}
              <a
                href="https://home.corp.stripe.com/"
                className="text-[var(--sd-accent)] underline decoration-[var(--sd-accent)] underline-offset-2 hover:text-[var(--sd-accent-hover)]"
              >
                go/home
              </a>{" "}
              to your clipboard.
            </p>
            <p className="sd-muted mt-2 max-w-xl text-sm">
              Or use <kbd className="rounded border border-[var(--sd-border-strong)] bg-[var(--sd-page-bg)] px-1.5 py-0.5 font-sans text-xs">⌘V</kbd> /{" "}
              <kbd className="rounded border border-[var(--sd-border-strong)] bg-[var(--sd-page-bg)] px-1.5 py-0.5 font-sans text-xs">Ctrl+V</kbd> on this page if
              the clipboard button is blocked ({ALLOWED_IMAGE_DESCRIPTION}, up to {MAX_IMAGE_BYTES / (1024 * 1024)} MB).
            </p>
            <div className="mt-4">
              <button type="button" className="sd-btn-secondary" disabled={busy} onClick={() => void pasteFromClipboard()}>
                Paste from clipboard
              </button>
            </div>
          </li>

          {/* Step 2 */}
          <li className="border-b border-[var(--sd-border)] pb-8">
            <p className="font-medium text-[var(--sd-text)]">
              <span className="tabular-nums text-[var(--sd-text-secondary)]">2.</span> Preview and resize image
            </p>

            {pastedImage ? (
              <div className="mt-4 space-y-4">

                {layout ? (
                  <div className="max-w-sm space-y-1">
                    <label className="sd-muted flex items-center justify-between gap-3 text-sm">
                      <span>Image size</span>
                      <span className="tabular-nums text-[var(--sd-text)]">
                        {Math.round(clampPhotoScale(photoScale) * 100)}%
                      </span>
                    </label>
                    <input
                      type="range"
                      min={PHOTO_SCALE_MIN}
                      max={PHOTO_SCALE_MAX}
                      step={0.01}
                      value={clampPhotoScale(photoScale)}
                      onChange={(ev) => setPhotoScale(Number(ev.target.value))}
                      disabled={busy || !naturalSize}
                      aria-label="Image size, smaller to larger"
                      className="w-full"
                    />
                    <div className="sd-muted flex justify-between text-xs">
                      <span>Smaller</span>
                      <span>Larger</span>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-start gap-6">
                  <div className="sd-preview-box shrink-0">
                    {photoPreviewUrl ? (
                      <>
                        {!naturalSize ? (
                          <div className="relative h-full w-full overflow-hidden bg-white">
                            {/* eslint-disable-next-line @next/next/no-img-element -- blob preview */}
                            <img
                              src={photoPreviewUrl}
                              alt=""
                              width={100}
                              height={100}
                              className="h-full w-full object-cover"
                              onLoad={onPhotoLoad}
                              draggable={false}
                            />
                          </div>
                        ) : layout ? (
                          <div
                            ref={cropFrameRef}
                            role="application"
                            aria-label="Drag to reposition the photo; content outside this square is clipped like the GIF export"
                            className={`relative h-full w-full overflow-hidden bg-white touch-none ${
                              canDragPhoto ? "cursor-grab active:cursor-grabbing" : ""
                            }`}
                            onPointerDown={canDragPhoto ? onCropPointerDown : undefined}
                            onPointerMove={naturalSize ? onCropPointerMove : undefined}
                            onPointerUp={endCropDrag}
                            onPointerCancel={endCropDrag}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- blob preview */}
                            <img
                              src={photoPreviewUrl}
                              alt=""
                              width={layout.scaledW}
                              height={layout.scaledH}
                              className="pointer-events-none absolute left-0 top-0 z-0 max-w-none select-none"
                              style={{
                                transform: `translate(${previewTranslate.tx}px, ${previewTranslate.ty}px)`,
                              }}
                              onLoad={onPhotoLoad}
                              draggable={false}
                            />
                            {/* eslint-disable-next-line @next/next/no-img-element -- matches server composite order; pointer-events-none so drag hits the frame */}
                            <img
                              src={LFG_GUIDE_OVERLAY_SRC}
                              alt=""
                              width={STICKER_OUTPUT_SIZE}
                              height={STICKER_OUTPUT_SIZE}
                              className="pointer-events-none absolute inset-0 z-[1] h-full w-full select-none object-fill"
                              draggable={false}
                            />
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  <p className="sd-muted max-w-sm min-w-0 flex-1 text-sm leading-relaxed">
                    {
                      "Position the photo by changing its size and dragging so the Stripe's face is centered above the LFG text."
                    }
                  </p>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="sd-btn-secondary"
                disabled={busy || !pastedImage}
                onClick={runRender}
              >
                {busy ? "Generating…" : "Generate"}
              </button>
            </div>
          </li>

          {/* Step 3 */}
          <li>
            <p className="font-medium text-[var(--sd-text)]">
              <span className="tabular-nums text-[var(--sd-text-secondary)]">3.</span> Download the GIF and upload it to{" "}
              <a
                href="https://stripe.slack.com/customize/emoji"
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap text-[var(--sd-accent)] underline decoration-[var(--sd-accent)] underline-offset-2 hover:text-[var(--sd-accent-hover)]"
              >
                go/emoji
              </a>{" "}
              with name{" "}
              <code className="rounded bg-[var(--sd-page-bg)] px-1.5 py-0.5 font-mono text-sm text-[var(--sd-text)]">
                [handle]-lfg
              </code>{" "}
            </p>

            {gifPreviewUrl ? (
              <div className="mt-4 flex flex-wrap items-start gap-6">
                <div
                  className="sd-preview-box shrink-0"
                  style={{ width: SLACK_REACTION_PREVIEW_PX, height: SLACK_REACTION_PREVIEW_PX }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob GIF preview */}
                  <img src={gifPreviewUrl} alt="" width={100} height={100} className="h-full w-full object-contain" />
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              <button type="button" className="sd-btn-secondary" disabled={!gifPreviewUrl || busy} onClick={downloadGif}>
                Download
              </button>
            </div>
          </li>
        </ol>
      </section>
    </main>
  );
}
