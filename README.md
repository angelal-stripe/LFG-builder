# LFG sticker builder

Internal tool: read a portrait from the **clipboard**, composite it behind a **looping animated LFG** strip (several PNG variants in random order), download a **100×100** transparent GIF.

## Local development

```bash
npm install
npm run generate:lfg   # placeholder overlays; replace with Figma exports when ready
```

**Using Cursor / VS Code:** **`.vscode/tasks.json`** starts **`npm run dev`** when you open this folder (so you usually **do not** run anything in the terminal yourself). **`.vscode/settings.json`** sets **`task.allowAutomaticTasks": "on"`** so Cursor should not ask every time. Keep **`http://localhost:3000`** bookmarked and **refresh** after you save—same as any dev site. If the terminal shows a different port, use that URL instead.

If automatic tasks are off in your editor, run **`npm run dev`** once by hand.

**“Internal Server Error” on localhost:3000 (usually on refresh):** Port **3000** is often still held by an **old or crashed Node/Next** process. Your browser then talks to that broken server instead of the app you just started.

- **Prevention:** **`npm run dev`** runs **`predev`** first, which **frees TCP 3000** (macOS/Linux). The auto-started task uses the same script, so each folder open gets a clean port before Next starts. **Do not run two different apps on 3000 at once**—the newer dev server will stop the older listener.
- **If it still breaks:** `npm run dev:reset` (free port + clean `.next` + dev). **Never run `npx next dev` on another port while the browser stays on 3000** unless you mean to—always use the URL from the terminal you started.

**500 on Vercel:** Redeploy after pulling latest (tracing now bundles Sharp/`gif-encoder-2` explicitly). In the deployment **Functions** log, open `/api/render`—errors also return JSON `{ "message": "..." }` when Generate fails. Ensure `public/lfg/` assets are **committed** and [`src/lib/lfgVariants.json`](src/lib/lfgVariants.json) lists real filenames. Invalid numbers in [`src/lib/lfgLayout.json`](src/lib/lfgLayout.json) are ignored with safe defaults.

## Figma assets (LFGA file)

Artboard reference: [LFGA — layout node `160-436`](https://www.figma.com/design/N1FuEALL0IBH6Fnjec5o49/LFGA?node-id=160-436).

1. Open the file above and use that **100×100** (or scaled) sticker frame as the source of truth for where the LFG graphic sits.
2. Export each variant under [`public/lfg/`](public/lfg/) (this repo uses **`1.png` … `6.png`**), PNG with transparency.
3. Register filenames in [`src/lib/lfgVariants.json`](src/lib/lfgVariants.json). The **`animation`** block controls the GIF: `frameCount` (how many distinct overlays per sticker, default **5**) and `frameDelayMs` (pause between frames, default **120**). Each generate **shuffles** that many files from `files` without replacement—you need at least `frameCount` PNGs listed.
4. **Placement:** Edit [`src/lib/lfgLayout.json`](src/lib/lfgLayout.json):
   - **`overlay`**: default rectangle every file uses — `left`, `top`, `width`, `height` in **output pixels** (0–100), plus **`fit`**: `"fill"` (stretch to rect), `"contain"` (letterbox inside rect), or `"cover"` (crop to rect).
   - **`perFile`**: optional overrides keyed by exact filename, e.g. `"2.png": { "top": 67, "height": 27 }`.

To match Figma exactly: select the **LFG** layer on artboard `160-436`, read **Layout → X, Y, W, H** relative to the **same 100×100 frame** as the final GIF. If your Figma frame size is not 100px, scale: `valueIn100 = figmaValue * (100 / figmaFrameSize)`.

To regenerate placeholder banners from SVG during design iteration:

```bash
npm run generate:lfg
```

## Deploy (Vercel)

- Production URL: deploy from this repo; ensure **Node.js** runtime for `/api/render` (Sharp).
- Lock down access with [Vercel deployment protection](https://vercel.com/docs/security/deployment-protection) (or your org’s standard) if the app should not be public.
