# Pago en GoHighLevel → acceso automático al taller

Cuando alguien paga en la landing de GHL, entra solo al taller y todo lo que llena se guarda en
**su propia cuenta** (jefeshub.com/taller-app/). Nadie más ve su información.

## Cómo funciona
1. La persona paga en la landing de GHL (formulario de pago con Stripe conectado en GHL).
2. Un workflow de GHL manda un aviso a `https://agentes.jefeshub.com/api/storage/ghl-pago`.
3. El servidor revisa la clave secreta y agrega su correo a la lista de invitados del taller (Supabase).
4. GHL le manda el link `https://jefeshub.com/taller-app/` por correo y/o WhatsApp.
5. Entra con **el mismo correo con el que pagó** → le llega un enlace mágico (sin contraseña) → ya está dentro.

Código: `api/_lib/taller-pago.js` (vive dentro de `api/storage/[key].js` por el límite de 12 funciones).
Pruebas: `tests/taller-pago-ghl.test.js`.

## Configurar una sola vez

### A. Vercel (Settings → Environment Variables, ambiente Production)
| Nombre | Qué va |
|---|---|
| `GHL_WEBHOOK_SECRET` | Una frase larga inventada (ej. 30+ letras y números). La misma va en GHL. |
| `TALLER_SUPABASE_URL` | La "Project URL" de Supabase del taller (la misma de `taller-app/config.js`). |
| `TALLER_SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API Keys → **secret / service_role**. Solo aquí, nunca en el código ni en el chat. |

Después: Deployments → Redeploy para que las tome.

### B. GHL: workflow "Pago taller"
- **Disparador:** "Order Submitted" / "Payment Received" filtrado por el producto del taller.
- **Acción 1:** Add Tag → `pago-taller` (para tus listas y recordatorios).
- **Acción 2:** Webhook
  - URL: `https://agentes.jefeshub.com/api/storage/ghl-pago` · Método: POST
  - Custom Data: `secreto` = la misma frase de `GHL_WEBHOOK_SECRET`
  - (Opcional) `taller` = `primer-agente` (si un día hay otro taller, aquí va su nombre corto)
- **Acción 3:** Wait 1 minuto.
- **Acción 4:** Send Email / WhatsApp: bienvenida con el link `https://jefeshub.com/taller-app/` y la
  indicación "entra con el mismo correo con el que pagaste".
- Recordatorios (día anterior, 1 hora antes) con el mismo link.

### C. Supabase: correos del enlace mágico
El correo que manda Supabase de fábrica solo aguanta **unos pocos correos por hora**. Para un grupo
grande hay que poner un servidor de correo propio (Authentication → Emails → SMTP Settings) antes
del taller; si no, a algunas personas no les llegará el enlace para entrar.

## Probar
Compra de prueba en la landing (o "Test Workflow" en GHL con un contacto de prueba) → en Supabase,
tabla `invitados`, debe aparecer el correo con rol `alumno` → entrar a taller-app con ese correo.

## Respuestas del servidor (para revisar en el historial del workflow de GHL)
- 200 `ok` · 401 clave equivocada · 400 sin correo válido o taller inexistente ·
  500 faltan las variables de Vercel · 502 Supabase no respondió (GHL reintenta).

## La guía: cada quien entra con su correo (guia-taller-ia.html)
- Con Supabase conectado, la guía pide **entrar con el correo con el que se pagó** (enlace mágico, misma
  sesión que taller-app). Correo que no está en `invitados` → "Tu correo no está inscrito".
- Lo que llena cada quien (avances, palomitas, colores y letra de su marca, campaña, ideas, "Listo en
  ChatGPT") se guarda en **su fila** de `guia_alumno` y se le carga en cualquier aparato. La ponente
  puede leer las de todos; nadie más.
- `?vista=ponente` solo abre con un correo de rol `ponente`; cualquier otro regresa a la vista de alumno.
- Si en un mismo navegador entra otra persona, lo del navegador anterior no se le mezcla.

### Antes de publicarla (una sola vez)
1. Supabase → SQL Editor → correr `taller-app/supabase/22_guia_por_alumno.sql` (después del 21 del PR 504).
2. Supabase → Authentication → URL Configuration → **Redirect URLs** → agregar
   `https://jefeshub.com/guia-taller-ia.html` (sin esto el enlace del correo lleva a taller-app; también
   funciona, pero hay que volver a la guía).
3. **Agregar a `invitados` a quien ya esté usando la guía** (al publicarla, todos tienen que entrar con
   correo). Lo que ya habían llenado en su navegador se sube solo a su cuenta la primera vez que entran.
