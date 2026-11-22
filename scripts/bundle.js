import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const files = [
  "assets/js/app/persistencia-archivos.js",
  "assets/js/app/estado/utilidades.js",
  "assets/js/app/estado/almacenamiento.js",
  "assets/js/app/estado/apartados.js",
  "assets/js/app/estado/catalogo.js",
  "assets/js/app/estado/sesiones.js",
  "assets/js/app/estado.js",
  "assets/js/app/supabase/cliente.js",
  "assets/js/app/supabase/progreso.js",
  "assets/js/app/supabase/auth.js",
  "assets/js/app/supabase/ui.js",
  "assets/js/app/supabase/github-ramas.js",
  "assets/js/app/supabase.js",
  "assets/js/app/sesion/control.js",
  "assets/js/app/sesion/arbol.js",
  "assets/js/app/sesion/modalidades.js",
  "assets/js/app/sesion/desarrollo.js",
  "assets/js/app/sesion/topbar.js",
  "assets/js/app/sesion/inicio.js",
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

    // Also sync modular source files across target directories if they exist
    if (targetDir !== path.join(rootDir, "public")) {
      const destSubPath = targetDir.endsWith("assets")
        ? path.join(targetDir, file.replace(/^assets\//, ""))
        : path.join(targetDir, file);
      const destFolder = path.dirname(destSubPath);
      if (!fs.existsSync(destFolder)) {
        fs.mkdirSync(destFolder, { recursive: true });
      }
      fs.writeFileSync(destSubPath, content, "utf8");
    }

    return `// === ${file} ===\n${content}\n`;
  }).join("\n");

  fs.writeFileSync(outPath, bundled, "utf8");
  console.log(`Bundled ${files.length} files successfully into ${outPath}`);
}
