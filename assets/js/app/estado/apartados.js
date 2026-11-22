"use strict";

function limpiarTituloApartado(texto) {
  let limpio = String(texto || "").trim();
  limpio = limpio
    .replace(/Col[·•.\s]*legi[\s\S]*$/i, "")
    .replace(/Math\..*$/i, "")
    .replace(/localStorage[\s\S]*$/i, "")
    .replace(/^[·•\s-]+/, "")
    .trim();

  const mTema = limpio.match(/Tema\s*\d+(?:\.\d+)*\s*[:·-]\s*([^·\n\r]{3,60})/i);
  if (mTema && mTema[1]) {
    limpio = mTema[1].trim();
  } else {
    limpio = limpio.replace(/^ABANS DE COMENÇAR[^·\n\r]*[·\n\r]*/i, "").trim();
    const partes = limpio.split(/[·\n\r]/).map((p) => p.trim()).filter(Boolean);
    if (partes.length > 1) {
      const candidata = partes.find(
        (p) =>
          p.length >= 4 &&
          p.length <= 60 &&
          !p.toLowerCase().includes("col") &&
          !p.toLowerCase().includes("abans") &&
          !p.toLowerCase().includes("desenvolupament web"),
      );
      if (candidata) limpio = candidata;
    }
  }

  limpio = limpio
    .replace(/^Tema\s*\d+(?:\.\d+)*\s*[:·-]?\s*/i, "")
    .replace(/^[·•\s-]+/, "")
    .replace(/[·•\s-]+$/, "")
    .trim();

  if (limpio.toLowerCase() === "undefined" || limpio.toLowerCase() === "null") {
    return "Variables y tipos primitivos";
  }

  if (limpio.length > 55) {
    limpio = limpio.slice(0, 52) + "…";
  }
  return limpio;
}

function resolveApartadoForQuestion(q) {
  if (!q) return { tema: 1, apartado: 0, codigo: "Tema 1", titulo: "Tema 1", tag: "" };
  const temaNum = Number(q.tema) || 1;
  let apNum = Number(q.apartado) || 0;
  let apNombre = q.apartadoNombre || "";

  const currentSubject = state.subject?.nombre || "WEC";
  const apuntesEntry = (state.apuntesCatalogo || []).find(
    (a) => a.nombre.toLowerCase() === currentSubject.toLowerCase(),
  );

  if (!apNum && apuntesEntry?.temas) {
    const temaObj = apuntesEntry.temas.find((t) => Number(t.numero) === temaNum);
    if (temaObj?.apartados) {
      const matchWords = (s1, s2) => {
        const w1 = (s1 || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 4);
        const w2 = (s2 || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 4);
        return w1.some((w) => w2.includes(w));
      };
      const foundAp = temaObj.apartados.find(
        (ap) => matchWords(q.tag, ap.nombre) || matchWords(q.apartadoNombre, ap.nombre),
      );
      if (foundAp) {
        apNum = Number(foundAp.numero);
        apNombre = foundAp.nombre;
      }
    }
  }

  if (!apNum && temaNum === 1) {
    const t = String(q.tag || "").toLowerCase();
    if (t.includes("origen") || t.includes("diseño") || t.includes("cliente-servidor") || t.includes("capas")) {
      apNum = 1; apNombre = "Origen y alcance de la web";
    } else if (t.includes("lenguaje") || t.includes("scripts")) {
      apNum = 2; apNombre = "Lenguajes de programación en entorno cliente";
    } else if (t.includes("arquitectura") || t.includes("motor") || t.includes("límite")) {
      apNum = 3; apNombre = "Arquitectura del navegador y motores de ejecución";
    } else if (t.includes("comunica") || t.includes("red")) {
      apNum = 4; apNombre = "Subsistema de comunicaciones";
    } else if (t.includes("intèrpret") || t.includes("ejecución")) {
      apNum = 5; apNombre = "Intérprete de JavaScript";
    } else if (t.includes("html") || t.includes("integración") || t.includes("dom") || t.includes("form") || t.includes("valida")) {
      apNum = 6; apNombre = "Integración con HTML y eventos";
    } else if (t.includes("seguridad") || t.includes("herramienta")) {
      apNum = 7; apNombre = "Seguridad web y herramientas de cliente";
    }
  } else if (!apNum && temaNum === 2) {
    const t = String(q.tag || "").toLowerCase();
    if (t.includes("undefined") || t.includes("null") || t.includes("variable") || t.includes("primitivo") || t.includes("reservada")) {
      apNum = 1; apNombre = "Variables y tipos primitivos";
    } else if (t.includes("operador") || t.includes("asignac") || t.includes("booleano") || t.includes("falsy") || t.includes("precedencia") || t.includes("ternario")) {
      apNum = 2; apNombre = "Operadores y expresiones";
    } else if (t.includes("bucle") || t.includes("for") || t.includes("while") || t.includes("break") || t.includes("continue") || t.includes("switch") || t.includes("if")) {
      apNum = 3; apNombre = "Estructuras de control y bucles";
    } else if (t.includes("comentario") || t.includes("depurac")) {
      apNum = 4; apNombre = "Comentarios y depuración de código";
    } else {
      apNum = 1; apNombre = "Sintaxis, tipos y operadores";
    }
  }

  let subTitulo = apNombre ? limpiarTituloApartado(apNombre) : "";
  if (!subTitulo || subTitulo.toLowerCase() === "undefined" || subTitulo.toLowerCase() === "null") {
    subTitulo = temaNum === 2 ? "Variables y tipos primitivos" : `Tema ${temaNum} · Contenidos generales`;
  }

  const tagClean = String(q.tag || "").trim();
  const concepto = (tagClean && tagClean.toLowerCase() !== "sin clasificar" && tagClean.toLowerCase() !== "undefined")
    ? tagClean
    : (tagClean.toLowerCase() === "undefined" ? "Tipo undefined" : "");

  return {
    tema: temaNum,
    apartado: apNum,
    codigo: apNum ? `${temaNum}.${apNum}` : `Tema ${temaNum}`,
    titulo: subTitulo,
    tag: concepto,
  };
}

function getWeakSubapartados(topN = 20) {
  const wrong = new Set(getWrongIds().map((id) => getQuestion(id)?.id || id));
  const history = getHistory();
  const bySub = new Map();

  state.questions.forEach((q) => {
    if (!wrong.has(q.id)) return;
    const h = history[q.id] || {};
    const fails = Math.max(1, Number(h.fails) || 1);

    const res = resolveApartadoForQuestion(q);
    const key = `t${res.tema}-ap${res.apartado || res.titulo}`;

    const cur = bySub.get(key) || {
      key,
      tema: res.tema,
      apartado: res.apartado,
      codigo: res.codigo,
      titulo: res.titulo,
      fails: 0,
      total: 0,
      tags: new Set(),
      ids: [],
    };
    cur.fails += fails;
    cur.total += 1;
    if (res.tag) {
      cur.tags.add(res.tag);
    }
    cur.ids.push(q.id);
    bySub.set(key, cur);
  });

  return [...bySub.values()]
    .map((item) => {
      const allInSub = state.questions.filter((q) => {
        const r = resolveApartadoForQuestion(q);
        return r.tema === item.tema && r.apartado === item.apartado;
      });
      const answeredInSub = allInSub.filter((q) => history[q.id]?.selected != null);
      const denominator = answeredInSub.length || item.total;
      const pctFallo = denominator ? Math.min(100, Math.round((item.total / denominator) * 100)) : 100;
      return {
        ...item,
        pctFallo,
        totalBanco: allInSub.length,
        tags: [...item.tags],
      };
    })
    .sort((a, b) => b.pctFallo - a.pctFallo || b.fails - a.fails || b.total - a.total)
    .slice(0, topN);
}

function getWeakSubapartadosByTema() {
  const allWeak = getWeakSubapartados(50);
  const byTema = new Map();

  allWeak.forEach((sub) => {
    const t = sub.tema;
    const cur = byTema.get(t) || {
      tema: t,
      subapartados: [],
      totalFails: 0,
      totalPreguntasFalladas: 0,
      allIds: [],
    };
    cur.subapartados.push(sub);
    cur.totalFails += sub.fails;
    cur.totalPreguntasFalladas += sub.total;
    cur.allIds.push(...sub.ids);
    byTema.set(t, cur);
  });

  return [...byTema.values()]
    .sort((a, b) => a.tema - b.tema)
    .map((group) => {
      const uniqueIds = [...new Set(group.allIds)];
      const avgFailPct = group.subapartados.length
        ? Math.round(group.subapartados.reduce((acc, s) => acc + s.pctFallo, 0) / group.subapartados.length)
        : 100;
      group.subapartados.sort((a, b) => b.pctFallo - a.pctFallo || b.fails - a.fails);
      return {
        ...group,
        uniqueIds,
        failRate: avgFailPct,
      };
    });
}

function getWeakConcepts(topN = 8) {
  const wrong = new Set(getWrongIds().map((id) => getQuestion(id)?.id || id));
  const history = getHistory();
  const byTag = new Map();
  state.questions.forEach((q) => {
    if (!wrong.has(q.id)) return;
    const h = history[q.id] || {};
    const fails = Math.max(1, Number(h.fails) || 1);
    const rawTag = q.tag || q.apartadoNombre || "";
    const tagStr = String(rawTag).trim();
    if (
      !tagStr ||
      tagStr.toLowerCase() === "undefined" ||
      tagStr.toLowerCase() === "null" ||
      tagStr.toLowerCase() === "sin clasificar"
    ) {
      return;
    }
    const cur = byTag.get(tagStr) || { tag: tagStr, fails: 0, total: 0, ids: [] };
    cur.fails += fails;
    cur.total += 1;
    cur.ids.push(q.id);
    byTag.set(tagStr, cur);
  });
  return [...byTag.values()]
    .sort(
      (a, b) =>
        b.fails - a.fails ||
        b.total - a.total ||
        (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0),
    )
    .slice(0, topN);
}

const LS_AI_GENERADAS = "wec12_ai_generadas_v1";

function readAiGeneratedMap() {
  const value = readJSON(LS_AI_GENERADAS, {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function writeAiGeneratedMap(map) {
  writeJSON(LS_AI_GENERADAS, map);
}
function getAiGenerated(subjectId) {
  const entry = readAiGeneratedMap()[subjectId || "default"];
  return entry && Array.isArray(entry.enunciados) ? entry.enunciados : [];
}
function recordAiGenerated(subjectId, enunciados) {
  const map = readAiGeneratedMap();
  map[subjectId || "default"] = {
    enunciados: Array.isArray(enunciados) ? enunciados.slice(-300) : [],
    updatedAt: new Date().toISOString(),
  };
  writeAiGeneratedMap(map);
}
