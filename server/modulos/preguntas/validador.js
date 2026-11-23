import { configuracion } from "../../configuracion.js";

export const CONTEXTO_EXAMEN_PREDETERMINADO =
  "Examen tipo test estándar: evalúa conceptos clave, diferencias y matices, aplicación a situaciones nuevas, " +
  "interpretación de ejemplos y errores frecuentes. Alterna preguntas conceptuales y prácticas.";

export function validarSolicitudGeneracion(datos) {
  const asignatura = String(datos.asignatura ?? "").trim();
  const temas = datos.temas === "todos"
    ? "todos"
    : Array.isArray(datos.temas)
      ? [...new Set(datos.temas.map(Number))]
      : Number(datos.tema) > 0
        ? [Number(datos.tema)]
        : [];
  const tema = temas === "todos" || temas.length !== 1 ? 0 : temas[0];
  const apartado = Number(datos.apartado ?? 0);
  const subapartado = Number(datos.subapartado ?? 0);
  const fichero = String(datos.fichero ?? "").trim();
  const cantidad = Number(datos.cantidad ?? 10);
  const modoExamen = String(datos.modoExamen ?? "predeterminado");
  const contextoExamen = String(datos.contextoExamen ?? "").trim();
  const tipoPreguntas = String(datos.tipoPreguntas ?? "mixto");
  if (!asignatura) throw new Error("Selecciona una asignatura.");
  if (
    temas !== "todos" &&
    (!temas.length ||
      temas.some((numero) => !Number.isSafeInteger(numero) || numero < 1))
  )
    throw new Error("Selecciona uno o varios temas válidos.");
  if (!Number.isSafeInteger(apartado) || apartado < 0)
    throw new Error("Selecciona un apartado válido.");
  if (
    !Number.isSafeInteger(cantidad) ||
    cantidad < 1 ||
    cantidad > configuracion.maxPreguntas
  )
    throw new Error(
      `Elige entre 1 y ${configuracion.maxPreguntas} preguntas nuevas.`,
    );
  if (!["predeterminado", "personalizado"].includes(modoExamen))
    throw new Error("Selecciona el tipo de preparación del examen.");
  if (modoExamen === "personalizado" && contextoExamen.length < 10)
    throw new Error(
      "Describe el examen con al menos 10 caracteres o usa el modo predeterminado.",
    );
  if (contextoExamen.length > 4000)
    throw new Error("El contexto personalizado no puede superar 4000 caracteres.");
  if (!["mixto", "teoria", "codigo"].includes(tipoPreguntas))
    throw new Error("Selecciona un tipo de pregunta válido.");
  const contextoLibre = String(datos.context ?? "").trim();
  const instrucciones = String(datos.instrucciones ?? "").trim();
  if (contextoLibre.length > 40000)
    throw new Error("El contexto de estudio no puede superar 40000 caracteres.");
  if (instrucciones.length > 4000)
    throw new Error("Las instrucciones de generación no pueden superar 4000 caracteres.");
  if (
    !contextoLibre &&
    temas !== "todos" &&
    (!temas.length ||
      temas.some((numero) => !Number.isSafeInteger(numero) || numero < 1))
  )
    throw new Error("Selecciona uno o varios temas válidos.");
  if ((temas === "todos" || temas.length !== 1) && apartado)
    throw new Error("Elige un solo tema para seleccionar un apartado.");
  return {
    asignatura,
    tema,
    temas,
    apartado,
    cantidad,
    modoExamen,
    contextoExamen,
    tipoPreguntas,
    context: contextoLibre,
    instrucciones,
    ...(subapartado ? { subapartado } : {}),
    ...(fichero ? { fichero } : {}),
    ...(datos.desglose && typeof datos.desglose === "object" ? { desglose: datos.desglose } : {}),
    ...(datos.buscarInternet ? { buscarInternet: true } : {}),
  };
}

export function normalizarPregunta(pregunta, indice = 0) {
  if (!pregunta || typeof pregunta !== "object")
    throw new Error(`La pregunta ${indice + 1} no es un objeto.`);
  const enunciado = String(pregunta.enunciado ?? "").trim();
  if (!enunciado) throw new Error(`La pregunta ${indice + 1} no tiene enunciado.`);
  const opcionesBrutas = pregunta.opciones;
  if (!opcionesBrutas || typeof opcionesBrutas !== "object")
    throw new Error(`La pregunta ${indice + 1} no tiene opciones.`);
  const opciones = Object.fromEntries(
    ["A", "B", "C", "D"].map((letra) => [
      letra,
      String(opcionesBrutas[letra] ?? "").trim(),
    ]),
  );
  if (Object.values(opciones).some((opcion) => !opcion))
    throw new Error(`La pregunta ${indice + 1} necesita cuatro opciones completas.`);
  const opcionesNormalizadas = Object.values(opciones).map((opcion) =>
    opcion.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase(),
  );
  if (new Set(opcionesNormalizadas).size !== 4)
    throw new Error(`La pregunta ${indice + 1} tiene opciones repetidas.`);
  const coincidenciaCorrecta = String(pregunta.correcta ?? "").match(/\b([A-D])\b/i);
  if (!coincidenciaCorrecta)
    throw new Error(`La pregunta ${indice + 1} no tiene una respuesta A-D válida.`);
  const correcta = coincidenciaCorrecta[1].toUpperCase();
  const tipo = String(pregunta.tipo ?? "teoria").toLowerCase();
  const apartado = Number(pregunta.apartado ?? 0);
  const subapartado = pregunta.subapartado ? Number(pregunta.subapartado) : null;
  const fichero = String(pregunta.fichero ?? "").trim();
  if (!Number.isSafeInteger(apartado) || apartado < 0)
    throw new Error(`La pregunta ${indice + 1} tiene un apartado inválido.`);
  const codigo = String(pregunta.codigo ?? "").trim();
  const traza = Array.isArray(pregunta.traza) ? pregunta.traza : [];
  const explicacion = String(pregunta.explicacion ?? "").trim();
  const explicacionClara = String(pregunta.explicacionClara ?? "").trim();
  const ejemploId = String(pregunta.ejemploId ?? "").trim();
  if (ejemploId.length > 100)
    throw new Error(`La pregunta ${indice + 1} tiene un ID de ejemplo inválido.`);
  if (!explicacion)
    throw new Error(`La pregunta ${indice + 1} no incluye una explicación.`);
  if (!explicacionClara)
    throw new Error(`La pregunta ${indice + 1} no incluye una explicación didáctica.`);
  if (tipo === "codigo" && !codigo)
    throw new Error(`La pregunta de código ${indice + 1} no incluye código.`);
  if (tipo === "codigo" && !traza.length)
    throw new Error(`La pregunta de código ${indice + 1} no incluye una traza paso a paso.`);

  return {
    tema: Math.max(1, Number.parseInt(pregunta.tema, 10) || 1),
    apartado,
    apartadoNombre: String(pregunta.apartadoNombre ?? "").trim().slice(0, 120),
    ...(subapartado ? { subapartado } : {}),
    ...(fichero ? { fichero } : {}),
    tipo: tipo === "codigo" ? "codigo" : "teoria",
    tag: String(pregunta.tag ?? "Concepto").trim().slice(0, 100) || "Concepto",
    dificultad: ["facil", "media", "dificil"].includes(pregunta.dificultad)
      ? pregunta.dificultad
      : "media",
    enunciado,
    ...(codigo ? { codigo } : {}),
    opciones,
    correcta,
    explicacion,
    explicacionClara,
    ...(ejemploId ? { ejemploId } : {}),
    ...(tipo === "codigo" ? { traza } : {}),
  };
}

const DEPENDE_DE_POSICION =
  /(todas|ninguna|ambas|cualquiera)\s+(de\s+)?(las\s+)?(anteriores|opciones|dem[aá]s)|\b(a|b|c)\s+(y|o)\s+(b|c|d)\b|\bopci[oó]n\s+[a-d]\b/i;

export function barajarOpciones(pregunta, aleatorio = Math.random) {
  const letras = ["A", "B", "C", "D"];
  if (letras.some((letra) => DEPENDE_DE_POSICION.test(pregunta.opciones[letra])))
    return pregunta;
  const orden = [...letras];
  for (let i = orden.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [orden[i], orden[j]] = [orden[j], orden[i]];
  }
  const opciones = Object.fromEntries(
    letras.map((letra, i) => [letra, pregunta.opciones[orden[i]]]),
  );
  return { ...pregunta, opciones, correcta: letras[orden.indexOf(pregunta.correcta)] };
}

export function repararOpcionesRepetidas(pregunta) {
  if (!pregunta || typeof pregunta !== "object" || !pregunta.opciones) return pregunta;
  const letras = ["A", "B", "C", "D"];
  const opciones = { ...pregunta.opciones };
  const correcta = String(pregunta.correcta || "").trim().toUpperCase();

  const norm = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const usadas = new Set();

  if (letras.includes(correcta) && opciones[correcta]) {
    usadas.add(norm(opciones[correcta]));
  }

  const alternativasComunes = [
    "undefined", "null", "NaN", "0", "1", "true", "false",
    "string", "number", "boolean", "object", "function",
    "Error de sintaxis", "Error de ejecución", "[]", "{}",
  ];

  for (const letra of letras) {
    if (letra === correcta) continue;
    let valor = String(opciones[letra] || "").trim();
    let nVal = norm(valor);
    if (!valor || usadas.has(nVal)) {
      let candidato = alternativasComunes.find((t) => !usadas.has(norm(t)));
      if (!candidato) {
        let cIdx = 1;
        candidato = `${valor || "Alternativa"} (${cIdx})`;
        while (usadas.has(norm(candidato))) {
          cIdx++;
          candidato = `${valor || "Alternativa"} (${cIdx})`;
        }
      }
      opciones[letra] = candidato;
      usadas.add(norm(candidato));
    } else {
      usadas.add(nVal);
    }
  }

  return { ...pregunta, opciones };
}

function normalizarParaComparar(texto) {
  return String(texto ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function filtrarPreguntasPorEjemplos(preguntas, ejemplosObjetivo) {
  const permitidos = new Map(ejemplosObjetivo.map((ejemplo) => [ejemplo.id, ejemplo]));
  const vistas = new Set();
  return preguntas.filter((pregunta) => {
    const ejemplo = permitidos.get(pregunta.ejemploId);
    if (!ejemplo || vistas.has(ejemplo.id)) return false;
    const respuesta = normalizarParaComparar([
      pregunta.enunciado,
      pregunta.codigo,
      ...Object.values(pregunta.opciones ?? {}),
      pregunta.explicacion,
      pregunta.explicacionClara,
    ].join("\n"));
    const fuente = normalizarParaComparar(ejemplo.texto);
    if (
      (ejemplo.tipo === "codigo" &&
        normalizarParaComparar(pregunta.codigo) === fuente) ||
      (fuente.length >= 40 && respuesta.includes(fuente))
    )
      return false;
    vistas.add(ejemplo.id);
    return true;
  });
}
