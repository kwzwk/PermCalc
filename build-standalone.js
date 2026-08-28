// Bundles index.html + assets/*.{css,js} into one self-contained HTML file
// with no external file references or ES module imports, so it can be
// opened directly via file:// (double-click) without a local server.
//
// assets/calc.js and assets/app.js stay the single source of truth for the
// app's logic; this script only inlines them, stripping `export`/`import`
// syntax so they share one script scope.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "assets/style.css"), "utf8");
const calcJs = readFileSync(join(root, "assets/calc.js"), "utf8").replace(
  /^export\s+/gm,
  ""
);
const appJs = readFileSync(join(root, "assets/app.js"), "utf8").replace(
  /^import\s*\{[^}]*\}\s*from\s*["']\.\/calc\.js["'];?\s*\n/m,
  ""
);

const bundledScript = `<script>\n(function () {\n"use strict";\n${calcJs}\n${appJs}\n})();\n</script>`;

let out = html
  .replace(
    /<link rel="stylesheet" href="assets\/style\.css" \/>/,
    `<style>\n${css}</style>`
  )
  .replace(/<script type="module" src="assets\/app\.js"><\/script>/, bundledScript)
  // The README link only makes sense alongside the repo; drop it in the
  // standalone build since it won't resolve from an arbitrary desktop path.
  .replace(
    /\s*See <a href="README\.md">README\.md<\/a> for the full derivation, assumptions and unit\s*\n\s*conventions\./,
    ""
  );

mkdirSync(join(root, "dist"), { recursive: true });
const outPath = join(root, "dist/PermCalc.html");
writeFileSync(outPath, out);
console.log("Wrote " + outPath + " (" + out.length + " bytes)");
