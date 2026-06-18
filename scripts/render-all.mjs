import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "out");
const PROPS_PATH = join(ROOT, "data", "props.json");

if (!existsSync(PROPS_PATH)) {
  console.error("Missing data/props.json. Run `npm run build:props` first.");
  process.exit(1);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const allProps = JSON.parse(readFileSync(PROPS_PATH, "utf-8"));
console.log(`Bundling project...`);

const serveUrl = await bundle({
  entryPoint: join(ROOT, "src", "index.ts"),
  onProgress: (p) => {
    if (p === 100) console.log("Bundle complete.");
  },
});

for (let i = 0; i < allProps.length; i++) {
  const props = allProps[i];
  const { surahNumber, fromAyah, toAyah } = props;
  const pad = (n) => String(n).padStart(3, "0");
  const outputFile = join(OUT_DIR, `${pad(surahNumber)}_${pad(fromAyah)}-${pad(toAyah)}.mp4`);

  console.log(
    `\n[${i + 1}/${allProps.length}] Rendering ${surahNumber}:${fromAyah}-${toAyah}...`
  );

  const composition = await selectComposition({
    serveUrl,
    id: "AyahVideo",
    inputProps: props,
  });

  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: outputFile,
    inputProps: props,
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 25 === 0) {
        process.stdout.write(`\r  Progress: ${Math.round(progress * 100)}%`);
      }
    },
  });

  console.log(`\n  -> ${outputFile}`);
}

console.log("\nAll renders complete!");
