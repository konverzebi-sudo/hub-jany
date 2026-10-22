# Estándar común de los Jefes

Lo que **todos** los Jefes deben usar para verse y comportarse igual. Si un chat va a cambiar un Jefe,
primero lee esto y usa estas piezas; no inventes otra versión del estilo, del chat o del filtro.

La referencia visual es el **Jefe 366** (`consultor-366.html`, en vivo en `agentes.jefeshub.com/jefe-366`).
Para la tipografía y el aire de las pantallas blancas también se usa como inspiración `https://www.henry.cm`.

## 1. Piel blanca — `css/jefes-piel-blanca.css`

```html
<!-- después del <style> propio de la página -->
<link rel="stylesheet" href="/css/jefes-piel-blanca.css">
<body class="piel-blanca"> ...
```

- Fondo blanco, texto negro (#1A1A1A), acento verde lima (#C0F800), títulos en **Sora** y texto en **Inter**.
- Todo vive bajo `body.piel-blanca`: cargar el archivo sin la clase no cambia nada.
- Clases listas:
  - Encabezado: `.jefe-logo` (logo del Jefe, **mismo tamaño en todos**: 96–128 px), `.pb-eyebrow`, `.pb-titulo`, `.pb-sub`.
  - Contenido: `.pb-card`, `.pb-card-label`, `.pb-seccion-titulo`, `.pb-chip` (`.activo`).
  - Botones del mismo alto: `.pb-btn`, `.pb-btn-sec`, `.pb-btn-borde`; fila de botones del mismo ancho: `.pb-botones`.
  - Chat: `.builder-chat`, `.bubble.user`, `.bubble.assistant`, `.bubble.error`, `.builder-input`.
  - Pregunta redonda del encabezado: `.pb-pregunta`. Sugerencias rápidas: `.pb-sugerencias` + `.pb-sugerencia`.
- Los Jefes que ya tienen piel blanca propia (366, Faro) pueden quedarse así; los demás migran a este archivo.

## 2. Logo del Jefe

- En el encabezado: `<img class="jefe-logo" src="/img/<logo>.webp" alt="">` — nunca tamaños sueltos.
- Logos con fondo transparente: versión `-negro` sobre blanco y `-blanco` sobre oscuro (la barra lateral
  `js/jefes-nav.js` ya elige sola).

## 3. Filtro de producto / servicio / grupo — `js/jefes-foco.js`

La pastilla de arriba ("Tu ecosistema completo" o un producto) es **la misma en todos los Jefes** y se
recuerda entre páginas del mismo hub.

```html
<div class="topbar-izq"><a class="back-link" ...>« Hub de Jefes</a><div id="foco-slot"></div></div>
<script>window.__focoConfig = { grupos: true, productos366: true };</script>  <!-- opcional -->
<script src="/js/storage-client.js"></script>
<script src="/js/jefes-foco.js"></script>
```

- `window.__foco.get()` → `{ id: 'all' | <producto_id> | 'g:<grupo_id>', nombre, item, grupo }`.
- `window.__foco.onChange(fn)` → la página vuelve a cargar **sus** datos para ese foco.
- Regla: con "ecosistema completo" se muestra todo; con un producto o grupo, **todo el Jefe** (chat, tablas,
  tarjetas, calendario) se filtra a ese foco y el chat recibe el foco para responder solo sobre él.
- No agregues un segundo selector de producto dentro de la página si ya está el de arriba.

## 4. Chat

- Mismo aspecto que el del Jefe 366 (clases del punto 1). Burbuja del usuario en verde, del Jefe en blanco.
- Debajo del chat, 3–5 **sugerencias rápidas** que cambian según lo que ya hizo el usuario
  (ej. si ya hizo su primer post: "¿Hacemos el reel de esta semana?").
- Si el servidor responde **402** (`tope: true`), se muestra `data.error` tal cual: es el aviso de tope de
  tokens con la compra de paquete (ver `api/_lib/saldo.js`). No lo trates como error de conexión.

## 5. Guía paso a paso — `js/guia-jefe.js`

Cada Jefe trae su intro: qué se hace aquí y en qué orden, resaltando los botones reales.

```js
GuiaJefe.registrar({ id: 'anuncios', nombre: 'Jefe de Anuncios', pasos: [
  { selector: '#mi-boton', titulo: 'Pícale aquí', texto: 'Esto sirve para…' },
]});
```

## 6. Reglas que no cambian

- **Multi-hub:** nunca escribas datos de una marca en el código; todo sale del ADN del hub (`<hub>:...`).
- **No inventar:** precios, promociones y resultados solo si están en el ADN.
- **Pruebas:** `npm test` debe pasar antes de subir (sin red ni costos).
- **Ramas:** trae `origin/main`, crea tu rama, abre PR. No hagas merge; lo revisa y mergea la dueña.
- **Funciones de servidor:** el plan de Vercel permite 12 y ya están ocupadas; agrega lógica dentro de un
  archivo existente de `api/`, nunca uno nuevo.
