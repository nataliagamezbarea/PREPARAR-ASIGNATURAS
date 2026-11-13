import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const files = [
  "assets/js/app/persistencia-archivos.js",
  "assets/js/app/estado.js",
  "assets/js/app/sesion.js",
  "assets/js/app/depurador.js",
  "assets/js/app/preguntas.js",
  "assets/js/app/fallos.js",
  "assets/js/app/ia.js",
  "assets/js/app/resultados.js",
  "assets/js/app/inicio.js"
];

const targets = [
  path.join(rootDir, "public"),
  path.join(rootDir, "assets"),
  path.join(rootDir, "docs")
];

for (const targetDir of targets) {
  const baseDir = targetDir.endsWith("assets") ? path.dirname(targetDir) : targetDir;
  const outPath = targetDir.endsWith("assets") ? path.join(targetDir, "js", "app.js") : path.join(targetDir, "assets", "js", "app.js");
  
  const bundled = files.map(file => {
    const fullPath = path.join(rootDir, "public", file);
    const content = fs.readFileSync(fullPath, "utf8");
    return `// === ${file} ===\n${content}\n`;
  }).join("\n");

  fs.writeFileSync(outPath, bundled, "utf8");
  console.log(`Bundled ${files.length} files successfully into ${outPath}`);
}
