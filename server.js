const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const port = Number(process.env.PORT || 8890);
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || "INNOVA2026";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "Solicitud inválida." });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/admin/config") {
    sendJson(res, 200, {
      supabaseEnabled: isSupabaseConfigured()
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/accesses") {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { error: "No autorizado." });
      return;
    }

    try {
      const accesses = await listAccesses();
      sendJson(res, 200, { accesses });
    } catch (error) {
      sendJson(res, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/accesses") {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { error: "No autorizado." });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const access = await createAccess(body);
      sendJson(res, 201, { access });
    } catch (error) {
      sendJson(res, 400, { error: getErrorMessage(error) });
    }
    return;
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/admin/accesses/")) {
    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { error: "No autorizado." });
      return;
    }

    try {
      const code = decodeURIComponent(url.pathname.replace("/api/admin/accesses/", ""));
      const body = await readJsonBody(req);
      const access = await updateAccessStatus(code, body.active);
      sendJson(res, 200, { access });
    } catch (error) {
      sendJson(res, 400, { error: getErrorMessage(error) });
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(url.pathname, res);
    return;
  }

  sendJson(res, 405, { error: "Método no permitido." });
});

server.listen(port, () => {
  console.log(`Innova School admin disponible en http://localhost:${port}`);
});

async function createAccess(payload) {
  ensureSupabaseConfigured();
  const tutor = parseTutor(payload.tutor);
  const access = buildAccessRecord({
    ...payload,
    tutor
  });

  await supabaseRequest("access_codes", {
    method: "POST",
    body: {
      code: access.code,
      tutor_prefix: access.tutorKey,
      student_name: access.studentName,
      email: access.email,
      grade: access.grade,
      expires_at: access.expiresAt,
      is_active: true,
      max_sessions_per_day: access.maxSessionsPerDay,
      max_messages_per_day: access.maxMessagesPerDay,
      notes: access.order ? `Orden/comprobante: ${access.order}` : null
    }
  });

  return access;
}

async function listAccesses() {
  ensureSupabaseConfigured();
  const rows = await supabaseRequest(
    "access_codes?select=*&order=created_at.desc&limit=200"
  );
  return (rows || []).map(mapSupabaseAccess);
}

async function updateAccessStatus(code, active) {
  ensureSupabaseConfigured();
  const normalizedCode = normalizeAccessCode(code);
  if (!normalizedCode) {
    throw new Error("Código inválido.");
  }

  const rows = await supabaseRequest(`access_codes?code=eq.${encodeURIComponent(normalizedCode)}&select=*`, {
    method: "PATCH",
    body: {
      is_active: Boolean(active)
    }
  });

  const record = Array.isArray(rows) ? rows[0] : null;
  if (!record) {
    throw new Error("No se encontró el código para actualizar.");
  }

  return mapSupabaseAccess(record);
}

function buildAccessRecord(data) {
  const code = buildAccessCode(data.tutor.key);
  const duration = String(data.duration || "30 días");
  const expiresAt = getExpirationDate(duration).toISOString();

  return {
    id: code,
    code,
    tutorKey: data.tutor.key,
    tutorName: data.tutor.name,
    tutorUrl: data.tutor.url,
    accessUrl: buildAccessUrl(data.tutor.url, code),
    studentName: requireText(data.name, "Nombre del estudiante"),
    grade: requireText(data.grade, "Grado"),
    email: requireText(data.email, "Correo"),
    duration,
    order: String(data.order || "").trim(),
    active: true,
    expiresAt,
    maxSessionsPerDay: Number(data.maxSessionsPerDay || 3),
    maxMessagesPerDay: Number(data.maxMessagesPerDay || 30),
    createdAt: new Date().toISOString()
  };
}

function mapSupabaseAccess(row) {
  const tutorKey = normalizeAccessCode(row.tutor_prefix || row.code.split("-")[0]);
  const tutor = getTutorInfo(tutorKey);
  const order = String(row.notes || "").replace(/^Orden\/comprobante:\s*/i, "");
  return {
    id: row.code,
    code: row.code,
    tutorKey,
    tutorName: tutor.name,
    tutorUrl: tutor.url,
    accessUrl: buildAccessUrl(tutor.url, row.code),
    studentName: row.student_name || "",
    grade: row.grade || "",
    email: row.email || "",
    duration: describeDuration(row.expires_at),
    order,
    active: row.is_active !== false,
    expiresAt: row.expires_at,
    maxSessionsPerDay: Number(row.max_sessions_per_day || 3),
    maxMessagesPerDay: Number(row.max_messages_per_day || 30),
    createdAt: row.created_at
  };
}

function parseTutor(tutorValue) {
  const [key, name, url] = String(tutorValue || "").split("|");
  if (!key || !name || !url) {
    throw new Error("Selecciona un tutor válido.");
  }

  return {
    key: normalizeAccessCode(key),
    name,
    url
  };
}

function getTutorInfo(key) {
  const tutors = {
    JULIAN: ["Profesor Julián", "https://tutor-fisica.onrender.com"],
    ESTEBAN: ["Profesor Esteban", "https://tutor-matematicas.onrender.com"],
    ANDRES: ["Profesor Andrés", "https://tutor-ciencias.onrender.com"],
    LAURA: ["Profesora Laura", "https://tutor-sociales.onrender.com"],
    FELIPE: ["Profesor Felipe", "PENDIENTE_URL_TUTOR"],
    MATEO: ["Profesor Mateo", "PENDIENTE_URL_TUTOR"],
    EMILY: ["Miss Emily", "PENDIENTE_URL_TUTOR"]
  };
  const [name, url] = tutors[key] || [key, "PENDIENTE_URL_TUTOR"];
  return { name, url };
}

function buildAccessCode(tutorKey) {
  return `${tutorKey}-${randomBlock()}-${randomBlock()}-${todayStamp()}`;
}

function randomBlock(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function todayStamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function buildAccessUrl(tutorUrl, code) {
  if (tutorUrl === "PENDIENTE_URL_TUTOR") {
    return "URL del tutor pendiente por configurar";
  }
  return `${tutorUrl}?code=${encodeURIComponent(code)}`;
}

function getExpirationDate(duration) {
  const now = new Date();
  const normalized = String(duration || "").toLowerCase();
  const numberMatch = normalized.match(/\d+/);
  const amount = numberMatch ? Number(numberMatch[0]) : 30;
  if (normalized.includes("minuto")) {
    now.setMinutes(now.getMinutes() + amount);
    return now;
  }
  if (normalized.includes("día") || normalized.includes("dia")) {
    now.setDate(now.getDate() + amount);
    return now;
  }
  now.setDate(now.getDate() + 30);
  return now;
}

function describeDuration(expiresAt) {
  if (!expiresAt) {
    return "Sin vencimiento";
  }
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) {
    return "Vencido";
  }
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 1) {
    return "1 día o menos";
  }
  return `${days} días`;
}

function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} es obligatorio.`);
  }
  return text;
}

async function supabaseRequest(pathname, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase devolvió ${response.status}: ${detail || response.statusText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function isAdminAuthorized(req) {
  return req.headers["x-admin-passcode"] === ADMIN_PASSCODE;
}

function ensureSupabaseConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Render.");
  }
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function normalizeAccessCode(value) {
  return removeAccents(String(value || ""))
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function removeAccents(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function serveStatic(urlPath, res) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(rootDir, normalized);

  if (!filePath.startsWith(rootDir)) {
    sendJson(res, 403, { error: "Acceso denegado." });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Archivo no encontrado." });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("La solicitud es demasiado grande."));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (_error) {
        reject(new Error("JSON inválido en la solicitud."));
      }
    });
    req.on("error", reject);
  });
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "Error inesperado.";
}
