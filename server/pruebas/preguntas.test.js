import assert from "node:assert/strict";
import test from "node:test";
import {
  analizarRespuestaIA,
  crearPromptPreguntas,
  dividirDocumentos,
  filtrarPreguntasPorEjemplos,
  normalizarPregunta,
  validarSolicitudGeneracion,
} from "../preguntas.js";

const preguntaValida = {
  tema: 4,
  tipo: "teoria",
  tag: "Arrays",
  dificultad: "media",
  enunciado: "¿Qué representa el índice de una posición?",
  opciones: {
    A: "La posición del elemento",
    B: "El número de elementos",
    C: "La capacidad reservada",
    D: "El tipo de dato",
  },
  correcta: "A",
  explicacion: "El índice permite localizar un elemento.",
  explicacionClara: "Un índice es como el número de casilla que permite encontrar un elemento.",
};

test("valida cuatro opciones, una respuesta y una traza completa para código", () => {
  const normalizada = normalizarPregunta(preguntaValida);
  assert.equal(normalizada.correcta, "A");
  assert.equal(normalizada.explicacionClara, preguntaValida.explicacionClara);
  assert.equal(normalizada.apartado, 0);
  assert.equal(normalizada.apartadoNombre, "");
  const preguntaPorApartado = normalizarPregunta({
    ...preguntaValida,
    apartado: 2,
    apartadoNombre: "Arrays",
  });
  assert.equal(preguntaPorApartado.apartado, 2);
  assert.equal(preguntaPorApartado.apartadoNombre, "Arrays");
  assert.throws(
    () => normalizarPregunta({ ...preguntaValida, apartado: -1 }),
    /apartado inválido/,
  );
  assert.throws(
    () => normalizarPregunta({ ...preguntaValida, opciones: { A: "solo una" } }),
    /cuatro opciones/,
  );
  assert.throws(
    () =>
      normalizarPregunta({
        ...preguntaValida,
        opciones: { A: "Respuesta", B: "respuesta ", C: "Otra", D: "Última" },
      }),
    /opciones repetidas/,
  );
  assert.throws(
    () => normalizarPregunta({ ...preguntaValida, explicacionClara: "" }),
    /explicación didáctica/,
  );
  assert.throws(
    () =>
      normalizarPregunta({
        ...preguntaValida,
        tipo: "codigo",
        codigo: "console.log(1)",
      }),
    /traza paso a paso/,
  );
  assert.doesNotThrow(() =>
    normalizarPregunta({
      ...preguntaValida,
      tipo: "codigo",
      codigo: "console.log(1)",
      traza: [{ linea: 1, nota: "Se imprime 1", salida: "1" }],
    }),
  );
});

test("interpreta JSON de Ollama y rechaza respuestas inválidas", () => {
  const salida = analizarRespuestaIA(
    `\`\`\`json\n${JSON.stringify({ preguntas: [preguntaValida] })}\n\`\`\``,
  );
  assert.equal(salida.length, 1);
  assert.equal(salida[0].enunciado, preguntaValida.enunciado);
  assert.throws(() => analizarRespuestaIA("no es JSON"), /JSON válido/);
});

test("divide todo el material en bloques sin cortar texto ni exceder el límite", () => {
  const palabras = Array.from({ length: 1200 }, (_, indice) => `palabra${indice}`);
  const original = palabras.join(" ");
  const bloques = dividirDocumentos([
    { nombre: "tema.tex", titulo: "Tema de prueba", texto: original },
  ]);
  assert.ok(bloques.length > 1);
  assert.ok(bloques.every((bloque) => bloque.texto.length <= 10000));
  assert.equal(bloques.map((bloque) => bloque.texto).join(" "), original);
});

test("detecta ejemplos en prosa y bloques de código con referencias estables", () => {
  const documento = {
    nombre: "Tema 1/ejemplos.tex",
    titulo: "Ejemplos",
    tema: 1,
    texto: [
      "Por ejemplo, una lista puede almacenar las temperaturas de varios días.",
      "Código de ejemplo:\nconst temperaturas = [18, 20, 23];",
    ].join("\n\n"),
  };
  const [primero] = dividirDocumentos([documento]);
  const [repetido] = dividirDocumentos([documento]);
  assert.equal(primero.ejemplos.length, 2);
  assert.deepEqual(
    primero.ejemplos.map(({ tipo }) => tipo),
    ["ejemplo", "codigo"],
  );
  assert.deepEqual(
    primero.ejemplos.map(({ id }) => id),
    repetido.ejemplos.map(({ id }) => id),
  );
});

test("conserva tema y apartado de origen al dividir material de varios temas", () => {
  const bloques = dividirDocumentos([
    {
      nombre: "Tema 4/Tema 4.2/arrays.tex",
      titulo: "Arrays",
      tema: 4,
      apartado: 2,
      apartadoNombre: "Arrays",
      texto: "Los arrays guardan elementos ordenados.",
    },
    {
      nombre: "Tema 5/Tema 5.1/objetos.tex",
      titulo: "Objetos",
      tema: 5,
      apartado: 1,
      apartadoNombre: "Objetos",
      texto: "Los objetos agrupan propiedades.",
    },
  ]);
  assert.deepEqual(
    bloques.map(({ tema, apartado, apartadoNombre }) => ({
      tema,
      apartado,
      apartadoNombre,
    })),
    [
      { tema: 4, apartado: 2, apartadoNombre: "Arrays" },
      { tema: 5, apartado: 1, apartadoNombre: "Objetos" },
    ],
  );
});

test("solo da por cubierta una referencia objetivo con pregunta transformada", () => {
  const objetivos = [
    { id: "ej-prosa", tipo: "ejemplo", texto: "Por ejemplo, una lista puede almacenar las temperaturas de varios días." },
    { id: "ej-codigo", tipo: "codigo", texto: "const temperaturas = [18, 20, 23];" },
  ];
  const preguntaProsa = {
    ...preguntaValida,
    ejemploId: "ej-prosa",
    enunciado: "¿Qué estructura permite guardar los máximos diarios?",
  };
  const preguntaCodigo = {
    ...preguntaValida,
    ejemploId: "ej-codigo",
    tipo: "codigo",
    codigo: "const maximas = [25, 27, 24];",
    traza: [{ linea: 1, nota: "Se crea una lista nueva.", vars: {} }],
  };
  const copiaLiteral = {
    ...preguntaValida,
    ejemploId: "ej-prosa",
    enunciado: "Por ejemplo, una lista puede almacenar las temperaturas de varios días.",
  };
  const codigoLiteral = {
    ...preguntaCodigo,
    codigo: "const temperaturas = [18, 20, 23];",
  };
  const filtradas = filtrarPreguntasPorEjemplos(
    [
      { ...preguntaValida, ejemploId: "no-solicitado" },
      preguntaProsa,
      copiaLiteral,
      preguntaCodigo,
      codigoLiteral,
    ],
    objetivos,
  );
  assert.deepEqual(filtradas, [preguntaProsa, preguntaCodigo]);
});

test("el prompt distingue modo de examen y evita preguntas anteriores", () => {
  const prompt = crearPromptPreguntas({
    asignatura: "WEC",
    alcance: "WEC · Tema 4 · Apartado 4.2",
    bloque: {
      nombre: "4.2.1-arrays.tex",
      titulo: "Arrays",
      texto: "Los arrays guardan elementos ordenados. Por ejemplo, se puede almacenar la temperatura de cada día.",
    },
    cantidad: 4,
    modoExamen: "personalizado",
    contextoExamen: "El examen pregunta sobre índices y código.",
    tipoPreguntas: "mixto",
    preguntasExistentes: [{ enunciado: "¿Qué es un array?" }],
    temaDocumento: 4,
    apartadoDocumento: 2,
    nombreApartado: "Arrays",
  });
  assert.match(prompt, /El examen pregunta sobre índices y código/);
  assert.match(prompt, /¿Qué es un array\?/);
  assert.match(prompt, /WEC · Tema 4 · Apartado 4\.2/);
  assert.match(prompt, /El apartado de origen es 2 \(Arrays\)/);
  assert.match(prompt, /no mezcles sus etiquetas/);
  assert.match(prompt, /Redacta en castellano todos los enunciados/);
  assert.match(prompt, /conserva sin traducir sus nombres, las palabras reservadas y los identificadores incluso al citarlos en prosa/);
  assert.match(prompt, /"function", no "función" ni "FUNCTION"/);
  assert.match(prompt, /capitalización propias del lenguaje/);
  assert.match(prompt, /explicacionClara/);
  assert.match(prompt, /paso a paso/);
  assert.match(prompt, /conocimientos y procedimientos importantes/);
  assert.match(prompt, /una sola respuesta defendible/);
  assert.match(prompt, /Preguntas existentes/);
  assert.match(prompt, /todos los ejemplos, casos y bloques de código/);
  assert.match(prompt, /cambia el contexto, los datos, los nombres o el código/);
  assert.match(prompt, /No copies el texto ni el código del apunte/);
  assert.match(prompt, /temperatura de cada día/);
  const promptConEjemplo = crearPromptPreguntas({
    asignatura: "WEC",
    alcance: "WEC · Tema 4",
    bloque: {
      nombre: "ejemplos.tex",
      titulo: "Arrays",
      tema: 4,
      texto: "Por ejemplo, guardar temperaturas.",
    },
    cantidad: 1,
    modoExamen: "predeterminado",
    contextoExamen: "",
    tipoPreguntas: "mixto",
    preguntasExistentes: [],
    ejemplosObjetivo: [{
      id: "ej-123",
      tipo: "ejemplo",
      texto: "Por ejemplo, guardar temperaturas.",
    }],
  });
  assert.match(promptConEjemplo, /COBERTURA OBLIGATORIA/);
  assert.match(promptConEjemplo, /ej-123/);
  assert.match(promptConEjemplo, /"ejemploId"/);
});

test("valida cantidad, alcance y contexto del examen antes de consultar Ollama", () => {
  assert.deepEqual(
    validarSolicitudGeneracion({
      asignatura: "WEC",
      tema: 4,
      apartado: 2,
      cantidad: 10,
      modoExamen: "predeterminado",
      tipoPreguntas: "mixto",
    }),
    {
      asignatura: "WEC",
      tema: 4,
      temas: [4],
      apartado: 2,
      cantidad: 10,
      modoExamen: "predeterminado",
      contextoExamen: "",
      tipoPreguntas: "mixto",
      context: "",
      instrucciones: "",
    },
  );
  assert.throws(
    () =>
      validarSolicitudGeneracion({
        asignatura: "WEC",
        tema: 4,
        cantidad: 10,
        modoExamen: "personalizado",
        contextoExamen: "test",
      }),
    /al menos 10 caracteres/,
  );
  assert.throws(
    () =>
      validarSolicitudGeneracion({
        asignatura: "WEC",
        tema: 4,
        cantidad: 7001,
      }),
    /entre 1 y 7000/,
  );
});

test("transmite el contexto de estudio y las instrucciones de generación", () => {
  const solicitud = validarSolicitudGeneracion({
    asignatura: "WEC",
    tema: 1,
    cantidad: 3,
    modoExamen: "personalizado",
    contextoExamen: "un contexto de examen con más de diez caracteres",
    tipoPreguntas: "teoria",
    context: "texto libre de estudio para generar preguntas",
    instrucciones: "no repitas estos enunciados: ejemplo viejo",
  });
  assert.equal(solicitud.context, "texto libre de estudio para generar preguntas");
  assert.equal(solicitud.instrucciones, "no repitas estos enunciados: ejemplo viejo");
  assert.equal(solicitud.tema, 1);
  assert.deepEqual(solicitud.temas, [1]);
});

test("valida selecciones múltiples y todos los temas sin apartado", () => {
  const solicitud = validarSolicitudGeneracion({
    asignatura: "WEC",
    temas: [1, 2, 2],
    apartado: 0,
    cantidad: 120,
  });
  assert.equal(solicitud.tema, 0);
  assert.deepEqual(solicitud.temas, [1, 2]);
  assert.equal(
    validarSolicitudGeneracion({
      asignatura: "WEC",
      temas: "todos",
      cantidad: 10,
    }).temas,
    "todos",
  );
  assert.throws(
    () =>
      validarSolicitudGeneracion({
        asignatura: "WEC",
        temas: [1, 2],
        apartado: 1,
      }),
    /un solo tema/,
  );
});
