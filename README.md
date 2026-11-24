# Innova School AI Tutors

Landing page y panel administrativo para ofrecer los profesores IA de Innova School by Virtual Planet.

## Cómo probar

Para ver solo la landing, puedes abrir `index.html` directamente en Chrome.

Para usar el panel admin con Supabase, inicia el servidor:

```powershell
npm start
```

Luego abre:

```text
http://localhost:3000/admin.html
```

## Despliegue en Render

Este proyecto debe desplegarse como **Web Service**, no como sitio estático, porque `server.js` protege la conexión con Supabase.

- Build command: `npm install`
- Start command: `npm start`

Variables de entorno necesarias:

```text
ADMIN_PASSCODE=coloca_una_clave_privada_para_el_admin
SUPABASE_URL=https://qfrribywlrgxznlklovz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key_de_supabase
```

No publiques ni compartas `SUPABASE_SERVICE_ROLE_KEY`.

## Enlace de Tiendanube

Edita `app.js` y reemplaza:

```js
const STORE_URL = "https://TU-TIENDANUBE.com/productos/profesores-ia-innova-school";
```

por el enlace real de tu producto, coleccion o pagina de pago en Tiendanube.

## Venta automática por Tiendanube

Cuando un pedido del producto de los profesores (id `357172769`, variante «Profesor») queda pagado, el panel crea
un código por profesor y por unidad, con 30 días de vigencia, y le envía al comprador un correo con un botón que
entra directo a cada profesor. Código en `tiendanube.js`.

Configuración (una sola vez):

1. Ejecutar `supabase-tiendanube.sql` en Supabase (crea `panel_integrations` y `tiendanube_orders`).
2. Crear una app propia en partners.tiendanube.com (separada de la de Saber 11), distribución «Para sus clientes», con permiso de leer pedidos:
   - URL de redirección: `https://innova-school-panel.onrender.com/api/tiendanube/instalar`
   - Avisos de privacidad: `https://innova-school-panel.onrender.com/api/webhooks/tiendanube/privacidad/store-redact`,
     `.../customers-redact` y `.../customers-data-request`.
3. Variables en Render: `TIENDANUBE_APP_ID`, `TIENDANUBE_APP_SECRET`, `APP_URL=https://innova-school-panel.onrender.com`,
   `RESEND_API_KEY`, `MAIL_FROM` (por ejemplo `Virtual Planet <profesores@vplanet.co>`, de un dominio verificado en
   Resend). `TIENDANUBE_CONTACT_EMAIL` (el correo de contacto de la app). Opcionales: `MAIL_BCC` (copia oculta), `MAIL_REPLY_TO`, `TIENDANUBE_ACCESS_DAYS` (30).
4. Instalar la app en la tienda: Tiendanube redirige a `/api/tiendanube/instalar`, que guarda el token y registra el
   aviso de pedido pagado.

Pedidos sin correo enviado: `select * from tiendanube_orders where emailed_at is null;` en Supabase.

## Profesores incluidos

- Profesor Julián: Física y Matemáticas.
- Profesor Andrés: Ciencias Naturales y Química.
- Profesor Felipe: Tecnología, Programación y Robótica.
- Profesor Mateo: Lectura Crítica y Filosofía.
- Miss Emily: English and French Teacher.
- Profesora Laura: Ciencias Sociales.
