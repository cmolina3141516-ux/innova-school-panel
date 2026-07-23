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

## Profesores incluidos

- Profesor Julián: Física y Matemáticas.
- Profesor Andrés: Ciencias Naturales y Química.
- Profesor Felipe: Tecnología, Programación y Robótica.
- Profesor Mateo: Lectura Crítica y Filosofía.
- Miss Emily: English and French Teacher.
- Profesora Laura: Ciencias Sociales.
