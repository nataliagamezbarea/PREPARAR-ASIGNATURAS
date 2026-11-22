import assert from "node:assert/strict";
import test from "node:test";
import {
  guardarPreguntas,
  leerPreguntas,
  guardarRespuesta,
  leerRespuestas,
  estadisticasCache,
  limpiarCache,
} from "../cache.js";

const preguntaEjemplo = {
  id: 99,
  tema: 1,
  tipo: "teoria",
  tag: "Cache",
  dificultad: "baja",
  enunciado: "¿Qué es una caché?",
  opciones: { A: "Almacenamiento rápido", B: "Un virus", C: "Un cable", D: "Una impresora" },
  correcta: "A",
  explicacion: "Guarda datos para acceder más rápido la próxima vez.",
};

test("guarda y lee preguntas en caché", async () => {
  await limpiarCache();
  await guardarPreguntas([preguntaEjemplo]);
  const preguntas = await leerPreguntas();
  assert.equal(preguntas.length, 1);
  assert.equal(preguntas[0].id, 99);
});

test("guarda y lee respuestas en caché", async () => {
  await limpiarCache();
  await guardarRespuesta({
    preguntaId: 99,
    enunciado: preguntaEjemplo.enunciado,
    respuestaUsuario: "A",
    correcta: true,
    explicacion: preguntaEjemplo.explicacion,
  });
  const respuestas = await leerRespuestas();
  assert.equal(respuestas.length, 1);
  assert.equal(respuestas[0].preguntaId, 99);
  assert.equal(respuestas[0].correcta, true);
});

test("estadísticas de caché son coherentes", async () => {
  await limpiarCache();
  await guardarPreguntas([preguntaEjemplo, { ...preguntaEjemplo, id: 100 }]);
  await guardarRespuesta({
    preguntaId: 99,
    enunciado: "x",
    respuestaUsuario: "A",
    correcta: true,
    explicacion: "y",
  });
  await guardarRespuesta({
    preguntaId: 100,
    enunciado: "x",
    respuestaUsuario: "B",
    correcta: false,
    explicacion: "y",
  });
  const stats = await estadisticasCache();
  assert.equal(stats.preguntasGuardadas, 2);
  assert.equal(stats.respuestasGuardadas, 2);
  assert.equal(stats.aciertos, 1);
  assert.equal(stats.fallos, 1);
});

test("limpiarCache vacía todo", async () => {
  await limpiarCache();
  const stats = await estadisticasCache();
  assert.equal(stats.preguntasGuardadas, 0);
  assert.equal(stats.respuestasGuardadas, 0);
});
