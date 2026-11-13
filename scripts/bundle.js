import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");

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

const outPath = path.join(publicDir, "assets/js/app.js");

const bundled = files.map(file => {
  const fullPath = path.join(publicDir, file);
  const content = fs.readFileSync(fullPath, "utf8");
  return `// === ${file} ===\n${content}\n`;
}).join("\n");

fs.writeFileSync(outPath, bundled, "utf8");
console.log(`Bundled ${files.length} files successfully into ${outPath}`);
