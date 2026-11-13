import path from "node:path";
import { fileURLToPath } from "node:url";

const raizProyecto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function enteroEntorno(nombre, predeterminado, minimo, maximo = Number.MAX_SAFE_INTEGER) {
  const valor = Number.parseInt(process.env[nombre] ?? "", 10);
  return Number.isSafeInteger(valor) && valor >= minimo && valor <= maximo
    ? valor
    : predeterminado;
}

export const configuracion = {
  raizProyecto,
  raizPublica: path.join(raizProyecto, "public"),
  archivosPublicos: new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/assets/css/app.css", ["assets/css/app.css", "text/css; charset=utf-8"]],
    [
      "/assets/css/practicar-apuntes.css",
      ["assets/css/practicar-apuntes.css", "text/css; charset=utf-8"],
    ],
    [
      "/assets/js/app.js",
      [
        [
          "assets/js/app/persistencia-archivos.js",
          "assets/js/app/estado.js",
          "assets/js/app/sesion.js",
          "assets/js/app/depurador.js",
          "assets/js/app/preguntas.js",
          "assets/js/app/fallos.js",
          "assets/js/app/ia.js",
          "assets/js/app/resultados.js",
          "assets/js/app/inicio.js",
        ],
        "text/javascript; charset=utf-8",
      ],
    ],
    [
      "/assets/js/practicar-apuntes.js",
      ["assets/js/practicar-apuntes.js", "text/javascript; charset=utf-8"],
    ],
    ["/data/asignaturas.json", ["data/asignaturas.json", "application/json; charset=utf-8"]],
    [
      "/data/asignaturas/wec/preguntas.json",
      ["data/asignaturas/wec/preguntas.json", "application/json; charset=utf-8"],
    ],
    ...["p1", "p2", "p3", "p4", "p5"].map((parte) => [
      `/data/asignaturas/wec/partes/${parte}.json`,
      [`data/asignaturas/wec/partes/${parte}.json`, "application/json; charset=utf-8"],
    ]),
    [
      "/data/ejemplo-fallos.json",
      ["data/ejemplo-fallos.json", "application/json; charset=utf-8"],
    ],
  ]),
  raizApuntes: path.resolve(process.env.RUTA_APUNTES ?? "/data/apuntes"),
  raizBancos: path.resolve(
    raizProyecto,
    process.env.RUTA_BANCOS ?? "datos/bancos",
  ),
  puerto: enteroEntorno("PUERTO_WEB", 8124, 1, 65535),
  direccionOllama: (process.env.DIRECCION_OLLAMA ??
    "http://generador-apuntes-ollama:11434")
    .trim()
    .replace(/\/+$/, ""),
  modelo: (process.env.MODELO_IA ?? "qwen2.5vl:7b").trim(),
  contextoModelo: enteroEntorno("NUM_CTX_IA", 24576, 4096, 131072),
  tokensRespuesta: enteroEntorno("TOKENS_MAX_IA", 2048, 256, 8192),
  tiempoMaximoMs: enteroEntorno("TIEMPO_IA", 900, 30, 3600) * 1000,
  maxCaracteresBloque: enteroEntorno(
    "MAX_CARACTERES_BLOQUE",
    10000,
    2000,
    40000,
  ),
  maxPreguntas: 7000,
  preguntasPorBloqueIA: 10,
};
