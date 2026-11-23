"use strict";

// ============================================================
// CONFIGURACIÓN DE SUPABASE Y CREDENCIALES (PREPARAR-TESTS)
// ============================================================

async function obtenerConfiguracionSupabase() {
  const config = {
    ghToken: "",
    ghRepo: "",
    nvidiaApiKey: "",
    nvidiaModelo: "",
  };

  const supabaseUrl = window.APP_CONFIG?.supabaseUrl || window.SUPABASE_URL || "https://lztatgnlplpduiatmlrv.supabase.co";
  const anonKey = window.APP_CONFIG?.supabaseAnonKey || window.SUPABASE_ANON_KEY || "sb_publishable_z_T7Y3yKqPdXLnvL3ltnQA_ZAPrXImZ";
  const c = window.SupabaseAuth?.getClient?.() || window.supabaseClient;

  // 1. Extraer el token de acceso de Supabase (OAuth o email)
  let accessToken = window.SUPABASE_ACCESS_TOKEN || localStorage.getItem("cache_supabase_token") || "";

  if (!accessToken && c?.auth?.getSession) {
    try {
      const sRes = await c.auth.getSession();
      if (sRes?.data?.session?.access_token) {
        accessToken = sRes.data.session.access_token;
        localStorage.setItem("cache_supabase_token", accessToken);
        window.SUPABASE_ACCESS_TOKEN = accessToken;
      }
    } catch (_) {}
  }

  if (!accessToken) {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("sb-") || key.includes("supabase")) && key.endsWith("-auth-token")) {
          const parsed = JSON.parse(localStorage.getItem(key) || "{}");
          if (parsed?.access_token) {
            accessToken = parsed.access_token;
            localStorage.setItem("cache_supabase_token", accessToken);
            window.SUPABASE_ACCESS_TOKEN = accessToken;
            break;
          }
        }
      }
    } catch (_) {}
  }

  if (!accessToken) {
    try {
      const m = document.cookie.match(/(?:^|; )sb_shared_session=([^;]*)/);
      if (m) {
        const parsed = JSON.parse(decodeURIComponent(m[1]));
        if (parsed?.access_token) {
          accessToken = parsed.access_token;
          localStorage.setItem("cache_supabase_token", accessToken);
          window.SUPABASE_ACCESS_TOKEN = accessToken;
        }
      }
    } catch (_) {}
  }

  if (c && accessToken) {
    try {
      const sCheck = (await c.auth.getSession())?.data?.session;
      if (!sCheck?.access_token) {
        await c.auth.setSession({ access_token: accessToken, refresh_token: accessToken });
      }
    } catch (_) {}
  }

  function procesarFilas(filas) {
    if (!Array.isArray(filas)) return;
    for (const r of filas) {
      if (!r || !r.clave || !r.valor) continue;
      const k = String(r.clave).trim().toLowerCase().replace(/[-_]/g, "");
      const val = String(r.valor).trim();
      if (!val) continue;

      if (k === "ghtokengeneral") {
        config.ghToken = val;
      } else if (k === "ghtoken" && !config.ghToken) {
        config.ghToken = val;
      }
      if (k === "ghrepogeneral") {
        config.ghRepo = val;
      } else if (k === "ghrepo" && !config.ghRepo) {
        config.ghRepo = val;
      }
      if ((k.includes("nvidia") && !k.includes("model")) || k.includes("nvapi") || k === "tokennvidia") {
        if (!config.nvidiaApiKey) config.nvidiaApiKey = val;
      }
      if (k.includes("nvidia") && k.includes("model")) {
        if (!config.nvidiaModelo) config.nvidiaModelo = val;
      }
    }
  }

  // 2. Consultar con el cliente Supabase oficial en el esquema grados-informaticos (configuracion_privada)
  if (c) {
    try {
      const { data, error } = await c
        .schema("grados-informaticos")
        .from("configuracion_privada")
        .select("*");
      if (!error && Array.isArray(data) && data.length > 0) {
        procesarFilas(data);
      }
    } catch (_) {}

    if (!config.nvidiaApiKey) {
      try {
        const { data, error } = await c.schema("public").from("configuracion").select("*");
        if (!error && Array.isArray(data) && data.length > 0) {
          procesarFilas(data);
        }
      } catch (_) {}
    }
  }

  // 3. Consultar configuracion_publica como respaldo si aún falta información
  if (!config.ghToken || !config.nvidiaApiKey) {
    if (c) {
      try {
        const { data: dataPub } = await c.schema("grados-informaticos").from("configuracion_publica").select("*");
        if (Array.isArray(dataPub) && dataPub.length > 0) procesarFilas(dataPub);
      } catch (_) {}
      try {
        const { data: dataPubDef } = await c.from("configuracion_publica").select("*");
        if (Array.isArray(dataPubDef) && dataPubDef.length > 0) procesarFilas(dataPubDef);
      } catch (_) {}
    }
  }

  // 4. Si aún no tenemos ghToken pero hay sesión activa, consultar REST directa con Accept-Profile
  if (!config.ghToken && accessToken) {
    try {
      const respPriv = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/configuracion_privada?select=*`, {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          "Accept-Profile": "grados-informaticos",
        },
      });
      if (respPriv.ok) {
        const dataPriv = await respPriv.json();
        procesarFilas(dataPriv);
      }
    } catch (_) {}
  }

  // 5. Respaldo en localStorage si se introdujo previamente
  if (!config.ghToken) {
    config.ghToken = localStorage.getItem("cache_gh_token") || localStorage.getItem("gh_token") || "";
  }
  if (!config.ghRepo) {
    config.ghRepo = localStorage.getItem("cache_gh_repo") || "nataliagamezbarea/GRADOS_INFORMATICOS";
  }

  // 6. Token de NVIDIA NIM: Si no se encontró en Supabase, usar el valor por defecto
  if (!config.nvidiaApiKey) {
    config.nvidiaApiKey = (
      localStorage.getItem("preparar_tests_nvidia_key") ||
      localStorage.getItem("nvidia_api_key") ||
      localStorage.getItem("NVIDIA_API_KEY") ||
      "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"
    );
  }

  if (typeof window !== "undefined") {
    window.NVIDIA_API_KEY = config.nvidiaApiKey;
  }

  return config;
}

if (typeof window !== "undefined") {
  window.obtenerConfiguracionSupabase = obtenerConfiguracionSupabase;
}
