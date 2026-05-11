/**
 * Generates placeholder LFG overlay PNGs from SVG (for dev until Figma exports land).
 * Run: npm run generate:lfg
 */
import sharp from "sharp";
import { mkdir } from "fs/promises";
import { writeFile } from "fs/promises";

const variants = [
  { file: "lfg-01.png", fill: "#e01e5a", stroke: "#0a2540" },
  { file: "lfg-02.png", fill: "#635bff", stroke: "#0a2540" },
  { file: "lfg-03.png", fill: "#00d924", stroke: "#0a2540" },
];

function svgFor(fill, stroke) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="none"/>
  <rect x="6" y="68" width="88" height="26" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="3"/>
  <text x="50" y="87" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="15" font-weight="700" fill="#ffffff">LFG</text>
</svg>`.trim();
}

await mkdir("public/lfg", { recursive: true });
await mkdir("src/lib", { recursive: true });

for (const v of variants) {
  const buf = await sharp(Buffer.from(svgFor(v.fill, v.stroke))).png().toBuffer();
  await sharp(buf).png().toFile(`public/lfg/${v.file}`);
}

await writeFile(
  "src/lib/lfgVariants.json",
  `${JSON.stringify(
    {
      files: variants.map((v) => v.file),
      animation: { frameCount: Math.min(5, variants.length), frameDelayMs: 120 },
    },
    null,
    2,
  )}\n`,
);

console.log("Wrote", variants.length, "overlays to public/lfg/ and refreshed src/lib/lfgVariants.json");
