const ADMIN_WHATSAPP_NUMBER = "573013364867";
const SESSION_KEY = "innovaAdminUnlocked";
const ADMIN_PASSCODE_KEY = "innovaAdminPasscode";

const loginForm = document.querySelector("#adminLoginForm");
const loginError = document.querySelector("#loginError");
const logoutButton = document.querySelector("#adminLogout");
const form = document.querySelector("#accessForm");
const output = document.querySelector("#credentialOutput");
const copyButton = document.querySelector("#copyCredential");
const whatsappButton = document.querySelector("#sendWhatsapp");
const accessTableBody = document.querySelector("#accessTableBody");
const exportButton = document.querySelector("#exportAccesses");
const adminStatus = document.querySelector("#adminStatus");

let lastCredential = null;
let accessesCache = [];
let adminPasscode = sessionStorage.getItem(ADMIN_PASSCODE_KEY) || "";

function parseTutor(tutor) {
  const [key, name, url] = tutor.split("|");
  return { key, name, url };
}

function buildAccessUrl(tutorUrl, code) {
  if (tutorUrl === "PENDIENTE_URL_TUTOR") return "URL del tutor pendiente por configurar";
  return `${tutorUrl}?code=${encodeURIComponent(code)}`;
}

function buildCredentialText(access) {
  return [
    "Credencial de acceso - Innova School",
    "",
    `Estudiante: ${access.studentName}`,
    `Grado: ${access.grade}`,
    `Correo: ${access.email}`,
    `Tutor: ${access.tutorName}`,
    `Duración: ${access.duration}`,
    `Sesiones por día: ${access.maxSessionsPerDay}`,
    `Mensajes por día: ${access.maxMessagesPerDay}`,
    `Orden/comprobante: ${access.order}`,
    `Estado: ${access.active ? "Activo" : "Inactivo"}`,
    "",
    `Código: ${access.code}`,
    `Enlace de acceso: ${access.accessUrl}`,
    "",
    "Indicaciones:",
    "1. Conserva este código durante tu periodo de acceso.",
    "2. Ingresa al enlace del tutor asignado.",
    "3. Si tienes dificultad para acceder, responde este mensaje con tu código."
  ].join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setOutput(access) {
  lastCredential = access;
  output.value = buildCredentialText(access);
  whatsappButton.href = `https://wa.me/${ADMIN_WHATSAPP_NUMBER}?text=${encodeURIComponent(output.value)}`;
}

function setStatus(message, type = "info") {
  if (!adminStatus) return;
  adminStatus.textContent = message;
  adminStatus.dataset.type = type;
}

function renderAccesses(accesses = accessesCache) {
  accessesCache = accesses;

  if (!accesses.length) {
    accessTableBody.innerHTML = '<tr><td colspan="7">Aún no hay credenciales generadas.</td></tr>';
    return;
  }

  accessTableBody.innerHTML = accesses
    .map((access) => {
      const statusClass = access.active ? "is-active" : "is-inactive";
      const statusText = access.active ? "Activo" : "Inactivo";
      return `
        <tr>
          <td><span class="status-pill ${statusClass}">${statusText}</span></td>
          <td><code>${escapeHtml(access.code)}</code></td>
          <td>
            <strong>${escapeHtml(access.studentName)}</strong>
            <small>${escapeHtml(access.email)} · Grado ${escapeHtml(access.grade)}</small>
          </td>
          <td>${escapeHtml(access.tutorName)}</td>
          <td>
            ${escapeHtml(access.duration)}
            <small>${escapeHtml(access.maxSessionsPerDay)} sesiones/día · ${escapeHtml(access.maxMessagesPerDay)} mensajes/día</small>
          </td>
          <td>${escapeHtml(access.order)}</td>
          <td class="table-actions">
            <button type="button" data-action="copy" data-code="${escapeHtml(access.code)}">Copiar</button>
            <button type="button" data-action="toggle" data-code="${escapeHtml(access.code)}">${access.active ? "Desactivar" : "Activar"}</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function unlockAdmin(passcode = adminPasscode, accesses = null) {
  adminPasscode = passcode;
  document.body.classList.add("admin-unlocked");
  sessionStorage.setItem(SESSION_KEY, "true");
  sessionStorage.setItem(ADMIN_PASSCODE_KEY, adminPasscode);

  if (Array.isArray(accesses)) {
    renderAccesses(accesses);
    setStatus("Historial sincronizado con Supabase.", "success");
    return;
  }

  loadAccessesFromServer();
}

function lockAdmin() {
  document.body.classList.remove("admin-unlocked");
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(ADMIN_PASSCODE_KEY);
  adminPasscode = "";
}

function initializeLock() {
  if (sessionStorage.getItem(SESSION_KEY) === "true" && adminPasscode) {
    unlockAdmin(adminPasscode);
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Passcode": adminPasscode
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "No se pudo completar la operación.");
  }

  return data;
}

async function loadAccessesFromServer() {
  setStatus("Cargando accesos desde Supabase...");
  try {
    const data = await apiRequest("/api/admin/accesses");
    renderAccesses(data.accesses || []);
    setStatus("Historial sincronizado con Supabase.", "success");
  } catch (error) {
    renderAccesses([]);
    setStatus(error.message, "error");
  }
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const passcode = document.querySelector("#adminPasscode").value.trim();

  loginError.textContent = "";
  adminPasscode = passcode;

  try {
    const data = await apiRequest("/api/admin/accesses");
    unlockAdmin(passcode, data.accesses || []);
  } catch (error) {
    adminPasscode = "";
    loginError.textContent = error.message || "Clave incorrecta. Intenta nuevamente.";
  }
});

logoutButton?.addEventListener("click", lockAdmin);

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Guardando en Supabase...";
  setStatus("Generando credencial...");

  const data = {
    name: document.querySelector("#studentName").value.trim(),
    grade: document.querySelector("#studentGrade").value.trim(),
    email: document.querySelector("#studentEmail").value.trim(),
    tutor: document.querySelector("#tutorSelect").value,
    duration: document.querySelector("#durationSelect").value,
    order: document.querySelector("#orderNumber").value.trim(),
    maxSessionsPerDay: Number(document.querySelector("#maxSessionsPerDay").value || 3),
    maxMessagesPerDay: Number(document.querySelector("#maxMessagesPerDay").value || 30)
  };

  try {
    const result = await apiRequest("/api/admin/accesses", {
      method: "POST",
      body: data
    });
    const access = result.access;
    accessesCache.unshift(access);
    setOutput(access);
    renderAccesses(accessesCache);
    setStatus("Credencial guardada en Supabase y lista para enviar.", "success");
    form.reset();
    document.querySelector("#maxSessionsPerDay").value = "3";
    document.querySelector("#maxMessagesPerDay").value = "30";
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Generar credencial";
  }
});

copyButton?.addEventListener("click", async () => {
  if (!output.value) return;
  await navigator.clipboard.writeText(output.value);
  copyButton.textContent = "Copiado";
  window.setTimeout(() => {
    copyButton.textContent = "Copiar credencial";
  }, 1600);
});

accessTableBody?.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const access = accessesCache.find((item) => item.code === button.dataset.code);
  if (!access) return;

  if (button.dataset.action === "copy") {
    setOutput(access);
    await navigator.clipboard.writeText(output.value);
    button.textContent = "Copiado";
    window.setTimeout(() => {
      button.textContent = "Copiar";
    }, 1400);
  }

  if (button.dataset.action === "toggle") {
    button.disabled = true;
    try {
      const result = await apiRequest(`/api/admin/accesses/${encodeURIComponent(access.code)}`, {
        method: "PATCH",
        body: {
          active: !access.active
        }
      });
      const index = accessesCache.findIndex((item) => item.code === access.code);
      if (index >= 0) {
        accessesCache[index] = result.access;
      }
      renderAccesses(accessesCache);
      setStatus(`Código ${result.access.active ? "activado" : "desactivado"} en Supabase.`, "success");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }
});

exportButton?.addEventListener("click", () => {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const blob = new Blob([JSON.stringify(accessesCache, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `innova-school-accesos-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

initializeLock();
renderAccesses();
