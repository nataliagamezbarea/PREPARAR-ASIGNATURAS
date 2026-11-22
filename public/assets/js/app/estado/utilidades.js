"use strict";

const LS = {
  session: "wec12_session_v1",
  wrong: "wec12_wrong_v1",
  history: "wec12_history_v1",
  stats: "wec12_stats_v1",
  theme: "wec12_theme_v1",
  subject: "wec12_subject_v1",
  custom: "wec12_custom_subjects_v1",
  ai: "wec12_ai_url_v1"
};

const DEFAULT_CATALOG = [
  { id: "wec", nombre: "WEC", archivo: "./data/asignaturas/wec/preguntas.json", descripcion: "Temas 1, 2, 3 y 4 · Banco de preguntas" }
];

const state = {
  meta: null,
  questions: [],
  byId: new Map(),
  order: [],
  index: 0,
  answers: {},
  immediate: true,
  startedAt: 0,
  finished: false,
  screen: "start",
  source: "embedded",
  selectedFilter: "all",
  wrongFilter: "todos",
  catalog: [],
  errorCatalogoApuntes: "",
  subjectId: "",
  subject: null,
  apuntesCatalogo: [],
  sampleSize: 0,
  masteryMode: false,
  masteryRound: 0,
  ramaActual: ""
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const main = $("#main");
const toastEl = $("#toast");
let toastTimer = null;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatText(value) {
  if (value == null) return "";
  let text = String(value);

  // 1. Extraer bloques de código multilínea (1 a 4 backticks)
  const codeBlocks = [];
  const codeRegex = /(^|\n|:\s*)[ \t]*(`{1,4})([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)(?:\r?\n[ \t]*\2[ \t]*(?:\r?\n|$)|(?:\r?\n[ \t]*`{1,4}[ \t]*(?:\r?\n|$))|$)/g;
  text = text.replace(codeRegex, (match, prefix, fence, lang, code) => {
    const idx = codeBlocks.length;
    const escapedCode = String(code)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .trim();
    const langHtml = lang ? `<div class="md-code-header"><span class="md-code-lang">${esc(lang)}</span></div>` : "";
    codeBlocks.push(
      `<div class="md-code-wrapper">${langHtml}<pre class="md-code-block"><code>${escapedCode}</code></pre></div>`
    );
    return `${prefix ? prefix.trimEnd() : ""}\n@@@MDCODE${idx}@@@\n`;
  });

  // 2. Extraer código inline `code`
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="md-inline-code">${esc(code)}</code>`);
    return `@@@MDINL${idx}@@@`;
  });

  // 3. Escapar el resto del texto antes de formatear etiquetas
  text = esc(text);

  // 4. Negritas y cursivas
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*]+)\*([^*]|$)/g, "$1<em>$2</em>$3");
  text = text.replace(/(^|[^_])_([^_]+)_([^_]|$)/g, "$1<em>$2</em>$3");

  // 5. Procesar líneas para markdown estructurado
  const lines = text.split(/\r?\n/);
  const outLines = [];
  let inOl = false;
  let inUl = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.includes("@@@MDCODE")) {
      if (inOl) { outLines.push("</ol>"); inOl = false; }
      if (inUl) { outLines.push("</ul>"); inUl = false; }
      outLines.push(trimmed);
      continue;
    }

    const mOl = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (mOl) {
      if (!inOl) {
        if (inUl) { outLines.push("</ul>"); inUl = false; }
        outLines.push('<ol class="md-list">');
        inOl = true;
      }
      outLines.push(`<li>${mOl[2]}</li>`);
      continue;
    } else if (inOl) {
      outLines.push("</ol>");
      inOl = false;
    }

    const mUl = trimmed.match(/^[-*•+]\s+(.*)$/);
    if (mUl) {
      if (!inUl) {
        if (inOl) { outLines.push("</ol>"); inOl = false; }
        outLines.push('<ul class="md-list">');
        inUl = true;
      }
      outLines.push(`<li>${mUl[1]}</li>`);
      continue;
    } else if (inUl) {
      outLines.push("</ul>");
      inUl = false;
    }

    const mH4 = trimmed.match(/^####\s+(.*)$/);
    const mH3 = trimmed.match(/^###\s+(.*)$/);
    const mH2 = trimmed.match(/^##\s+(.*)$/);
    const mH1 = trimmed.match(/^#\s+(.*)$/);

    if (mH4) {
      outLines.push(`<h5 class="md-heading md-h4">${mH4[1]}</h5>`);
    } else if (mH3) {
      outLines.push(`<h4 class="md-heading md-h3">${mH3[1]}</h4>`);
    } else if (mH2) {
      outLines.push(`<h3 class="md-heading md-h2">${mH2[1]}</h3>`);
    } else if (mH1) {
      outLines.push(`<h2 class="md-heading md-h1">${mH1[1]}</h2>`);
    } else if (trimmed.startsWith("&gt;")) {
      outLines.push(`<blockquote class="md-quote">${trimmed.replace(/^&gt;\s*/, "")}</blockquote>`);
    } else if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      outLines.push('<hr class="md-divider">');
    } else if (!trimmed) {
      outLines.push('<div class="md-spacer"></div>');
    } else {
      outLines.push(`<div class="md-p">${rawLine}</div>`);
    }
  }

  if (inOl) outLines.push("</ol>");
  if (inUl) outLines.push("</ul>");

  let result = outLines.join("");
  result = result.replace(/@@@MDINL(\d+)@@@/g, (_, idx) => inlineCodes[Number(idx)] || "");
  result = result.replace(/@@@MDCODE(\d+)@@@/g, (_, idx) => codeBlocks[Number(idx)] || "");

  return result;
}

function letterIndex(letter) {
  return "ABCD".indexOf(letter);
}

function letterAt(index) {
  return "ABCD"[index] || "";
}

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function toast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}
