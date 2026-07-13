# hub-jany

Sitio estático de JefesHub (`jefeshub.com`), servido en producción desde GitHub Pages. El Centro de Agentes (`/agentes`) corre por separado en Vercel, desplegado desde la rama `feature/agentes-dashboard-backend`, en `agentes.jefeshub.com`.

## Centro de Agentes (`/agentes`)

Este proyecto suma un backend serverless en Vercel para tres piezas:

- `api/agente-conversion.js` — endpoint que llama a la API de Anthropic desde el servidor (la `ANTHROPIC_API_KEY` nunca toca el cliente). Usado por `agente-conversion-ventas.html`.
- `api/sugerir-contenido.js` — mismo patrón, sugiere gancho + caption a partir de una idea cruda. Usado por el Banco de ideas en `selector-historias-contenido.html`.
- `api/storage/[key].js` — key-value store en Postgres que reemplaza `window.storage` (entorno de artifacts) para que los datos persistan entre celular y computadora. Usado por `agente-conversion-ventas.html` y `selector-historias-contenido.html` a través de `js/storage-client.js`.

### Setup en Vercel (una sola vez)

1. En [vercel.com](https://vercel.com), importar este repo de GitHub como proyecto nuevo. Framework preset: "Other" (no hace falta build step).
2. En el proyecto, ir a **Storage → Create Database → Postgres** y conectarlo. Esto inyecta automáticamente `POSTGRES_URL` y variables relacionadas — no hay que llenarlas a mano.
3. En **Settings → Environment Variables**, agregar:
   - `ANTHROPIC_API_KEY` — la API key de Anthropic (secreta, solo servidor).
   - `STORAGE_WRITE_TOKEN` — un token random elegido a mano (ej. `openssl rand -hex 20`). Es el que se le pide a Jany la primera vez que guarda algo desde cualquier dispositivo.
4. Cada push genera un **Preview Deployment** con su propia URL — revisar ahí antes de mandar nada a producción/dominio real.
5. El dominio `jefeshub.com` sigue apuntando a GitHub Pages hasta que se confirme el cambio explícitamente — no mover el DNS sin aprobación.

Ver `.env.example` para la lista completa de variables.
