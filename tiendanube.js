// Venta automática de los profesores IA por Tiendanube.
//
// 1. Carlos instala la app propia del panel en la tienda (partners.tiendanube.com). Tiendanube redirige a
//    /api/tiendanube/instalar con un código; el servidor lo cambia por el token de la tienda, lo guarda en
//    Supabase (panel_integrations, solo el servidor lo lee) y registra el aviso «pedido pagado».
// 2. Por cada pedido pagado, Tiendanube llama a /api/webhooks/tiendanube (firmado con HMAC-SHA256 del cuerpo).
//    El servidor confirma el pedido con la API de Tiendanube, crea un código por profesor y por unidad
//    (variante «Profesor» del producto) y envía un correo con Resend con un enlace directo a cada profesor.
// 3. Cada pedido se procesa una sola vez (tabla tiendanube_orders): si Tiendanube reenvía el aviso, se
//    reutilizan los mismos códigos y el correo solo se reenvía si no salió.
//
// Variables: TIENDANUBE_APP_ID, TIENDANUBE_APP_SECRET, APP_URL, RESEND_API_KEY, MAIL_FROM.
// Opcionales: TIENDANUBE_CONTACT_EMAIL (correo de contacto de la app, va en el User-Agent), TIENDANUBE_PRODUCT_IDS (por defecto el producto de los profesores), TIENDANUBE_ACCESS_DAYS (30),
// MAIL_BCC (copia oculta de cada correo), MAIL_REPLY_TO, TIENDANUBE_API_BASE y RESEND_API_BASE (solo pruebas).

const crypto = require("crypto");

const TN_API = String(process.env.TIENDANUBE_API_BASE || "https://api.tiendanube.com/v1").replace(/\/+$/, "");
const TN_AUTH_URL = process.env.TIENDANUBE_AUTH_URL || "https://www.tiendanube.com/apps/authorize/token";
const RESEND_API = String(process.env.RESEND_API_BASE || "https://api.resend.com").replace(/\/+$/, "");
// Tiendanube pide identificar cada consulta con el nombre de la app y el correo de contacto registrado.
const USER_AGENT = `Profesores IA - Nova School (${process.env.TIENDANUBE_CONTACT_EMAIL || "https://innova-school-panel.onrender.com"})`;
// «PROFESORES ESPECIALISTAS CON I.A. (1 mes de acompañamiento full)» en virtualplanet3.mitiendanube.com.
const PRODUCT_IDS = String(process.env.TIENDANUBE_PRODUCT_IDS || "357172769")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const ACCESS_DAYS = Number(process.env.TIENDANUBE_ACCESS_DAYS || 30);
const MAX_CODES_PER_ORDER = 30;
const WHATSAPP_URL = "https://wa.me/573013364867";

// Nombre en la variante → profesor. El valor de la variante empieza por el nombre («Julián - Física…»).
const TUTORS = {
  JULIAN: { match: "julian", name: "Profesor Julián", subject: "Física y Matemáticas", url: "https://tutor-fisica.onrender.com" },
  ANDRES: { match: "andres", name: "Profesor Andrés", subject: "Ciencias Naturales y Química", url: "https://tutor-naturales.onrender.com" },
  FELIPE: { match: "felipe", name: "Profesor Felipe", subject: "Tecnología, Programación y Robótica", url: "https://tutor-felipe.onrender.com" },
  MATEO: { match: "mateo", name: "Profesor Mateo", subject: "Lectura Crítica y Filosofía", url: "https://tutor-mateo.onrender.com" },
  EMILY: { match: "emily", name: "Miss Emily", subject: "Inglés y Francés", url: "https://tutor-emily.onrender.com" },
  LAURA: { match: "laura", name: "Profesora Laura", subject: "Ciencias Sociales", url: "https://tutor-sociales.onrender.com" },
  ESTEBAN: { match: "esteban", name: "Profesor Esteban", subject: "Matemáticas", url: "https://tutor-matematicas.onrender.com" }
};

function createTiendanube({ supabaseRequest, isSupabaseConfigured }) {
  // ---------------------------------------------------------------------------------------------
  // Firma de Tiendanube: HMAC-SHA256 (hex) del cuerpo crudo con el secreto de la app.
  function isValidSignature(rawBody, signature) {
    const secret = process.env.TIENDANUBE_APP_SECRET;
    if (!secret || !rawBody || !signature) {
      return false;
    }
    const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"));
    const received = Buffer.from(String(signature).trim().toLowerCase());
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  async function getIntegration() {
    const rows = await supabaseRequest("panel_integrations?key=eq.tiendanube&select=value");
    return Array.isArray(rows) && rows[0] ? rows[0].value : null;
  }

  async function fetchOrder(storeId, orderId) {
    const integration = await getIntegration();
    if (!integration || String(integration.storeId) !== String(storeId)) {
      throw new Error(`Tienda ${storeId} sin conectar: instala la app del panel en Tiendanube.`);
    }
    const response = await fetch(`${TN_API}/${encodeURIComponent(storeId)}/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authentication: `bearer ${integration.accessToken}`, "User-Agent": USER_AGENT }
    });
    if (!response.ok) {
      throw new Error(`Tiendanube respondió ${response.status} al consultar el pedido ${orderId}.`);
    }
    return response.json();
  }

  // ---------------------------------------------------------------------------------------------
  // Qué profesores trae el pedido: una entrada por unidad (cantidad 2 de Julián = 2 códigos de Julián).
  function tutorUnits(order) {
    const units = [];
    const unknown = [];
    for (const line of order.products || []) {
      if (!PRODUCT_IDS.includes(String(line.product_id ?? ""))) {
        continue;
      }
      const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0));
      const key = tutorKeyFromLine(line);
      if (!key) {
        unknown.push(String(line.name || line.variant_id || "producto sin nombre"));
        continue;
      }
      for (let i = 0; i < quantity && units.length < MAX_CODES_PER_ORDER; i += 1) {
        units.push(key);
      }
    }
    return { units, unknown };
  }

  function tutorKeyFromLine(line) {
    const candidates = [
      ...(Array.isArray(line.variant_values) ? line.variant_values : []),
      line.name
    ].map((value) => normalizeText(value));
    for (const text of candidates) {
      for (const [key, tutor] of Object.entries(TUTORS)) {
        if (new RegExp(`\\b${tutor.match}\\b`).test(text)) {
          return key;
        }
      }
    }
    return "";
  }

  const buyerOf = (order) => ({
    email: String(order.contact_email || order.customer?.email || "").trim().toLowerCase(),
    name: String(order.contact_name || order.customer?.name || "").trim()
  });

  // ---------------------------------------------------------------------------------------------
  // Webhook «pedido pagado». Devuelve { status, body }.
  async function handleOrderWebhook(rawBody, signature) {
    if (!isSupabaseConfigured()) {
      return { status: 500, body: { error: "Supabase no configurado" } };
    }
    if (!isValidSignature(rawBody, signature)) {
      return { status: 401, body: { error: "Firma inválida" } };
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (_error) {
      return { status: 400, body: { error: "JSON inválido" } };
    }
    const { event, id: orderId, store_id: storeId } = payload || {};
    if (event !== "order/paid" || !orderId) {
      return { status: 200, body: { ignored: true } };
    }

    const orderKey = String(orderId);
    let record = await getOrderRecord(orderKey);
    if (!record) {
      // El cuerpo del aviso solo trae el id: el pedido se confirma con la API de Tiendanube.
      const order = await fetchOrder(String(storeId ?? ""), orderKey);
      if (order.payment_status && order.payment_status !== "paid") {
        return { status: 200, body: { ignored: true } };
      }
      const { units, unknown } = tutorUnits(order);
      if (unknown.length) {
        console.error(`[tiendanube] Pedido ${orderKey}: no se reconoció el profesor en ${unknown.join(" | ")}.`);
      }
      if (!units.length) {
        return { status: 200, body: { ignored: true } };
      }

      const buyer = buyerOf(order);
      const expiresAt = new Date(Date.now() + ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const codes = units.map((key) => ({ code: buildAccessCode(key), tutor: key }));
      // Se reserva el pedido con sus códigos antes de crearlos: si Tiendanube reenvía el aviso
      // (o llegan dos a la vez), solo uno gana y el otro reutiliza estos mismos códigos.
      const claimed = await claimOrder({
        order_id: orderKey,
        store_id: String(storeId ?? ""),
        order_number: order.number != null ? String(order.number) : null,
        buyer_email: buyer.email || null,
        buyer_name: buyer.name || null,
        codes,
        expires_at: expiresAt,
        status: unknown.length ? "revisar" : "pendiente"
      });
      record = claimed || (await getOrderRecord(orderKey));
      if (!record) {
        throw new Error(`No se pudo reservar el pedido ${orderKey}.`);
      }
    }

    await ensureAccessCodes(record);

    if (!record.emailed_at) {
      if (!record.buyer_email) {
        console.error(`[tiendanube] Pedido ${orderKey} sin correo del comprador: los códigos quedaron en el panel.`);
        return { status: 200, body: { success: true, emailed: false } };
      }
      if (!isMailConfigured()) {
        console.error("[tiendanube] Faltan RESEND_API_KEY o MAIL_FROM: los códigos quedaron en el panel sin enviar.");
        return { status: 200, body: { success: true, emailed: false } };
      }
      // Solo un aviso envía el correo: se reserva el envío antes de mandarlo.
      if (!(await claimEmail(record))) {
        return { status: 200, body: { success: true } };
      }
      try {
        await sendCodesEmail(record);
        await patchOrder(orderKey, { emailed_at: new Date().toISOString(), email_error: null, status: "enviado" });
      } catch (error) {
        const message = String(error?.message || error).slice(0, 300);
        console.error(`[tiendanube] No se pudo enviar el correo del pedido ${orderKey}: ${message}`);
        await patchOrder(orderKey, { email_error: message, status: "pendiente" });
        // Error para que Tiendanube vuelva a intentar más tarde.
        return { status: 500, body: { error: "No se pudo enviar el correo" } };
      }
    }

    // Los códigos nunca se devuelven en esta respuesta.
    return { status: 200, body: { success: true } };
  }

  async function getOrderRecord(orderId) {
    const rows = await supabaseRequest(`tiendanube_orders?order_id=eq.${encodeURIComponent(orderId)}&select=*`);
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }

  // Inserta el pedido; si ya existe (otro aviso ganó), devuelve null.
  async function claimOrder(row) {
    try {
      const rows = await supabaseRequest("tiendanube_orders", { method: "POST", body: row });
      return Array.isArray(rows) ? rows[0] : null;
    } catch (error) {
      if (/\b409\b|duplicate key|23505/.test(String(error?.message))) {
        return null;
      }
      throw error;
    }
  }

  // Pasa el pedido a «enviando» solo si nadie más lo está enviando. Si un envío anterior quedó a medias
  // (el servidor se reinició), se retoma después de 5 minutos.
  async function claimEmail(record) {
    const now = new Date().toISOString();
    const id = encodeURIComponent(record.order_id);
    const claimed = await supabaseRequest(`tiendanube_orders?order_id=eq.${id}&status=in.(pendiente,revisar)`, {
      method: "PATCH",
      body: { status: "enviando", updated_at: now }
    });
    if (Array.isArray(claimed) && claimed.length) {
      return true;
    }
    const current = await getOrderRecord(record.order_id);
    if (!current || current.emailed_at || current.status !== "enviando") {
      return false;
    }
    const stale = Date.now() - new Date(current.updated_at || 0).getTime() > 5 * 60 * 1000;
    if (!stale) {
      return false;
    }
    const retaken = await supabaseRequest(
      `tiendanube_orders?order_id=eq.${id}&status=eq.enviando&updated_at=eq.${encodeURIComponent(current.updated_at)}`,
      { method: "PATCH", body: { status: "enviando", updated_at: now } }
    );
    return Array.isArray(retaken) && retaken.length > 0;
  }

  async function patchOrder(orderId, values) {
    await supabaseRequest(`tiendanube_orders?order_id=eq.${encodeURIComponent(orderId)}`, {
      method: "PATCH",
      body: { ...values, updated_at: new Date().toISOString() },
      prefer: "return=minimal"
    });
  }

  // Crea en access_codes los códigos del pedido (los que ya existan se dejan como están).
  async function ensureAccessCodes(record) {
    const codes = Array.isArray(record.codes) ? record.codes : [];
    if (!codes.length) {
      return;
    }
    const label = record.order_number ? `Tiendanube pedido #${record.order_number}` : `Tiendanube pedido ${record.order_id}`;
    await supabaseRequest("access_codes?on_conflict=code", {
      method: "POST",
      prefer: "return=minimal,resolution=ignore-duplicates",
      body: codes.map(({ code, tutor }) => ({
        code,
        tutor_prefix: tutor,
        student_name: null,
        email: record.buyer_email || null,
        grade: null,
        expires_at: record.expires_at,
        is_active: true,
        notes: label
      }))
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Correo con Resend.
  function isMailConfigured() {
    return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
  }

  async function sendMail({ to, subject, html, text }) {
    const body = { from: process.env.MAIL_FROM, to: [to], subject, html, text };
    if (process.env.MAIL_BCC) {
      body.bcc = String(process.env.MAIL_BCC).split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (process.env.MAIL_REPLY_TO) {
      body.reply_to = process.env.MAIL_REPLY_TO;
    }
    const response = await fetch(`${RESEND_API}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Resend respondió ${response.status}: ${await response.text()}`);
    }
  }

  // Correo con los accesos: una tarjeta por profesor con el código, el botón para entrar y un botón para
  // reenviárselo al estudiante por WhatsApp (el comprador suele ser el padre, en otro dispositivo).
  function renderAccessEmail({ hello, intro, items, notes }) {
    const cards = items.map(({ code, tutor, expiresAt }) => {
      const info = TUTORS[tutor] || { name: tutor, subject: "", url: "" };
      const link = `${info.url}/?code=${encodeURIComponent(code)}`;
      const until = expiresAt ? formatDate(expiresAt) : "";
      const share = [
        `Hola. Este es tu acceso a ${info.name} (${info.subject}) de Nova School${until ? `, válido hasta el ${until}` : ""}.`,
        `Entra aquí: ${link}`,
        "Ábrelo en tu celular o computador: quedará guardado para la próxima vez."
      ].join("\n");
      return { ...info, code, link, until, whatsapp: `https://wa.me/?text=${encodeURIComponent(share)}` };
    });

    const text = [
      hello,
      "",
      intro,
      "",
      ...cards.flatMap((card) => [
        `${card.name} (${card.subject})`,
        `  Código: ${card.code}`,
        ...(card.until ? [`  Vigente hasta: ${card.until}`] : []),
        `  Entrar: ${card.link}`,
        `  Enviar al estudiante por WhatsApp: ${card.whatsapp}`,
        ""
      ]),
      ...notes,
      "",
      "Virtual Planet"
    ].join("\n");

    const cardHtml = (card) => `
  <div style="border:1px solid #dbe3ee;border-radius:14px;padding:16px;margin:14px 0">
    <p style="margin:0;font-size:12px;letter-spacing:1px;color:#1d4e89;text-transform:uppercase">${escapeHtml(card.subject)}</p>
    <p style="margin:4px 0 10px;font-size:18px;font-weight:bold;color:#0f172a">${escapeHtml(card.name)}</p>
    <p style="margin:0 0 6px"><span style="display:inline-block;padding:8px 14px;border-radius:10px;background:#eef2ff;color:#1e3a8a;font-size:18px;font-weight:bold;letter-spacing:1px;font-family:Consolas,monospace">${escapeHtml(card.code)}</span></p>
    ${card.until ? `<p style="margin:0 0 12px;font-size:13px;color:#475569">Vigente hasta el ${escapeHtml(card.until)}</p>` : '<p style="margin:0 0 6px"></p>'}
    <a href="${escapeHtml(card.link)}" style="display:inline-block;background:#1d4e89;color:#ffffff;padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:bold;margin:0 8px 8px 0">Entrar con ${escapeHtml(card.name)}</a>
    <a href="${escapeHtml(card.whatsapp)}" style="display:inline-block;background:#25d366;color:#ffffff;padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:bold;margin:0 0 8px 0">Enviar al estudiante por WhatsApp</a>
  </div>`;
    const html = `<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;color:#1e293b">
  <p>${escapeHtml(hello)}</p>
  <p>${escapeHtml(intro)}</p>
  ${cards.map(cardHtml).join("")}
  ${notes.map((note) => `<p style="font-size:13px;color:#475569">${escapeHtml(note)}</p>`).join("\n  ")}
  <p style="font-size:13px;color:#475569">Virtual Planet</p>
</div>`;
    return { html, text };
  }

  function recoveryUrl() {
    const appUrl = String(process.env.APP_URL || "https://innova-school-panel.onrender.com").replace(/\/+$/, "");
    return `${appUrl}/entrar`;
  }

  async function sendCodesEmail(record) {
    const codes = record.codes || [];
    const firstName = String(record.buyer_name || "").split(/\s+/)[0];
    const hello = firstName ? `Hola, ${firstName}:` : "Hola:";
    const many = codes.length > 1;
    const until = formatDate(record.expires_at);
    const orderLabel = record.order_number ? ` #${record.order_number}` : "";
    const subject = (record.test ? "[Prueba] " : "") + (many
      ? `Tus ${codes.length} accesos a los profesores con I.A. · Nova School`
      : `Tu acceso a ${TUTORS[codes[0].tutor]?.name || "tu profesor"} con I.A. · Nova School`);
    const intro = `Gracias por tu compra${orderLabel}. ${many ? "Estos son tus accesos" : "Este es tu acceso"} a los profesores con inteligencia artificial de Nova School by Virtual Planet, válido${many ? "s" : ""} hasta el ${until}.`;
    const notes = [
      ...(record.test ? ["ESTE ES UN CORREO DE PRUEBA enviado desde el panel: los códigos son de muestra y no permiten entrar."] : []),
      "Si el estudiante usa otro celular o computador, tócale «Enviar al estudiante por WhatsApp» y elige su contacto. Al abrir el enlace en su dispositivo, el acceso queda guardado y la próxima vez entra directo.",
      "Cada código es para un solo estudiante y funciona en una sesión a la vez.",
      `¿Perdieron el enlace? Recupéralo cuando quieras con este correo en ${recoveryUrl()}`,
      `Si tienes algún problema, escríbenos por WhatsApp: ${WHATSAPP_URL}`
    ];
    const { html, text } = renderAccessEmail({ hello, intro, items: codes, notes });
    await sendMail({ to: record.buyer_email, subject, html, text });
  }

  // ---------------------------------------------------------------------------------------------
  // Recuperar el acceso: /entrar. Se escribe un correo y, si tiene profesores vigentes, se le envían
  // a ESE correo (nunca se muestran en pantalla ni se dice si el correo existe).
  const recoveryByIp = new Map();
  const recoveryByEmail = new Map();
  const recoveryGlobal = [];
  const RECOVERY_WINDOW_MS = 15 * 60 * 1000;
  const RECOVERY_OK = "Si ese correo tiene profesores vigentes, en unos minutos le llegará un mensaje con sus enlaces de entrada. Revisa también la carpeta de spam.";

  function underLimit(map, key, max, windowMs, now) {
    const list = (map.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      map.set(key, list);
      return false;
    }
    list.push(now);
    map.set(key, list);
    return true;
  }

  async function handleRecovery(rawEmail, ip) {
    const email = String(rawEmail || "").trim().toLowerCase();
    if (!/^[^\s@*%,;()]+@[^\s@*%,;()]+\.[^\s@*%,;()]+$/.test(email) || email.length > 120) {
      return { status: 400, body: { error: "Escribe un correo válido." } };
    }
    const now = Date.now();
    while (recoveryGlobal.length && now - recoveryGlobal[0] > 60 * 60 * 1000) {
      recoveryGlobal.shift();
    }
    if (!underLimit(recoveryByIp, ip || "?", 5, RECOVERY_WINDOW_MS, now) || recoveryGlobal.length >= 200) {
      return { status: 429, body: { error: "Hiciste muchas solicitudes seguidas. Espera unos minutos e intenta de nuevo." } };
    }
    recoveryGlobal.push(now);
    // Por correo: máximo 3 envíos por hora (si se pasa, se responde igual pero no se envía).
    if (!underLimit(recoveryByEmail, email, 3, 60 * 60 * 1000, now)) {
      return { status: 200, body: { message: RECOVERY_OK } };
    }
    if (!isSupabaseConfigured() || !isMailConfigured()) {
      console.error("[recuperar] Falta configurar Supabase o el correo.");
      return { status: 503, body: { error: "La recuperación no está disponible en este momento. Escríbenos por WhatsApp." } };
    }

    // ilike para encontrar correos guardados con mayúsculas; luego se exige coincidencia EXACTA
    // (en ilike «_» es comodín y podría traer códigos de otro correo).
    const rows = await supabaseRequest(
      `access_codes?email=ilike.${encodeURIComponent(email)}&is_active=eq.true&select=code,tutor_prefix,email,expires_at&order=expires_at.asc&limit=50`
    );
    const valid = (Array.isArray(rows) ? rows : []).filter(
      (row) =>
        String(row.email || "").trim().toLowerCase() === email &&
        TUTORS[String(row.tutor_prefix || "").toUpperCase()] &&
        (!row.expires_at || new Date(row.expires_at).getTime() > now)
    );
    if (!valid.length) {
      console.log("[recuperar] Solicitud sin profesores vigentes.");
      return { status: 200, body: { message: RECOVERY_OK } };
    }

    const items = valid.map((row) => ({ code: row.code, tutor: String(row.tutor_prefix).toUpperCase(), expiresAt: row.expires_at }));
    const many = items.length > 1;
    const { html, text } = renderAccessEmail({
      hello: "Hola:",
      intro: `Pediste recuperar tus accesos de Nova School. ${many ? `Estos son tus ${items.length} profesores vigentes` : "Este es tu profesor vigente"}.`,
      items,
      notes: [
        "Toca «Entrar» desde el dispositivo del estudiante, o «Enviar al estudiante por WhatsApp» para pasárselo. Al abrirlo, el acceso queda guardado en ese dispositivo.",
        "Si no pediste este correo, puedes ignorarlo.",
        `Si tienes algún problema, escríbenos por WhatsApp: ${WHATSAPP_URL}`
      ]
    });
    try {
      await sendMail({
        to: email,
        subject: many ? `Tus ${items.length} profesores de Nova School` : `Tu acceso a ${TUTORS[items[0].tutor].name} · Nova School`,
        html,
        text
      });
      console.log(`[recuperar] Enviados ${items.length} accesos.`);
    } catch (error) {
      console.error(`[recuperar] No se pudo enviar el correo: ${String(error?.message || error).slice(0, 200)}`);
      return { status: 502, body: { error: "No pudimos enviar el correo en este momento. Intenta de nuevo en unos minutos." } };
    }
    return { status: 200, body: { message: RECOVERY_OK } };
  }

  // ---------------------------------------------------------------------------------------------
  // Instalación de la app en la tienda (redirección de Tiendanube).
  async function handleInstall(code) {
    const appId = process.env.TIENDANUBE_APP_ID;
    const secret = process.env.TIENDANUBE_APP_SECRET;
    const appUrl = String(process.env.APP_URL || "").replace(/\/+$/, "");
    if (!isSupabaseConfigured() || !appId || !secret || !appUrl) {
      return { status: 500, text: "Falta configurar Tiendanube en el servidor (TIENDANUBE_APP_ID, TIENDANUBE_APP_SECRET y APP_URL)." };
    }
    if (!code) {
      return { status: 400, text: "Falta el código de autorización." };
    }

    const tokenResponse = await fetch(TN_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: appId, client_secret: secret, grant_type: "authorization_code", code })
    });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !token.access_token || !token.user_id) {
      console.error("[tiendanube] No entregó el token:", token?.error || tokenResponse.status);
      return { status: 502, text: "Tiendanube no autorizó la instalación. Inténtalo de nuevo." };
    }

    const storeId = String(token.user_id);
    const previous = await getIntegration();
    if (previous && String(previous.storeId) !== storeId) {
      return { status: 409, text: "Ya hay otra tienda conectada con este panel." };
    }

    const headers = { Authentication: `bearer ${token.access_token}`, "User-Agent": USER_AGENT, "Content-Type": "application/json" };
    const hookUrl = `${appUrl}/api/webhooks/tiendanube`;
    const hooks = await (await fetch(`${TN_API}/${storeId}/webhooks`, { headers })).json().catch(() => []);
    if (!Array.isArray(hooks) || !hooks.some((hook) => hook.event === "order/paid" && hook.url === hookUrl)) {
      const created = await fetch(`${TN_API}/${storeId}/webhooks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ event: "order/paid", url: hookUrl })
      });
      if (!created.ok) {
        console.error("[tiendanube] No se pudo registrar el aviso de pedido pagado:", created.status, await created.text());
        return { status: 502, text: "La tienda se autorizó, pero no se pudo registrar el aviso de pedidos pagados. Inténtalo de nuevo." };
      }
    }

    await supabaseRequest("panel_integrations?on_conflict=key", {
      method: "POST",
      prefer: "return=minimal,resolution=merge-duplicates",
      body: {
        key: "tiendanube",
        value: { storeId, accessToken: token.access_token, scope: token.scope || null, connectedAt: new Date().toISOString() },
        updated_at: new Date().toISOString()
      }
    });
    console.log(`[tiendanube] Tienda ${storeId} conectada.`);
    return { status: 200, text: "Tienda conectada con el panel de los profesores. Ya puedes cerrar esta ventana." };
  }

  // ---------------------------------------------------------------------------------------------
  // Avisos de privacidad que Tiendanube exige a toda app.
  async function handlePrivacyWebhook(kind, rawBody, signature) {
    if (!isValidSignature(rawBody, signature)) {
      return { status: 401, body: { error: "Firma inválida" } };
    }
    let payload = {};
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (_error) {
      return { status: 400, body: { error: "JSON inválido" } };
    }
    const storeId = String(payload.store_id ?? "");

    if (kind === "store-redact") {
      const integration = await getIntegration();
      if (integration && String(integration.storeId) === storeId) {
        await supabaseRequest("panel_integrations?key=eq.tiendanube", { method: "DELETE", prefer: "return=minimal" });
      }
    } else if (kind === "customers-redact") {
      const email = String(payload.customer?.email || "").trim().toLowerCase();
      if (email) {
        const filter = `email=eq.${encodeURIComponent(email)}`;
        await supabaseRequest(`access_codes?${filter}`, { method: "PATCH", prefer: "return=minimal", body: { email: null, student_name: null } });
        await supabaseRequest(`tiendanube_orders?buyer_email=eq.${encodeURIComponent(email)}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: { buyer_email: null, buyer_name: null, updated_at: new Date().toISOString() }
        });
      }
    } else if (kind === "customers-data-request") {
      // Solo se guarda el correo y el nombre del comprador junto a sus códigos; la solicitud se atiende a mano.
      console.log(`[tiendanube] Solicitud de datos de un comprador de la tienda ${storeId}.`);
    } else {
      return { status: 404, body: { error: "Aviso desconocido" } };
    }
    return { status: 200, body: { success: true } };
  }

  // Correo de prueba desde el panel de administración: mismo diseño, códigos de muestra que no existen.
  async function sendTestEmail(to) {
    const email = String(to || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Escribe un correo válido.");
    }
    if (!isMailConfigured()) {
      throw new Error("Faltan RESEND_API_KEY o MAIL_FROM en Render.");
    }
    await sendCodesEmail({
      test: true,
      buyer_email: email,
      buyer_name: "",
      order_number: "PRUEBA",
      expires_at: new Date(Date.now() + ACCESS_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      codes: [
        { code: "FELIPE-MUES-TRA0-00000000", tutor: "FELIPE" },
        { code: "LAURA-MUES-TRA0-00000000", tutor: "LAURA" }
      ]
    });
    console.log("[tiendanube] Correo de prueba enviado desde el panel.");
  }

  return { handleOrderWebhook, handleInstall, handlePrivacyWebhook, handleRecovery, sendTestEmail, tutorUnits, isValidSignature };
}

// Código del profesor con azar criptográfico: PREFIJO-XXXX-XXXX-AAAAMMDD.
function buildAccessCode(tutorKey) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `${tutorKey}-${block()}-${block()}-${stamp}`;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Bogota" });
  } catch (_error) {
    return String(iso || "").slice(0, 10);
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

module.exports = { createTiendanube, buildAccessCode };
