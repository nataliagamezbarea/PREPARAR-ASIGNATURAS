import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const RAIZ = new URL("../../tests/fixtures/", import.meta.url);

async function leerJSON(archivo) {
  return JSON.parse(await readFile(new URL(archivo, RAIZ), "utf8"));
}

test("la fixture de asignaturas tiene al menos una asignatura con temas", async () => {
  const data = await leerJSON("asignaturas.json");
  assert.ok(Array.isArray(data.asignaturas) && data.asignaturas.length >= 1);
  const asig = data.asignaturas[0];
  assert.ok(asig.id && asig.nombre);
  assert.ok(Array.isArray(asig.temas) && asig.temas.length >= 1);
});

test("la fixture de preguntas tiene 4 preguntas con opciones A-D y explicación", async () => {
  const data = await leerJSON("preguntas.json");
  assert.equal(data.meta.total, 4);
  assert.equal(data.preguntas.length, 4);
  for (const p of data.preguntas) {
    assert.ok(p.id, "pregunta sin id");
    assert.ok(p.enunciado, `pregunta ${p.id} sin enunciado`);
    assert.ok(p.opciones && p.opciones.A && p.opciones.B && p.opciones.C && p.opciones.D, `pregunta ${p.id} sin 4 opciones`);
    assert.ok(["A", "B", "C", "D"].includes(p.correcta), `pregunta ${p.id} correcta inválida`);
    assert.ok(p.opciones[p.correcta], `pregunta ${p.id} texto de la correcta vacío`);
    assert.ok(p.explicacion, `pregunta ${p.id} sin explicación`);
  }
});

test("las respuestas correctas de la fixture se reparten entre letras", async () => {
  const data = await leerJSON("preguntas.json");
  const cuenta = { A: 0, B: 0, C: 0, D: 0 };
  for (const p of data.preguntas) cuenta[p.correcta]++;
  const letrasUsadas = Object.values(cuenta).filter((n) => n > 0).length;
  assert.ok(letrasUsadas >= 2, "las correctas deberían usar al menos dos letras distintas");
});

test("la fixture de fallos tiene wrongIds y stats coherentes", async () => {
  const data = await leerJSON("fallos.json");
  assert.ok(Array.isArray(data.wrongIds));
  assert.ok(data.stats && typeof data.stats.lastPct === "number");
  for (const id of data.wrongIds) {
    assert.ok(data.history[id], `falta historial para la pregunta fallida ${id}`);
  }
});

test("la fixture de config tiene claves de Supabase como placeholders sin valor real", async () => {
  const data = await leerJSON("config.json");
  assert.ok(data.supabase && data.supabase.url && data.supabase.anonKey);
  assert.ok(data.supabase.url.includes("supabase.co"), "la URL de Supabase debería ser un placeholder");
  assert.notEqual(data.supabase.anonKey, "", "la anonKey debe estar presente aunque sea placeholder");
});
