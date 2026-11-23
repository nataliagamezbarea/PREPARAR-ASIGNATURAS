"use strict";

// ============================================================
// AUTENTICACIÓN Y VALIDACIÓN DE ROLES SUPABASE
// ============================================================

const SupabaseGestionAuth = (() => {
  let currentUser = null;

  function getCurrentUser() {
    return currentUser;
  }

  function setCurrentUser(user) {
    currentUser = user;
  }

  function purgarSesionYCookies() {
    currentUser = null;

    try { sessionStorage.clear(); } catch (_) {}

    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("sb-") || k.includes("supabase") || k.includes("auth") || k.includes("token") || k.includes("admin") || k.includes("invitado") || k.includes("verifier"))) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}

    try {
      const cookies = document.cookie.split(";");
      for (const c of cookies) {
        const eqPos = c.indexOf("=");
        const name = eqPos > -1 ? c.substring(0, eqPos).trim() : c.trim();
        if (name) {
          document.cookie = `${name}=; Max-Age=-99999999; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
          document.cookie = `${name}=; Max-Age=-99999999; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=;`;
          document.cookie = `${name}=; Max-Age=-99999999; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname};`;
          document.cookie = `${name}=; Max-Age=-99999999; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${window.location.hostname};`;
        }
      }
    } catch (_) {}

    try {
      if (window.location.hash || window.location.search) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (_) {}
  }

  async function cerrarSesionCompleta(mensaje = "Has cerrado sesión.") {
    const modalEl = document.querySelector("#auth-modal");
    if (modalEl) {
      modalEl.classList.add("hidden");
      modalEl.style.display = "none";
    }
    const c = SupabaseConfig.getClient();
    if (c) {
      try {
        await c.auth.signOut({ scope: "local" });
      } catch (_) {}
    }
    purgarSesionYCookies();
    if (typeof SupabaseUI !== "undefined") SupabaseUI.updateAuthButton();
    const modal = document.querySelector("#auth-modal");
    if (modal) modal.classList.add("hidden");
    mostrarLoginGate(mensaje);
    window.location.replace(window.location.origin + window.location.pathname);
  }

  async function verificarPermisoAdmin(c, user) {
    if (!user) return false;
    const emailNorm = String(user.email || "").trim().toLowerCase();
    if (emailNorm === "nataliagbarea@gmail.com" || user.id === "553ae2cb-4832-4cda-a16d-e547032eb5b7") {
      return true;
    }

    try {
      const u = window.SUPABASE_URL;
      const k = window.SUPABASE_ANON_KEY;
      if (u && k) {
        const idFiltro = user.id ? `id=eq.${encodeURIComponent(user.id)}` : (user.email ? `email=eq.${encodeURIComponent(user.email)}` : null);
        if (idFiltro) {
          const resp = await fetch(`${u}/rest/v1/perfiles?select=rol&${idFiltro}`, {
            credentials: "omit",
            headers: { "apikey": k, "Authorization": `Bearer ${k}` }
          });
          if (resp.ok) {
            const arr = await resp.json();
            if (Array.isArray(arr) && arr.length > 0 && String(arr[0].rol || "").trim().toLowerCase() === "admin") {
              return true;
            }
          }
        }
      }
    } catch (_) {}

    if (!c) return false;
    try {
      let data = null;
      if (user.id) {
        const resId = await c.schema("public").from("perfiles")
          .select("id, email, rol").eq("id", user.id).maybeSingle();
        if (!resId.error && resId.data) data = resId.data;
      }
      if (!data && user.email) {
        const resEmail = await c.schema("public").from("perfiles")
          .select("id, email, rol").eq("email", user.email).maybeSingle();
        if (!resEmail.error && resEmail.data) data = resEmail.data;
      }
      return data && String(data.rol || "").trim().toLowerCase() === "admin";
    } catch (err) {
      console.warn("Fallo verificando permiso:", err);
      return false;
    }
  }

  function mostrarLoginGate(errorMsg = "") {
    const gate = document.getElementById("login-gate");
    if (gate) {
      gate.style.display = "flex";
      const errBox = document.getElementById("login-gate-error");
      if (errBox) {
        if (errorMsg) {
          errBox.textContent = errorMsg;
          errBox.style.display = "block";
        } else {
          errBox.style.display = "none";
        }
      }
    }
    const mainEl = document.getElementById("main") || document.getElementById("app");
    if (mainEl) mainEl.style.display = "none";
    const footer = document.getElementById("footer");
    if (footer) footer.style.display = "none";
    const topbar = document.querySelector(".topbar");
    if (topbar) topbar.style.display = "none";
  }

  function ocultarLoginGate() {
    const gate = document.getElementById("login-gate");
    if (gate) gate.style.display = "none";
    const mainEl = document.getElementById("main") || document.getElementById("app");
    if (mainEl) mainEl.style.display = "";
    const footer = document.getElementById("footer");
    if (footer) footer.style.display = "";
    const topbar = document.querySelector(".topbar");
    if (topbar) topbar.style.display = "";
    if (typeof window.renderizarInicioTests === "function") {
      window.renderizarInicioTests();
    }
  }

  async function autenticarConGate() {
    // Si el usuario inició autenticación desde generador-apuntes y Supabase redirigió aquí por Site URL.
    // localStorage NO se comparte entre puertos — usamos cookie como puente entre localhost:8002 y localhost:3000.
    try {
      function leerCookie(nombre) {
        const m = document.cookie.match(new RegExp("(?:^|; )" + nombre + "=([^;]*)"));
        return m ? decodeURIComponent(m[1]) : null;
      }
      const tieneTokenOAuth =
        window.location.hash.includes("access_token=") ||
        window.location.hash.includes("refresh_token=") ||
        window.location.search.includes("code=");
      const authOrigin = localStorage.getItem("auth_origin_app") || leerCookie("auth_origin_app");
      if (tieneTokenOAuth && authOrigin && (authOrigin.includes("generador-apuntes") || authOrigin.includes(":8002"))) {
        document.cookie = "auth_origin_app=; path=/; max-age=0";
        localStorage.removeItem("auth_origin_app");
        const destino = new URL(authOrigin);
        // NO reenviar params de error (?error=...) — solo el hash con el token
        // Si hay token en el hash, lo pasamos; si hay error en la URL, lo descartamos
        const hayError = window.location.search.includes("error=");
        if (!hayError) destino.search = window.location.search;
        destino.hash = window.location.hash;
        window.location.replace(destino.toString());
        return false;
      } else {
        document.cookie = "auth_origin_app=; path=/; max-age=0";
        try { localStorage.removeItem("auth_origin_app"); } catch (_) {}
      }
    } catch (_) {}

    try {
      sessionStorage.removeItem("esInvitado");
      localStorage.removeItem("esInvitado");
    } catch (_) {}

    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasError = urlParams.has("error") || urlParams.has("error_description") || hashParams.has("error") || hashParams.has("error_description");
    let errorAlInicio = "";

    if (hasError) {
      const errDesc = urlParams.get("error_description") || urlParams.get("error") || hashParams.get("error_description") || hashParams.get("error") || "Error en autorización";
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (_) {}
      errorAlInicio = `Aviso: ${decodeURIComponent(errDesc).replace(/\+/g, " ")}.`;
    }

    const c = SupabaseConfig.getClient();
    if (!c) {
      mostrarLoginGate("No se pudo conectar con Supabase.");
      return false;
    }

    try {
      let { data: { session } } = await c.auth.getSession();
      const hasTokenInUrl = window.location.hash.includes("access_token") || window.location.search.includes("code=");

      // Si no hay sesión local, intentar recuperar desde la cookie compartida entre puertos
      if (!session && !hasTokenInUrl) {
        try {
          const m = document.cookie.match(/(?:^|; )sb_shared_session=([^;]*)/);
          if (m) {
            const parsed = JSON.parse(decodeURIComponent(m[1]));
            if (parsed && parsed.access_token) {
              const resCookie = await c.auth.setSession({
                access_token: parsed.access_token,
                refresh_token: parsed.refresh_token || ""
              });
              if (resCookie.data?.session) {
                session = resCookie.data.session;
              }
            }
          }
        } catch (_) {}
      }

      if (!session && hasTokenInUrl) {
        if (window.location.search.includes("code=")) {
          const code = urlParams.get("code");
          if (code && typeof c.auth.exchangeCodeForSession === "function") {
            try {
              const resCode = await c.auth.exchangeCodeForSession(code);
              if (resCode.data?.session) session = resCode.data.session;
            } catch (errCode) {
              console.warn("exchangeCode aviso:", errCode);
            }
          }
        }

        if (!session) {
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 100));
            const res = await c.auth.getSession();
            if (res.data?.session) {
              session = res.data.session;
              break;
            }
          }
        }
      }

      if (!session?.user) {
        mostrarLoginGate(errorAlInicio);
        return false;
      }

      if (hasTokenInUrl) {
        try { window.history.replaceState({}, document.title, window.location.pathname); } catch (_) {}
      }

      const esAdmin = await verificarPermisoAdmin(c, session.user);
      if (!esAdmin) {
        await c.auth.signOut({ scope: "local" }).catch(() => {});
        currentUser = null;
        try { sessionStorage.removeItem("esAdmin"); } catch (_) {}
        mostrarLoginGate("Acceso denegado: tu usuario (" + (session.user.email || session.user.id) + ") no tiene rol admin en la tabla perfiles de Supabase.");
        return false;
      }

      currentUser = session.user;
      try {
        if (session?.access_token) {
          const payload = { access_token: session.access_token, refresh_token: session.refresh_token };
          document.cookie = `sb_shared_session=${encodeURIComponent(JSON.stringify(payload))}; path=/; max-age=604800; samesite=lax`;
        }
      } catch (_) {}
      try { sessionStorage.setItem("esAdmin", "true"); } catch (_) {}
      ocultarLoginGate();
      if (typeof SupabaseUI !== "undefined") SupabaseUI.updateAuthButton();
      await SupabaseProgreso.syncProgressWithCloud();
      return true;
    } catch (err) {
      console.error("Error en validación de sesión:", err);
      mostrarLoginGate(errorAlInicio || "Error al validar la sesión con Supabase.");
      return false;
    }
  }

  return {
    getCurrentUser,
    setCurrentUser,
    purgarSesionYCookies,
    cerrarSesionCompleta,
    autenticarConGate,
    mostrarLoginGate,
    ocultarLoginGate
  };
})();
