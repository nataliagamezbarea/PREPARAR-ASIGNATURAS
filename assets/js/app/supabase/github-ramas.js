"use strict";

// ============================================================
// GESTOR DE RAMAS Y REPOSITORIO PRIVADO DE GITHUB
// Permite listar ramas y descargar JSONs de tests desde GitHub
// ============================================================
const RepoBranchManager = (() => {
  const DEFAULT_REPO = "nataliagamezbarea/GRADOS_INFORMATICOS";
  const DEFAULT_BRANCH = "Segundo_grado_superior";
  const DEFAULT_FOLDER = "datos/bancos/WEC";
  const CACHE_BRANCHES_KEY = "cache_ramas_tests_v2";

  function getRepo() {
    return localStorage.getItem("gh_repo") || sessionStorage.getItem("gh_repo") || DEFAULT_REPO;
  }

  function getFolder() {
    return localStorage.getItem("gh_folder") || sessionStorage.getItem("gh_folder") || DEFAULT_FOLDER;
  }

  function getBranch() {
    return localStorage.getItem("selected_test_branch") || sessionStorage.getItem("selected_test_branch") || DEFAULT_BRANCH;
  }

  function getToken() {
    const fromStorage = localStorage.getItem("cache_gh_token") || sessionStorage.getItem("cache_gh_token") || "";
    if (fromStorage) return fromStorage;
    const fromWindow = window.GITHUB_CONFIG?.token || "";
    return fromWindow;
  }

  async function obtenerTokenDesdeSupabase() {
    let token = getToken();

    const supabaseUrl = window.SUPABASE_URL;
    const anonKey = window.SUPABASE_ANON_KEY;
    const c = window.SupabaseAuth?.getClient?.();

    // 1. Intentar mediante el cliente Supabase
    if (c) {
      try {
        const { data, error } = await c.schema("grados-informaticos").from("configuracion_privada").select("clave, valor");
        if (!error && Array.isArray(data) && data.length > 0) {
          const rowToken = data.find((r) => r.clave === "gh_token" || r.clave === "gh_token_general");
          const rowRepo = data.find((r) => r.clave === "gh_repo" || r.clave === "gh_repo_general");
          const rowFolder = data.find((r) => r.clave === "gh_folder" || r.clave === "folder_tests");
          const rowBranch = data.find((r) => r.clave === "gh_branch" || r.clave === "branch_tests");
          if (rowToken?.valor) {
            token = rowToken.valor;
            localStorage.setItem("cache_gh_token", token);
          }
          if (rowRepo?.valor) {
            localStorage.setItem("gh_repo", rowRepo.valor);
          }
          if (rowFolder?.valor) {
            localStorage.setItem("gh_folder", rowFolder.valor);
          }
          if (rowBranch?.valor) {
            localStorage.setItem("selected_test_branch", rowBranch.valor);
          }
        }
      } catch (_) {}
    }

    // 2. Si aún falta info, consultar vía REST pasando el token de sesión autenticada
    if (supabaseUrl && anonKey) {
      try {
        let accessToken = anonKey;
        if (c?.auth?.getSession) {
          const sRes = await c.auth.getSession();
          if (sRes?.data?.session?.access_token) {
            accessToken = sRes.data.session.access_token;
          }
        }

        const url = `${supabaseUrl}/rest/v1/configuracion_privada?select=clave,valor&clave=in.(gh_repo,gh_repo_general,gh_token,gh_token_general,gh_folder,folder_tests,gh_branch,branch_tests)`;
        const resp = await fetch(url, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Accept-Profile": "grados-informaticos"
          },
          cache: "no-store"
        });

        if (resp.ok) {
          const filas = await resp.json();
          if (Array.isArray(filas) && filas.length > 0) {
            const rowToken = filas.find((r) => r.clave === "gh_token" || r.clave === "gh_token_general");
            const rowRepo = filas.find((r) => r.clave === "gh_repo" || r.clave === "gh_repo_general");
            const rowFolder = filas.find((r) => r.clave === "gh_folder" || r.clave === "folder_tests");
            const rowBranch = filas.find((r) => r.clave === "gh_branch" || r.clave === "branch_tests");
            if (rowToken?.valor) {
              token = rowToken.valor;
              localStorage.setItem("cache_gh_token", token);
            }
            if (rowRepo?.valor) {
              localStorage.setItem("gh_repo", rowRepo.valor);
            }
            if (rowFolder?.valor) {
              localStorage.setItem("gh_folder", rowFolder.valor);
            }
            if (rowBranch?.valor) {
              localStorage.setItem("selected_test_branch", rowBranch.valor);
            }
          }
        }
      } catch (err) {
        console.warn("Fallo leyendo configuracion_privada de Supabase:", err);
      }
    }

    return token || getToken();
  }

  async function listarRamas() {
    const token = await obtenerTokenDesdeSupabase();
    const repo = getRepo();

    let cached = [];
    try {
      cached = JSON.parse(localStorage.getItem(CACHE_BRANCHES_KEY) || "[]");
    } catch (_) {}

    try {
      const headers = { Accept: "application/vnd.github+json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, { headers, cache: "no-store" });
      if (res.ok) {
        const branches = await res.json();
        if (Array.isArray(branches) && branches.length > 0) {
          const names = branches.map((b) => b.name);
          localStorage.setItem(CACHE_BRANCHES_KEY, JSON.stringify(names));
          return names;
        }
      }
    } catch (err) {
      console.warn("No se pudieron listar ramas de GitHub en vivo:", err);
    }

    if (cached.length) return cached;
    return [DEFAULT_BRANCH, "master"];
  }

  async function poblarSelectorRamas(selectEl, selectedRama = null) {
    if (!selectEl) return;
    const branches = await listarRamas();
    const active = selectedRama || localStorage.getItem("selected_test_branch") || DEFAULT_BRANCH;

    selectEl.innerHTML = "";
    branches.forEach((branch) => {
      const opt = document.createElement("option");
      opt.value = branch;
      opt.textContent = `Rama: ${branch}${branch === DEFAULT_BRANCH ? " (DWEC - Segundo)" : ""}`;
      if (branch === active) opt.selected = true;
      selectEl.appendChild(opt);
    });

    if (!branches.includes(active)) {
      const opt = document.createElement("option");
      opt.value = active;
      opt.textContent = `Rama: ${active}`;
      opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  async function cargarPreguntasDeRama(rama, carpeta = getFolder()) {
    const token = await obtenerTokenDesdeSupabase();
    const repo = getRepo();
    try {
      if (typeof toast === "function") toast(`Conectando con GitHub para leer "${rama}"…`);
      const headers = { Accept: "application/vnd.github+json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(`https://api.github.com/repos/${repo}/contents/${carpeta}?ref=${encodeURIComponent(rama)}`, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} al acceder a ${carpeta}`);
      }
      const files = await res.json();
      if (!Array.isArray(files)) {
        throw new Error("La respuesta no contiene archivos.");
      }

      const jsonFiles = files.filter((f) => f.name.endsWith(".json") && f.type === "file" && !f.name.includes("backup"));
      if (jsonFiles.length === 0) {
        throw new Error(`No hay JSONs de preguntas en ${carpeta}`);
      }

      let allQuestions = [];
      for (const file of jsonFiles) {
        const rawHeaders = { Accept: "application/vnd.github.raw" };
        if (token) rawHeaders.Authorization = `Bearer ${token}`;
        const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/${file.path}?ref=${encodeURIComponent(rama)}`, { headers: rawHeaders });
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          const qList = Array.isArray(fileData?.preguntas) ? fileData.preguntas : (Array.isArray(fileData) ? fileData : []);
          allQuestions.push(...qList);
        }
      }

      if (allQuestions.length > 0 && typeof normalizeData === "function") {
        normalizeData({ preguntas: allQuestions });
        localStorage.setItem("selected_test_branch", rama);
        if (typeof renderApp === "function") renderApp();
        if (typeof toast === "function") toast(`✓ Cargadas ${allQuestions.length} preguntas de la rama "${rama}"`);
        return allQuestions;
      }
    } catch (err) {
      console.warn("Carga desde GitHub falló, manteniendo local:", err);
      if (typeof toast === "function") toast(`Aviso GitHub: ${err.message}. Usando banco local.`);
    }
    return null;
  }

  async function guardarPreguntasEnGitHub(rama, rutaArchivo, contenidoJson) {
    const token = await obtenerTokenDesdeSupabase();
    const repo = getRepo();
    if (!token) {
      throw new Error("No hay token de GitHub con permisos de escritura disponible.");
    }
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`
    };

    let sha = null;
    try {
      const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${rutaArchivo}?ref=${encodeURIComponent(rama)}`, { headers });
      if (getRes.ok) {
        const fileInfo = await getRes.json();
        sha = fileInfo.sha;
      }
    } catch (_) {}

    const jsonString = typeof contenidoJson === "string" ? contenidoJson : JSON.stringify(contenidoJson, null, 2);
    const base64Content = btoa(unescape(encodeURIComponent(jsonString)));

    const body = {
      message: `Actualizar banco de preguntas: ${rutaArchivo.split("/").pop()}`,
      content: base64Content,
      branch: rama
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${rutaArchivo}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body)
    });

    if (!putRes.ok) {
      const errData = await putRes.json().catch(() => ({}));
      throw new Error(errData.message || `HTTP ${putRes.status}`);
    }

    if (typeof toast === "function") {
      toast(`✓ Guardado en GitHub en la rama "${rama}"`);
    }
    return true;
  }

  return {
    getRepo,
    getToken,
    obtenerTokenDesdeSupabase,
    listarRamas,
    poblarSelectorRamas,
    cargarPreguntasDeRama,
    guardarPreguntasEnGitHub,
    DEFAULT_BRANCH,
    DEFAULT_FOLDER
  };
})();

window.RepoBranchManager = RepoBranchManager;
