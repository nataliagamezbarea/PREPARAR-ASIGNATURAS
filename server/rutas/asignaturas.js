import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { configuracion } from "../configuracion.js";

export async function leerCatalogoAsignaturas() {
  const candidatas = [
    path.join(configuracion.raizBancos, "asignaturas.json"),
    path.join(configuracion.raizPublica, "data", "asignaturas.json"),
    path.join(configuracion.raizProyecto, "data", "asignaturas.json"),
  ];
  for (const c of candidatas) {
    try {
      const contenido = await readFile(c, "utf8");
      return JSON.parse(contenido);
    } catch (_) {}
  }
  return { asignaturas: [] };
}

export async function manejarAsignaturas(peticion, respuesta, url, responderJson, responderError, leerJson) {
  if (peticion.method === "GET" && url.pathname === "/api/asignaturas") {
    try {
      const catalogo = await leerCatalogoAsignaturas();
      return responderJson(respuesta, 200, catalogo);
    } catch (err) {
      return responderError(respuesta, 500, "No se pudo leer el catálogo de asignaturas: " + err.message);
    }
  }

  if (peticion.method === "POST" && url.pathname === "/api/asignaturas") {
    try {
      const datos = await leerJson(peticion);
      const idRaw = String(datos.id || datos.nombre || "").trim().toLowerCase();
      const id = idRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!id || id.length < 2) return responderError(respuesta, 400, "El identificador o nombre de la asignatura no es válido.");

      const nombre = String(datos.nombre || id.toUpperCase()).trim();
      const grado = String(datos.grado || "Segundo_grado_medio").trim();
      const descripcion = String(datos.descripcion || `${nombre} · Banco de preguntas`).trim();
      const temas = Array.isArray(datos.temas) && datos.temas.length > 0 ? datos.temas : [
        { numero: 1, nombre: "Tema 1 · Fundamentos y conceptos generales", apartados: [{ numero: 1, nombre: "1.1 Introducción" }] }
      ];

      // Carpetas seguras del servidor (no se pide ruta arbitraria al usuario)
      const dirBancos = path.join(configuracion.raizBancos, id.toUpperCase());
      const dirPublic = path.join(configuracion.raizPublica, "data", "asignaturas", id);
      const dirData = path.join(configuracion.raizProyecto, "data", "asignaturas", id);

      await mkdir(dirBancos, { recursive: true });
      try { await mkdir(dirPublic, { recursive: true }); } catch (_) {}
      try { await mkdir(dirData, { recursive: true }); } catch (_) {}

      const rutaPreguntasPub = path.join(dirPublic, "preguntas.json");
      const rutaPreguntasData = path.join(dirData, "preguntas.json");
      const rutaBancoBancos = path.join(dirBancos, `${id.toUpperCase()}-temas-todos-apartado-0.json`);

      let preguntas = [];
      if (Array.isArray(datos.preguntas) && datos.preguntas.length > 0) {
        preguntas = datos.preguntas;
      } else {
        try {
          const prev = JSON.parse(await readFile(rutaPreguntasPub, "utf8"));
          if (Array.isArray(prev.preguntas)) preguntas = prev.preguntas;
        } catch (_) {}
      }

      const bancoObj = {
        formato: "preparar-tests-banco-preguntas",
        version: 1,
        clave: `${id.toUpperCase()}-banco-oficial`,
        meta: {
          asignatura: id.toUpperCase(),
          titulo: `${nombre} · Banco de Preguntas`,
          tema: 0,
          temas: temas.map(t => Number(t.numero) || 1),
          apartado: 0,
          total: preguntas.length,
          version: "1.0",
          grado
        },
        preguntas
      };

      const jsonBanco = JSON.stringify(bancoObj, null, 2);
      await writeFile(rutaBancoBancos, jsonBanco, "utf8");
      try { await writeFile(rutaPreguntasPub, jsonBanco, "utf8"); } catch (_) {}
      try { await writeFile(rutaPreguntasData, jsonBanco, "utf8"); } catch (_) {}

      // Actualizar catálogo general
      let catalogo = await leerCatalogoAsignaturas();
      if (!Array.isArray(catalogo.asignaturas)) catalogo.asignaturas = [];

      const nuevaEntrada = {
        id,
        nombre,
        grado,
        archivo: `./data/asignaturas/${id}/preguntas.json`,
        descripcion,
        temas,
        totalPreguntas: preguntas.length
      };

      const idxExistente = catalogo.asignaturas.findIndex(a => a.id === id);
      if (idxExistente >= 0) {
        catalogo.asignaturas[idxExistente] = { ...catalogo.asignaturas[idxExistente], ...nuevaEntrada };
      } else {
        catalogo.asignaturas.push(nuevaEntrada);
      }

      const catalogoStr = JSON.stringify(catalogo, null, 2);
      const rutaCatBancos = path.join(configuracion.raizBancos, "asignaturas.json");
      const rutaCatPub = path.join(configuracion.raizPublica, "data", "asignaturas.json");
      const rutaCatData = path.join(configuracion.raizProyecto, "data", "asignaturas.json");

      await writeFile(rutaCatBancos, catalogoStr, "utf8");
      try { await writeFile(rutaCatPub, catalogoStr, "utf8"); } catch (_) {}
      try { await writeFile(rutaCatData, catalogoStr, "utf8"); } catch (_) {}

      return responderJson(respuesta, 201, { ok: true, asignatura: nuevaEntrada });
    } catch (err) {
      return responderError(respuesta, 500, "Error creando asignatura: " + err.message);
    }
  }

  if (peticion.method === "POST" && url.pathname === "/api/tests/subir") {
    try {
      const datos = await leerJson(peticion);
      const idRaw = String(datos.idAsignatura || datos.asignatura || datos.id || "").trim().toLowerCase();
      const id = idRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      if (!id) return responderError(respuesta, 400, "Falta el ID o nombre de la asignatura de destino.");

      let listaPreguntas = [];
      if (Array.isArray(datos.preguntas)) {
        listaPreguntas = datos.preguntas;
      } else if (datos.preguntas && typeof datos.preguntas === "object") {
        listaPreguntas = Object.values(datos.preguntas);
      } else if (Array.isArray(datos)) {
        listaPreguntas = datos;
      }

      if (!listaPreguntas.length) {
        return responderError(respuesta, 400, "El archivo o payload no contiene un array de preguntas.");
      }

      const normalizadas = listaPreguntas.map((p, idx) => {
        const idPregunta = p.id || `${id}_q_${idx + 1}`;
        const tema = Number(p.tema) || 1;
        const apartado = Number(p.apartado) || 1;
        let opciones = { A: "", B: "", C: "", D: "" };
        if (p.opciones && typeof p.opciones === "object" && !Array.isArray(p.opciones)) {
          opciones = {
            A: String(p.opciones.A || p.opciones.a || ""),
            B: String(p.opciones.B || p.opciones.b || ""),
            C: String(p.opciones.C || p.opciones.c || ""),
            D: String(p.opciones.D || p.opciones.d || "")
          };
        } else if (Array.isArray(p.opciones || p.op)) {
          const arr = p.opciones || p.op;
          ["A", "B", "C", "D"].forEach((letra, i) => {
            if (arr[i] != null) {
              opciones[letra] = typeof arr[i] === "object" && arr[i].texto ? String(arr[i].texto) : String(arr[i]);
            }
          });
        }
        let correcta = "A";
        if (typeof p.correcta === "string" && p.correcta.trim()) {
          correcta = p.correcta.trim().toUpperCase().charAt(0);
        } else if (typeof p.respuesta_correcta === "string") {
          correcta = p.respuesta_correcta.trim().toUpperCase().charAt(0);
        } else if (typeof p.ok === "number" && p.ok >= 0 && p.ok < 4) {
          correcta = ["A", "B", "C", "D"][p.ok];
        }

        return {
          id: idPregunta,
          tema,
          apartado,
          apartadoNombre: p.apartadoNombre || p.subtema || `Apartado ${apartado}`,
          tipo: p.tipo || "teoria",
          enunciado: String(p.enunciado || p.q || p.pregunta || "").trim(),
          codigo: String(p.codigo || p.codi || "").trim(),
          opciones,
          correcta,
          explicacion: String(p.explicacion || p.exp || p.solucion || "Sin explicación.").trim()
        };
      }).filter(p => p.enunciado.length > 0);

      if (!normalizadas.length) {
        return responderError(respuesta, 400, "Ninguna pregunta tiene un enunciado válido.");
      }

      // Guardar en raizBancos
      const dirBancos = path.join(configuracion.raizBancos, id.toUpperCase());
      const dirPublic = path.join(configuracion.raizPublica, "data", "asignaturas", id);
      const dirData = path.join(configuracion.raizProyecto, "data", "asignaturas", id);

      await mkdir(dirBancos, { recursive: true });
      try { await mkdir(dirPublic, { recursive: true }); } catch (_) {}
      try { await mkdir(dirData, { recursive: true }); } catch (_) {}

      const temasSet = new Set(normalizadas.map(p => p.tema));
      const temasNumeros = [...temasSet].sort((a, b) => a - b);

      const bancoObj = {
        formato: "preparar-tests-banco-preguntas",
        version: 1,
        clave: `${id.toUpperCase()}-banco-oficial`,
        meta: {
          asignatura: id.toUpperCase(),
          titulo: `${datos.nombre || id.toUpperCase()} · Banco de Preguntas`,
          tema: 0,
          temas: temasNumeros,
          apartado: 0,
          total: normalizadas.length,
          version: "1.0",
          grado: datos.grado || "Segundo_grado_medio"
        },
        preguntas: normalizadas
      };

      const jsonBanco = JSON.stringify(bancoObj, null, 2);
      await writeFile(path.join(dirBancos, `${id.toUpperCase()}-temas-todos-apartado-0.json`), jsonBanco, "utf8");
      try { await writeFile(path.join(dirPublic, "preguntas.json"), jsonBanco, "utf8"); } catch (_) {}
      try { await writeFile(path.join(dirData, "preguntas.json"), jsonBanco, "utf8"); } catch (_) {}

      // Actualizar total en catálogo
      let catalogo = await leerCatalogoAsignaturas();
      const itemCat = (catalogo.asignaturas || []).find(a => a.id === id);
      if (itemCat) {
        itemCat.totalPreguntas = normalizadas.length;
        const catalogoStr = JSON.stringify(catalogo, null, 2);
        const rutaCatBancos = path.join(configuracion.raizBancos, "asignaturas.json");
        const rutaCatPub = path.join(configuracion.raizPublica, "data", "asignaturas.json");
        const rutaCatData = path.join(configuracion.raizProyecto, "data", "asignaturas.json");
        await writeFile(rutaCatBancos, catalogoStr, "utf8");
        try { await writeFile(rutaCatPub, catalogoStr, "utf8"); } catch (_) {}
        try { await writeFile(rutaCatData, catalogoStr, "utf8"); } catch (_) {}
      }

      return responderJson(respuesta, 200, {
        ok: true,
        id,
        totalPreguntas: normalizadas.length,
        temas: temasNumeros
      });
    } catch (err) {
      return responderError(respuesta, 500, "Error subiendo test: " + err.message);
    }
  }

  return false;
}
