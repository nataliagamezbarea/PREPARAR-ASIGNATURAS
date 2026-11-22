import { inspect as utilInspect } from "node:util";

const ACTIVO = true; // pon false para silenciar los logs de depuración

function fecha() {
  return new Date().toISOString();
}

/**
 * Escribe un mensaje de depuración con etiqueta y timestamp.
 * Uso: debug.log("bancos", "clave", clave);
 */
export function log(tag, ...args) {
  if (!ACTIVO) return;
  const etiqueta = `[DEBUG][${fecha()}][${tag}]`;
  console.log(etiqueta, ...args);
}

/**
 * Escribe un objeto legible para inspeccionar variables complejas.
 * Uso: debug.inspectObjeto("preguntas", respuesta);
 */
export function inspectObjeto(tag, objeto, profundidad = 5) {
  if (!ACTIVO) return;
  const etiqueta = `[DEBUG][${fecha()}][${tag}]`;
  console.log(etiqueta, utilInspect(objeto, { depth: profundidad, compact: false }));
}

/**
 * Captura y escribe un error con su pila y contexto adicional.
 * Uso: try { ... } catch (e) { debug.error("servidor", e, { ruta, metodo }); throw e; }
 */
export function error(tag, err, contexto = {}) {
  if (!ACTIVO) return;
  const etiqueta = `[DEBUG][${fecha()}][${tag}][ERROR]`;
  console.error(etiqueta, "mensaje:", err?.message ?? err);
  if (contexto && Object.keys(contexto).length) {
    console.error(etiqueta, "contexto:", utilInspect(contexto, { depth: 3 }));
  }
  if (err?.stack) {
    console.error(etiqueta, "pila:\n", err.stack);
  }
}

/**
 * Envuelve una función async para loguear entrada, salida y errores automáticamente.
 * Uso: const leerBanco = debug.envuelve("bancos", leerBancoPreguntas);
 */
export function envuelve(tag, fn) {
  if (!ACTIVO) return fn;
  return async (...args) => {
    const etiqueta = `[DEBUG][${fecha()}][${tag}]`;
    console.log(etiqueta, "LLAMADA con args:", utilInspect(args, { depth: 3 }));
    const inicio = Date.now();
    try {
      const resultado = await fn(...args);
      console.log(
        etiqueta,
        `OK en ${Date.now() - inicio}ms`,
        "resultado:",
        utilInspect(resultado, { depth: 3 }),
      );
      return resultado;
    } catch (err) {
      console.error(
        etiqueta,
        `FALLO en ${Date.now() - inicio}ms`,
        "mensaje:",
        err?.message ?? err,
      );
      if (err?.stack) console.error(etiqueta, "pila:\n", err.stack);
      throw err;
    }
  };
}
