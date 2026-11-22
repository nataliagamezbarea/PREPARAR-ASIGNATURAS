"use strict";

// ============================================================
// CONFIGURACIÓN E INTEGRACIÓN SUPABASE (Grados Informáticos)
// Sincronización de progreso y caché de http://127.0.0.1:8765/
// ============================================================

window.SUPABASE_URL = window.SUPABASE_URL || "https://lztatgnlplpduiatmlrv.supabase.co";
window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "sb_publishable_z_T7Y3yKqPdXLnvL3ltnQA_ZAPrXImZ";

const SupabaseAuth = (() => {
  let client = null;
  let currentUser = null;
  let isSyncing = false;

  function getClient() {
    if (client) return client;
    if (window.supabase && typeof window.supabase.createClient === "function") {
      try {
        client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
          db: { schema: "grados-informaticos" },
          auth: {
            flowType: "implicit",
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });
        window.supabaseClient = client;
        return client;
      } catch (err) {
        console.error("Error al inicializar cliente Supabase:", err);
      }
    }
    return null;
  }

  // Pre-cargar progreso de las 515 preguntas practicadas de http://127.0.0.1:8765/
  async function seedInitialProgress() {
    const keySeeded = "wec12_seeded_8765_v2";
    if (localStorage.getItem(keySeeded) === "true") return;

    try {
      const resp = await fetch("./data/progreso-8765.json");
      if (!resp.ok) return;
      const seedData = await resp.json();
      if (!seedData || !seedData.history) return;

      const currentHistory = typeof getHistory === "function" ? getHistory() : {};
      const currentWrong = typeof getWrongIds === "function" ? getWrongIds() : [];

      // Fusionar historia de 8765
      const mergedHistory = { ...seedData.history, ...currentHistory };
      const mergedWrong = [...new Set([...(seedData.wrongIds || []), ...currentWrong])];

      if (typeof setHistory === "function") setHistory(mergedHistory);
      if (typeof setWrongIds === "function") setWrongIds(mergedWrong);

      const existingStats = typeof getStats === "function" ? getStats() : null;
      if (!existingStats || existingStats.attempts === 0) {
        if (typeof setStats === "function") setStats(seedData.stats);
        else writeStore(LS.stats, seedData.stats);
      }

      localStorage.setItem(keySeeded, "true");
      console.log(`[SupabaseAuth] Progreso inicial de 8765 cargado con éxito (${Object.keys(seedData.history).length} preguntas practicadas, ${mergedWrong.length} fallos)`);
      if (typeof toast === "function") {
        toast("✓ Se ha cargado tu progreso anterior de http://127.0.0.1:8765/ (515 preguntas practicadas)");
      }
    } catch (e) {
      console.warn("No se pudo cargar el progreso inicial de 8765:", e);
    }
  }

  // Sincronizar progreso local con Supabase
  async function syncProgressWithCloud(forceUpload = false) {
    const c = getClient();
    if (!c || !currentUser || isSyncing) return;
    isSyncing = true;

    try {
      updateSyncStatusUI("Sincronizando…");
      const localHistory = typeof getHistory === "function" ? getHistory() : {};
      const localWrong = typeof getWrongIds === "function" ? getWrongIds() : [];
      const localStats = typeof getStats === "function" ? getStats() : {};
      const localSession = typeof getSession === "function" ? getSession() : null;

      const cloudProgress = currentUser.user_metadata?.test_progress || null;

      let mergedHistory = { ...localHistory };
      let mergedWrong = [...new Set(localWrong)];
      let mergedStats = { ...localStats };

      if (cloudProgress && !forceUpload) {
        // Fusionar lo de la nube con lo local
        if (cloudProgress.history) {
          Object.entries(cloudProgress.history).forEach(([qid, item]) => {
            if (!mergedHistory[qid] || (item.at && (!mergedHistory[qid].at || item.at > mergedHistory[qid].at))) {
              mergedHistory[qid] = item;
            }
          });
        }
        if (Array.isArray(cloudProgress.wrongIds)) {
          mergedWrong = [...new Set([...mergedWrong, ...cloudProgress.wrongIds])];
        }
        if (cloudProgress.stats) {
          mergedStats.attempts = Math.max(mergedStats.attempts || 0, cloudProgress.stats.attempts || 0);
          mergedStats.bestPct = Math.max(mergedStats.bestPct || 0, cloudProgress.stats.bestPct || 0);
        }
      }

      const payload = {
        updatedAt: new Date().toISOString(),
        history: mergedHistory,
        wrongIds: mergedWrong,
        stats: mergedStats,
        session: localSession,
        countPracticadas: Object.keys(mergedHistory).length
      };

      // Guardar en Supabase user_metadata
      const { data: updateData, error: updateError } = await c.auth.updateUser({
        data: { test_progress: payload }
      });

      if (!updateError && updateData?.user) {
        currentUser = updateData.user;
      }

      // Aplicar al estado local
      if (typeof setHistory === "function") setHistory(mergedHistory);
      if (typeof setWrongIds === "function") setWrongIds(mergedWrong);
      if (typeof setStats === "function") setStats(mergedStats);

      updateSyncStatusUI(`Sincronizado (${payload.countPracticadas} preguntas)`);
      console.log(`[SupabaseAuth] Progreso sincronizado con Supabase (${payload.countPracticadas} preguntas guardadas)`);
    } catch (e) {
      console.error("Error sincronizando con Supabase:", e);
      updateSyncStatusUI("Error al sincronizar");
    } finally {
      isSyncing = false;
    }
  }

  function updateSyncStatusUI(text) {
    const statusEl = document.querySelector("#sync-cloud-status");
    if (statusEl) statusEl.textContent = text;
  }

  function updateAuthButton() {
    const btn = document.querySelector("#auth-btn");
    const label = document.querySelector("#auth-btn-label");
    if (!btn || !label) return;

    if (currentUser) {
      if (sessionStorage.getItem("esInvitado") === "true") {
        label.textContent = "Invitado";
        btn.classList.remove("primary");
        btn.title = "Modo Invitado · Clic para identificarte con tu cuenta";
      } else {
        const email = currentUser.email || "Usuario";
        label.textContent = email.split("@")[0];
        btn.classList.add("primary");
        btn.title = `Conectado como ${email} · Clic para ver perfil y sincronización`;
      }
    } else {
      label.textContent = "Iniciar sesión";
      btn.classList.remove("primary");
      btn.title = "Iniciar sesión con Supabase para guardar tu caché y progreso";
    }
  }

  // Modal de inicio de sesión y sincronización
  function renderAuthModal() {
    let modal = document.querySelector("#auth-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "auth-modal";
      modal.className = "modal-overlay hidden";
      modal.style.cssText = `
        position: fixed; inset: 0; background: rgba(15, 23, 42, 0.7);
        display: flex; align-items: center; justify-content: center; z-index: 1000;
        padding: 20px; backdrop-filter: blur(4px);
      `;
      document.body.appendChild(modal);
    }

    const email = currentUser?.email || "";
    const esInvitado = sessionStorage.getItem("esInvitado") === "true";
    const historyCount = typeof getHistory === "function" ? Object.keys(getHistory()).length : 0;
    const wrongCount = typeof getWrongIds === "function" ? getWrongIds().length : 0;

    modal.innerHTML = `
      <div class="modal-card" style="
        background: var(--card); color: var(--text); border: 1px solid var(--line);
        border-radius: var(--radius); width: 100%; max-width: 440px; padding: 28px;
        box-shadow: var(--shadow); position: relative; max-height: 90vh; overflow-y: auto;
      ">
        <button type="button" id="close-auth-modal" style="
          position: absolute; top: 16px; right: 16px; background: none; border: none;
          font-size: 20px; color: var(--muted); cursor: pointer; padding: 4px;
        " aria-label="Cerrar">&times;</button>

        <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
          <div style="width:40px; height:40px; border-radius:10px; background:var(--brand-soft); color:var(--brand); display:flex; align-items:center; justify-content:center; font-size:18px;">
            <i class="fa-solid ${esInvitado ? "fa-user-clock" : (currentUser ? "fa-cloud-arrow-up" : "fa-user")}"></i>
          </div>
          <div>
            <h3 style="margin:0; font-size:18px;">${esInvitado ? "Modo Invitado" : (currentUser ? "Tu cuenta de Supabase" : "Iniciar sesión en Supabase")}</h3>
            <small style="color:var(--muted);">${esInvitado ? "Practicando como invitado · Progreso local" : (currentUser ? "Grados Informáticos · Sincronización activa" : "Guarda tu caché y progreso en la nube")}</small>
          </div>
        </div>

        ${esInvitado ? `
          <div style="background:var(--card2); border:1px solid var(--line); border-radius:var(--radius-sm); padding:16px; margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Sesión</span>
              <strong style="font-size:14px; color:var(--brand);">Invitado (Modo local)</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Preguntas practicadas</span>
              <strong><span class="pct-pill" style="background:var(--ok-soft); color:var(--ok); font-size:12px; padding:2px 8px; border-radius:12px;">${historyCount}</span></strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:13px; color:var(--muted);">Preguntas falladas</span>
              <strong><span class="pct-pill" style="background:var(--bad-soft); color:var(--bad); font-size:12px; padding:2px 8px; border-radius:12px;">${wrongCount}</span></strong>
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px;">
            <button class="btn primary" type="button" id="btn-login-from-guest" style="width:100%; justify-content:center; gap:8px;">
              <i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión con mi cuenta
            </button>
            <button class="btn ghost warn" type="button" id="btn-logout-guest" style="width:100%; justify-content:center; gap:8px;">
              <i class="fa-solid fa-right-from-bracket"></i> Cerrar sesión de invitado
            </button>
          </div>
        ` : (currentUser ? `
          <div style="background:var(--card2); border:1px solid var(--line); border-radius:var(--radius-sm); padding:16px; margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Usuario</span>
              <strong style="font-size:14px;">${esc(email)}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Preguntas practicadas</span>
              <strong><span class="pct-pill" style="background:var(--ok-soft); color:var(--ok); font-size:12px; padding:2px 8px; border-radius:12px;">${historyCount}</span></strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:13px; color:var(--muted);">Preguntas falladas</span>
              <strong><span class="pct-pill" style="background:var(--bad-soft); color:var(--bad); font-size:12px; padding:2px 8px; border-radius:12px;">${wrongCount}</span></strong>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span style="font-size:13px; color:var(--muted);">Estado de nube</span>
              <span id="sync-cloud-status" style="font-size:12px; font-weight:600; color:var(--brand);">Conectado</span>
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:10px;">
            <button class="btn primary" type="button" id="btn-sync-now" style="width:100%; justify-content:center; gap:8px;">
              <i class="fa-solid fa-arrows-rotate"></i> Sincronizar ahora con Supabase
            </button>
            <button class="btn ghost warn" type="button" id="btn-logout" style="width:100%; justify-content:center; gap:8px;">
              <i class="fa-solid fa-right-from-bracket"></i> Cerrar sesión
            </button>
          </div>
        ` : `
          <p style="font-size:13px; color:var(--muted); line-height:1.5; margin-bottom:20px;">
            Inicia sesión para sincronizar automáticamente tu caché, respuestas y las <strong>515 preguntas practicadas</strong> de http://127.0.0.1:8765/ entre dispositivos.
          </p>

          <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
            <button class="btn" type="button" id="btn-oauth-google" style="width:100%; justify-content:center; gap:10px; border:1px solid var(--line);">
              <i class="fa-brands fa-google" style="color:#ea4335;"></i> Continuar con Google
            </button>
            <button class="btn" type="button" id="btn-oauth-github" style="width:100%; justify-content:center; gap:10px; border:1px solid var(--line);">
              <i class="fa-brands fa-github"></i> Continuar con GitHub
            </button>
          </div>

          <div style="display:flex; align-items:center; gap:10px; margin:16px 0; color:var(--muted); font-size:12px;">
            <hr style="flex:1; border:0; border-top:1px solid var(--line);">
            <span>O con correo</span>
            <hr style="flex:1; border:0; border-top:1px solid var(--line);">
          </div>

          <form id="email-auth-form" style="display:flex; flex-direction:column; gap:12px;">
            <div>
              <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;" for="auth-email">Correo electrónico</label>
              <input class="control" type="email" id="auth-email" required placeholder="tu@correo.com" style="width:100%; box-sizing:border-box;">
            </div>
            <div>
              <label style="display:block; font-size:12px; font-weight:600; margin-bottom:4px;" for="auth-password">Contraseña</label>
              <input class="control" type="password" id="auth-password" required placeholder="••••••••" style="width:100%; box-sizing:border-box;">
            </div>
            <div id="auth-error-msg" class="hidden" style="color:var(--bad); font-size:12px; background:var(--bad-soft); padding:8px 12px; border-radius:8px;"></div>
            <div style="display:flex; gap:10px; margin-top:8px;">
              <button class="btn primary" type="submit" id="btn-submit-login" style="flex:1; justify-content:center;">Entrar</button>
              <button class="btn ghost" type="button" id="btn-submit-signup" style="flex:1; justify-content:center;">Registrarse</button>
            </div>
          </form>
        `)}
      </div>
    `;

    modal.classList.remove("hidden");

    // Handlers
    modal.querySelector("#close-auth-modal")?.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });

    if (esInvitado) {
      modal.querySelector("#btn-logout-guest")?.addEventListener("click", () => {
        sessionStorage.removeItem("esInvitado");
        sessionStorage.removeItem("esAdmin");
        currentUser = null;
        updateAuthButton();
        modal.classList.add("hidden");
        mostrarLoginGate("Has salido del modo invitado. Inicia sesión para continuar.");
        if (typeof toast === "function") toast("Sesión de invitado cerrada.");
      });

      modal.querySelector("#btn-login-from-guest")?.addEventListener("click", () => {
        sessionStorage.removeItem("esInvitado");
        sessionStorage.removeItem("esAdmin");
        currentUser = null;
        updateAuthButton();
        modal.classList.add("hidden");
        mostrarLoginGate();
      });
    } else if (currentUser) {
      modal.querySelector("#btn-sync-now")?.addEventListener("click", async () => {
        const btn = modal.querySelector("#btn-sync-now");
        if (btn) { btn.disabled = true; btn.textContent = "Sincronizando…"; }
        await syncProgressWithCloud(true);
        if (typeof toast === "function") toast("✓ Progreso sincronizado con Supabase");
        renderAuthModal();
      });

      modal.querySelector("#btn-logout")?.addEventListener("click", async () => {
        const c = getClient();
        if (c) await c.auth.signOut().catch(() => {});
        sessionStorage.removeItem("esInvitado");
        sessionStorage.removeItem("esAdmin");
        currentUser = null;
        updateAuthButton();
        modal.classList.add("hidden");
        mostrarLoginGate("Has cerrado sesión.");
        if (typeof toast === "function") toast("Has cerrado sesión.");
      });
    } else {
      modal.querySelector("#btn-oauth-google")?.addEventListener("click", async () => {
        const c = getClient();
        if (!c) return;
        await c.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: window.location.href }
        });
      });

      modal.querySelector("#btn-oauth-github")?.addEventListener("click", async () => {
        const c = getClient();
        if (!c) return;
        await c.auth.signInWithOAuth({
          provider: "github",
          options: { redirectTo: window.location.href }
        });
      });

      const form = modal.querySelector("#email-auth-form");
      const errBox = modal.querySelector("#auth-error-msg");

      form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const c = getClient();
        if (!c) return;
        const emailVal = modal.querySelector("#auth-email").value.trim();
        const passVal = modal.querySelector("#auth-password").value;
        const submitBtn = modal.querySelector("#btn-submit-login");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Entrando…"; }
        errBox.classList.add("hidden");

        const { data, error } = await c.auth.signInWithPassword({ email: emailVal, password: passVal });
        if (error) {
          errBox.textContent = error.message;
          errBox.classList.remove("hidden");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Entrar"; }
        } else {
          currentUser = data.user;
          updateAuthButton();
          await syncProgressWithCloud();
          if (typeof toast === "function") toast(`¡Bienvenida ${emailVal}!`);
          renderAuthModal();
        }
      });

      modal.querySelector("#btn-submit-signup")?.addEventListener("click", async () => {
        const c = getClient();
        if (!c) return;
        const emailVal = modal.querySelector("#auth-email").value.trim();
        const passVal = modal.querySelector("#auth-password").value;
        const signupBtn = modal.querySelector("#btn-submit-signup");
        if (!emailVal || !passVal) {
          errBox.textContent = "Escribe correo y contraseña para registrarte.";
          errBox.classList.remove("hidden");
          return;
        }
        if (signupBtn) { signupBtn.disabled = true; signupBtn.textContent = "Registrando…"; }
        errBox.classList.add("hidden");

        const { data, error } = await c.auth.signUp({ email: emailVal, password: passVal });
        if (error) {
          errBox.textContent = error.message;
          errBox.classList.remove("hidden");
          if (signupBtn) { signupBtn.disabled = false; signupBtn.textContent = "Registrarse"; }
        } else {
          currentUser = data.user;
          updateAuthButton();
          await syncProgressWithCloud();
          if (typeof toast === "function") toast(`Cuenta creada. ¡Bienvenida ${emailVal}!`);
          renderAuthModal();
        }
      });
    }
  }

  async function verificarPermisoAdmin(c, user) {
    if (!c || !user) return false;
    const emailNorm = String(user.email || "").trim().toLowerCase();
    if (emailNorm === "nataliagbarea@gmail.com" || user.id === "553ae2cb-4832-4cda-a16d-e547032eb5b7") {
      return true;
    }
    try {
      let data = null;
      if (user.id) {
        const resId = await c.schema("public").from("perfiles")
          .select("id, email, rol").eq("id", user.id).maybeSingle();
        if (!resId.error && resId.data) data = resId.data;
      }
      // Respaldo por email (idéntico a Acceso_grados_informaticos por si el registro se creó con otro UUID)
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
    if (typeof window.renderizarInicioTests === "function" && mainEl && !mainEl.innerHTML.trim()) {
      window.renderizarInicioTests();
    }
  }

  async function autenticarConGate() {
    if (sessionStorage.getItem("esInvitado") === "true") {
      currentUser = { id: "invitado", email: "invitado@local" };
      ocultarLoginGate();
      updateAuthButton();
      if (typeof window.renderizarInicioTests === "function") {
        const mainEl = document.getElementById("main") || document.getElementById("app");
        if (mainEl && !mainEl.innerHTML.trim()) window.renderizarInicioTests();
      }
      return true;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const hasError = urlParams.has("error") || urlParams.has("error_description");
    let errorAlInicio = "";

    if (hasError) {
      const errDesc = urlParams.get("error_description") || urlParams.get("error") || "Error en autorización";
      try {
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (_) {}

      // Limpiar tokens y verificadores huérfanos de OAuth para prevenir bucles de bad_oauth_state
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith("sb-") && (k.includes("code-verifier") || k.includes("auth-token-code-verifier"))) {
            localStorage.removeItem(k);
          }
        });
        Object.keys(sessionStorage).forEach(k => {
          if (k.startsWith("sb-")) sessionStorage.removeItem(k);
        });
      } catch (_) {}

      const textoLimpio = decodeURIComponent(errDesc).replace(/\+/g, " ");
      if (textoLimpio.toLowerCase().includes("bad_oauth_state") || textoLimpio.toLowerCase().includes("state not found")) {
        errorAlInicio = "El enlace anterior expiró o se limpió la sesión previa. Pulsa en Continuar con Google o GitHub para acceder.";
      } else {
        errorAlInicio = `Aviso: ${textoLimpio}. Pulsa de nuevo para entrar.`;
      }
    }

    const c = getClient();
    if (!c) {
      mostrarLoginGate("No se pudo conectar con Supabase.");
      return false;
    }

    try {
      const { data: { session } } = await c.auth.getSession();
      if (!session?.user) {
        mostrarLoginGate(errorAlInicio);
        return false;
      }

      // Comprobar estrictamente si el usuario existe y es admin en Supabase
      const esAdmin = await verificarPermisoAdmin(c, session.user);
      if (!esAdmin) {
        await c.auth.signOut().catch(() => {});
        currentUser = null;
        try { sessionStorage.removeItem("esAdmin"); } catch (_) {}
        mostrarLoginGate("Acceso denegado: tu usuario (" + (session.user.email || session.user.id) + ") no tiene rol admin en la tabla perfiles de Supabase.");
        return false;
      }

      currentUser = session.user;
      try { sessionStorage.setItem("esAdmin", "true"); } catch (_) {}
      ocultarLoginGate();
      updateAuthButton();
      await syncProgressWithCloud();
      return true;
    } catch (err) {
      console.error("Error en validación de sesión:", err);
      mostrarLoginGate(errorAlInicio || "Error al validar la sesión con Supabase.");
      return false;
    }
  }
  async function cargarConfiguracionServidor() {
    try {
      const res = await fetch("/api/configuracion");
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.supabaseUrl) window.SUPABASE_URL = cfg.supabaseUrl;
        if (cfg.supabaseAnonKey) window.SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
        if (cfg.githubRepo) localStorage.setItem("gh_repo", cfg.githubRepo);
        if (cfg.githubBranch) localStorage.setItem("selected_test_branch", cfg.githubBranch);
        if (cfg.githubToken) localStorage.setItem("cache_gh_token", cfg.githubToken);
      }
    } catch (_) {}
  }

  async function init() {
    await cargarConfiguracionServidor();
    await seedInitialProgress();

    // Comprobar autenticación con login gate estricto
    await autenticarConGate();

    const c = getClient();
    if (c) {
      c.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_IN") {
          await autenticarConGate();
        } else if (event === "SIGNED_OUT") {
          currentUser = null;
          updateAuthButton();
          mostrarLoginGate();
        }
      });
    }

    const cleanRedirectUrl = window.location.origin + window.location.pathname;

    // Botones de login con OAuth exclusivo (GitHub y Google)
    document.getElementById("gate-btn-github")?.addEventListener("click", async () => {
      const cli = getClient();
      if (!cli) {
        mostrarLoginGate("No se pudo conectar con Supabase.");
        return;
      }
      const btn = document.getElementById("gate-btn-github");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="font-size:1.1rem;"></i> <span>Conectando con GitHub…</span>';
      }
      try {
        const { error } = await cli.auth.signInWithOAuth({
          provider: "github",
          options: { redirectTo: cleanRedirectUrl }
        });
        if (error) {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-brands fa-github" style="font-size:1.15rem;"></i> <span>Continuar con GitHub</span>';
          }
          mostrarLoginGate(`Error de autenticación con GitHub: ${error.message}`);
        }
      } catch (err) {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-brands fa-github" style="font-size:1.15rem;"></i> <span>Continuar con GitHub</span>';
        }
        mostrarLoginGate(`Error: ${err.message || err}`);
      }
    });

    document.getElementById("gate-btn-google")?.addEventListener("click", async () => {
      const cli = getClient();
      if (!cli) {
        mostrarLoginGate("No se pudo conectar con Supabase.");
        return;
      }
      const btn = document.getElementById("gate-btn-google");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" style="font-size:1.1rem;"></i> <span>Conectando con Google…</span>';
      }
      try {
        const { error } = await cli.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo: cleanRedirectUrl }
        });
        if (error) {
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-brands fa-google" style="color:#ea4335; font-size:1.1rem;"></i> <span>Continuar con Google</span>';
          }
          mostrarLoginGate(`Error de autenticación con Google: ${error.message}`);
        }
      } catch (err) {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-brands fa-google" style="color:#ea4335; font-size:1.1rem;"></i> <span>Continuar con Google</span>';
        }
        mostrarLoginGate(`Error: ${err.message || err}`);
      }
    });

    document.getElementById("gate-toggle-email")?.addEventListener("click", () => {
      const form = document.getElementById("gate-email-form");
      if (form) {
        form.style.display = form.style.display === "none" ? "flex" : "none";
      }
    });

    document.getElementById("gate-email-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cli = getClient();
      if (!cli) return mostrarLoginGate("No se pudo conectar con Supabase.");
      const email = document.getElementById("gate-input-email")?.value.trim();
      const password = document.getElementById("gate-input-password")?.value;
      const btn = document.getElementById("gate-btn-submit-email");
      if (btn) { btn.disabled = true; btn.textContent = "Verificando…"; }

      try {
        const { data, error } = await cli.auth.signInWithPassword({ email, password });
        if (error) {
          if (btn) { btn.disabled = false; btn.textContent = "Iniciar sesión"; }
          mostrarLoginGate(error.message === "Invalid login credentials" ? "Email o contraseña incorrectos." : error.message);
          return;
        }

        const esAdmin = await verificarPermisoAdmin(cli, data.user);
        if (!esAdmin) {
          await cli.auth.signOut().catch(() => {});
          currentUser = null;
          if (btn) { btn.disabled = false; btn.textContent = "Iniciar sesión"; }
          mostrarLoginGate("Acceso denegado: tu usuario (" + (data.user?.email || "") + ") no tiene rol admin en la tabla perfiles de Supabase.");
          return;
        }

        currentUser = data.user;
        try { sessionStorage.setItem("esAdmin", "true"); } catch (_) {}
        ocultarLoginGate();
        updateAuthButton();
        await syncProgressWithCloud();
        if (typeof toast === "function") toast(`¡Bienvenida ${email}!`);
      } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = "Iniciar sesión"; }
        mostrarLoginGate(`Error: ${err.message || err}`);
      }
    });

    document.getElementById("gate-btn-guest")?.addEventListener("click", () => {
      sessionStorage.setItem("esInvitado", "true");
      sessionStorage.setItem("esAdmin", "false");
      currentUser = { id: "invitado", email: "invitado@local" };
      ocultarLoginGate();
      updateAuthButton();
      if (typeof window.renderizarInicioTests === "function") {
        window.renderizarInicioTests();
      }
      if (typeof toast === "function") toast("Has entrado en modo Invitado");
    });

    document.querySelector("#auth-btn")?.addEventListener("click", () => {
      renderAuthModal();
    });

    updateAuthButton();
  }

  let autoSyncTimer = null;
  function autoSyncProgressDebounced() {
    if (autoSyncTimer) clearTimeout(autoSyncTimer);
    autoSyncTimer = setTimeout(() => {
      syncProgressWithCloud(false).catch((e) => console.warn("Auto-sync error:", e));
    }, 1000);
  }

  return {
    init,
    getClient,
    seedInitialProgress,
    syncProgressWithCloud,
    autoSyncProgressDebounced,
    renderAuthModal
  };
})();

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

  function getToken() {
    const fromStorage = localStorage.getItem("cache_gh_token") || sessionStorage.getItem("cache_gh_token") || "";
    if (fromStorage) return fromStorage;
    const fromWindow = window.GITHUB_CONFIG?.token || "";
    return fromWindow;
  }

  async function obtenerTokenDesdeSupabase() {
    const c = SupabaseAuth.getClient();
    if (!c) return getToken();
    try {
      const { data, error } = await c.schema("grados-informaticos").from("configuracion_privada").select("clave, valor");
      if (!error && Array.isArray(data)) {
        const rowToken = data.find((r) => r.clave === "gh_token");
        const rowRepo = data.find((r) => r.clave === "gh_repo" || r.clave === "gh_repo_general");
        if (rowToken?.valor) {
          localStorage.setItem("cache_gh_token", rowToken.valor);
        }
        if (rowRepo?.valor) {
          localStorage.setItem("gh_repo", rowRepo.valor);
        }
      }
    } catch (_) {}
    return getToken();
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

  async function cargarPreguntasDeRama(rama, carpeta = DEFAULT_FOLDER) {
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

    // Obtener sha previo para sobrescribir
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
    listarRamas,
    poblarSelectorRamas,
    cargarPreguntasDeRama,
    guardarPreguntasEnGitHub,
    DEFAULT_BRANCH,
    DEFAULT_FOLDER
  };
})();

window.RepoBranchManager = RepoBranchManager;

// Auto-arrancar al cargar DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => SupabaseAuth.init());
} else {
  SupabaseAuth.init();
}
