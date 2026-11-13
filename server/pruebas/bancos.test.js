import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  anadirPreguntasAlBanco,
  listarBancosPreguntas,
  leerBancoPreguntas,
} from "../bancos.js";

function crearPregunta(enunciado, respuesta = "A") {
  return {
    tema: 4,
    tipo: "teoria",
    tag: "Concepto",
    dificultad: "media",
    enunciado,
    opciones: {
      A: "Respuesta correcta",
      B: "Error típico",
      C: "Otra idea",
      D: "Confusión",
    },
    correcta: respuesta,
    explicacion: "La explicación se basa en los apuntes seleccionados.",
  };
}

test("añade preguntas por tandas, preserva las anteriores y elimina duplicados", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-banco-"));
  const seleccion = {
    asignatura: "WEC",
    tema: 4,
    apartado: 2,
    titulo: "Arrays",
    revision: "revision-inicial",
    archivosOrigen: ["WEC/Tema 4/Tema 4.2/4.2.1-arrays.tex"],
  };
  try {
    const primera = await anadirPreguntasAlBanco(
      {
        ...seleccion,
        preguntasNuevas: [
          crearPregunta("¿Cómo se accede a una posición de un array usando su índice?"),
        ],
      },
      { raiz },
    );
    assert.equal(primera.anadidas, 1);
    assert.equal(primera.total, 1);
    assert.equal(primera.clave, "WEC-temas-4-apartado-2");

    const segunda = await anadirPreguntasAlBanco(
      {
        ...seleccion,
        revision: "revision-actualizada",
        preguntasNuevas: [
          crearPregunta("¿Cómo se accede a una posición de un array usando su índice?"),
          crearPregunta("¿Qué ocurre al leer un índice que no existe en el array?"),
        ],
      },
      { raiz },
    );
    assert.equal(segunda.anadidas, 1);
    assert.equal(segunda.repetidas, 1);
    assert.equal(segunda.total, 2);
    assert.deepEqual(segunda.preguntas.map((pregunta) => pregunta.id), [1, 2]);
    assert.equal(segunda.revision, "revision-actualizada");

    const cargado = await leerBancoPreguntas(
      { asignatura: "WEC", tema: 4, apartado: 2 },
      { raiz },
    );
    assert.equal(cargado.preguntas.length, 2);
    assert.equal((await listarBancosPreguntas({ raiz })).length, 1);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("mueve bancos antiguos a una carpeta legible y conserva el nombre JSON", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-nombre-banco-"));
  const seleccion = {
    asignatura: "WEC",
    tema: 4,
    apartado: 2,
    titulo: "Arrays",
    revision: "revision",
    archivosOrigen: [],
  };
  try {
    const creado = await anadirPreguntasAlBanco(
      { ...seleccion, preguntasNuevas: [crearPregunta("¿Qué es una lista ordenada?")] },
      { raiz },
    );
    const resumen = createHash("sha256").update("WEC").digest("hex").slice(0, 10);
    const rutaLimpia = path.join(raiz, "WEC", "WEC-temas-4-apartado-2.json");
    const carpetaAntigua = `wec-${resumen}`;
    const rutaAntigua = path.join(raiz, carpetaAntigua, `wec-${resumen}-t4-a2.json`);
    const contenido = await readFile(rutaLimpia, "utf8");
    const banco = JSON.parse(contenido);
    banco.clave = `wec-${resumen}-t4-a2`;
    await mkdir(path.dirname(rutaAntigua), { recursive: true });
    await writeFile(rutaAntigua, JSON.stringify(banco, null, 2));
    await rm(rutaLimpia);

    const bancos = await listarBancosPreguntas({ raiz });
    assert.equal(bancos.length, 1);
    assert.equal(bancos[0].asignatura, "WEC");
    assert.equal(bancos[0].clave, creado.clave);
    assert.deepEqual(
      await readdir(path.join(raiz, "WEC")),
      ["WEC-temas-4-apartado-2.json"],
    );
    assert.equal(
      JSON.parse(await readFile(rutaLimpia, "utf8")).clave,
      "WEC-temas-4-apartado-2",
    );
    assert.deepEqual(await readdir(path.join(raiz, carpetaAntigua)), []);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("mueve bancos legibles guardados en la antigua carpeta con hash", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-carpeta-antigua-"));
  const seleccion = {
    asignatura: "WEC",
    tema: 1,
    apartado: 0,
    titulo: "Tema 1",
    revision: "revision",
    archivosOrigen: [],
  };
  try {
    const creado = await anadirPreguntasAlBanco(
      { ...seleccion, preguntasNuevas: [crearPregunta("¿Qué caracteriza una página web?")] },
      { raiz },
    );
    const resumen = createHash("sha256").update("WEC").digest("hex").slice(0, 10);
    const rutaAnterior = path.join(
      raiz,
      `wec-${resumen}`,
      "WEC-temas-1-apartado-0.json",
    );
    const rutaActual = path.join(raiz, "WEC", "WEC-temas-1-apartado-0.json");
    const contenido = await readFile(rutaActual, "utf8");
    await mkdir(path.dirname(rutaAnterior), { recursive: true });
    await writeFile(rutaAnterior, contenido);
    await rm(rutaActual);

    const bancos = await listarBancosPreguntas({ raiz });
    assert.equal(bancos.length, 1);
    assert.equal(bancos[0].clave, creado.clave);
    assert.deepEqual(await readdir(path.join(raiz, "WEC")), [
      "WEC-temas-1-apartado-0.json",
    ]);
    assert.deepEqual(await readdir(path.join(raiz, `wec-${resumen}`)), []);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("no sobrescribe un banco corrupto y conserva escritura atómica", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-corrupto-"));
  const seleccion = {
    asignatura: "WEC",
    tema: 4,
    apartado: 1,
    titulo: "Funciones",
    revision: "revision",
    archivosOrigen: [],
  };
  try {
    await anadirPreguntasAlBanco(
      { ...seleccion, preguntasNuevas: [crearPregunta("¿Qué devuelve una función?")] },
      { raiz },
    );
    const anterior = await leerBancoPreguntas(
      { asignatura: "WEC", tema: 4, apartado: 1 },
      { raiz },
    );
    const carpetas = await readdir(raiz);
    assert.equal(carpetas.length, 1);
    const archivos = await readdir(path.join(raiz, carpetas[0]));
    assert.equal(archivos.length, 1);
    const ruta = path.join(raiz, carpetas[0], archivos[0]);
    await writeFile(ruta, '{"formato":"ajeno","version":1}', "utf8");
    await assert.rejects(
      anadirPreguntasAlBanco(
        { ...seleccion, preguntasNuevas: [crearPregunta("Otra pregunta de prueba")] },
        { raiz },
      ),
      /formato incompatible/,
    );
    assert.notEqual(await readFile(ruta, "utf8"), JSON.stringify(anterior));
    assert.equal((await readdir(path.join(raiz, carpetas[0]))).length, 1);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("guarda un JSON independiente por cada tema y los combina al leerlos", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-multitema-"));
  const seleccion = {
    asignatura: "WEC",
    tema: 0,
    temas: [1, 2],
    apartado: 0,
    titulo: "Temas 1 y 2",
    revision: "revision-conjunta",
    archivosOrigen: ["WEC/Tema 1/tema.tex", "WEC/Tema 2/tema.tex"],
  };
  try {
    const banco = await anadirPreguntasAlBanco(
      {
        ...seleccion,
        preguntasNuevas: [
          {
            ...crearPregunta("¿Qué diferencia un selector de clase de un selector de identificador en CSS?"),
            tema: 1,
          },
          {
            ...crearPregunta("¿Cómo se accede a una propiedad del objeto ventana del navegador?"),
            tema: 2,
          },
        ],
      },
      { raiz },
    );
    const cargado = await leerBancoPreguntas(seleccion, { raiz });
    assert.deepEqual(cargado.meta.temas, [1, 2]);
    assert.equal(cargado.preguntas.length, 2);
    assert.deepEqual(
      (await listarBancosPreguntas({ raiz })).map((banco) => banco.tema),
      [1, 2],
    );
    assert.deepEqual(
      (await readdir(path.join(raiz, "WEC"))).sort(),
      ["WEC-temas-1-apartado-0.json", "WEC-temas-2-apartado-0.json"],
    );
    assert.notEqual(
      banco.clave,
      (await anadirPreguntasAlBanco(
        {
          ...seleccion,
          asignatura: "DIW",
          preguntasNuevas: [],
        },
        { raiz },
      )).clave,
    );
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test("divide el antiguo banco multitema al guardar y conserva todas sus preguntas", async () => {
  const raiz = await mkdtemp(path.join(os.tmpdir(), "preparar-tests-migrar-multitema-"));
  const seleccion = {
    asignatura: "WEC",
    tema: 0,
    temas: [1, 2],
    apartado: 0,
    titulo: "Temas 1 y 2",
    revision: "revision-conjunta",
    archivosOrigen: ["WEC/Tema 1/tema1.pdf", "WEC/Tema 2/tema2.zip"],
  };
  try {
    await anadirPreguntasAlBanco(
      {
        ...seleccion,
        preguntasNuevas: [
          { ...crearPregunta("¿Qué es el modelo cliente-servidor?"), tema: 1 },
          { ...crearPregunta("¿Qué objeto representa la ventana del navegador?"), tema: 2 },
        ],
      },
      { raiz },
    );
    const archivosTemas = [
      path.join(raiz, "WEC", "WEC-temas-1-apartado-0.json"),
      path.join(raiz, "WEC", "WEC-temas-2-apartado-0.json"),
    ];
    const bancosTemas = await Promise.all(
      archivosTemas.map(async (archivo) => JSON.parse(await readFile(archivo, "utf8"))),
    );
    await writeFile(
      path.join(raiz, "WEC", "WEC-temas-1-2-apartado-0.json"),
      JSON.stringify({
        ...bancosTemas[0],
        clave: "WEC-temas-1-2-apartado-0",
        meta: { ...bancosTemas[0].meta, tema: 0, temas: [1, 2] },
        preguntas: bancosTemas.flatMap((banco) => banco.preguntas),
      }),
    );
    await Promise.all(archivosTemas.map((archivo) => rm(archivo)));

    await anadirPreguntasAlBanco(
      {
        ...seleccion,
        revision: "revision-actualizada",
        revisionesPorTema: { 1: "rev-1", 2: "rev-2" },
        archivosOrigenPorTema: {
          1: ["WEC/Tema 1/tema1.pdf"],
          2: ["WEC/Tema 2/tema2.zip"],
        },
        preguntasNuevas: [
          { ...crearPregunta("¿Qué función cumple el servidor en el modelo web?"), tema: 1 },
        ],
      },
      { raiz },
    );

    const bancos = await listarBancosPreguntas({ raiz });
    assert.deepEqual(bancos.map((banco) => banco.tema), [1, 2]);
    const primerTema = await leerBancoPreguntas(
      { asignatura: "WEC", tema: 1, temas: [1], apartado: 0 },
      { raiz },
    );
    assert.equal(primerTema.preguntas.length, 2);
    assert.equal(primerTema.revision, "rev-1");
    const combinado = await leerBancoPreguntas(seleccion, { raiz });
    assert.equal(combinado.preguntas.length, 3);
    assert.deepEqual(
      (await readdir(path.join(raiz, "WEC"))).sort(),
      ["WEC-temas-1-apartado-0.json", "WEC-temas-2-apartado-0.json"],
    );
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});
