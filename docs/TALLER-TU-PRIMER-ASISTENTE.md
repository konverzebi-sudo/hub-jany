# Taller "Tu Primer Asistente con IA" — estado y reglas (leer antes de tocar el taller)

Taller: **3 de diciembre de 2026, 11:00**. Actualizado: 2026-11-17.

## Archivos y dónde viven
- **Guía** (lo que ve el participante): `guia-taller-ia.html` → jefeshub.com/guia-taller-ia.html
- **Plataforma** (brief/El Pre, presentación, resultados): `taller-app/index.html` → jefeshub.com/taller-app/
- `brief.html`, favicon `img/favicon-j*.{svg,png}` (cuadro lima con "J" negra, ya enlazado en guía, plataforma y brief).
- Fotos/prompts de estilos: `img/estilos/NN-nombre.(webp|jpg|txt)`. Videos: `img/videos/NN-nombre.(mp4|jpg|txt)` (+ `-previo.txt`).
- Diapositivas: `taller-app/diapos/canva/<pageid>.jpg`; `CANVA_PAGINAS` (77 ids) en `taller-app/index.html`; diapositiva del reloj `DIAPO_RELOJ` = PBPmFClmWZjHyPtY (pág. 67).
- Repo GitHub Pages: `konverzebi-sudo/hub-jany` (rama `main` publica).

## Cómo se publica (taller)
- Disco **C: está lleno**: trabajar el worktree en `D:/A_ CLAUDE CONTROL/_claude_tmp/wt` y temporales en `D:/A_ CLAUDE CONTROL/_claude_tmp/`.
- `git fetch` → `git checkout -q -B <rama> origin/main` → copiar SOLO los archivos del cambio (revisar diff contra origin/main para no pisar a otra sesión) → commit → push (reintentar hasta 5 veces, la red falla con 408) → `gh pr create` → `gh pr merge --merge` → esperar con curl hasta que el cambio esté en línea.
- Antes de publicar: extraer el `<script>` más grande y `node --check`.
- Regla general del CLAUDE.md: mergear solo cuando Jany diga "mergea".
- Vista local: `.claude/launch.json` → `py-static` (puerto 8935).

## Reglas de Jany para el taller
- Textos en **primera persona de Jany**, español sencillo. **Jefe**, nunca "agente". Cambios **aditivos** (no borrar contenido ni respuestas).
- No inventar contenido, cifras ni clasificaciones. Preguntar antes de cambios grandes.
- No publicar `referencias/`, MAPA-TALLER.md ni notas privadas (notas-canva.json, SQL 13). No modificar Canva.
- Supabase: nunca la service_role key en código/chat (solo anon en config.js); permisos con RLS; no cambiar Site URL de Hub-cito; no meter correos reales en SQL.
- El secreto de Zoom jamás en el frontend.
- Avisar si una foto de ejemplo trae marcas reales o caras parecidas a famosos (no publicarlas).

## Estructura actual de la guía
Numeración: PRE, 01–10. Ocultas: Propósito, Tu negocio, Sácale provecho, Planea, Buen Fin.
Módulos: Producto ganador · Mercado meta · CONTENIDO Y CAMPAÑAS (Contenido / Campañas) · DISEÑOS INTELIGENCIA ARTIFICIAL (Imágenes IA id '6' / Videos IA id '7').
- Portada: botón "¡IMPORTANTE LLENAR ANTES DEL TALLER!" con latido (→ #clase-1); sin botón Buen Fin; tarjetas Brief previo y El Pre en lima con latido.
- **Imágenes IA** (etapas): 1 Tu logo sin fondo (la plataforma lo quita sola y da PNG; el logo se sube SOLO en El Pre) · 2 Borra el fondo (antes/después) · 3 Diseños de referencia (`ESTILOS_IMAGEN`) · 4 Edita lo que quieras (fondos, colores, textos, caras, logo) · 5 Haz tu propio diseño + Pinterest · 6 Diseños que no pueden faltar (`GALERIA_SUGERIDA`, chips → búsqueda Pinterest) · 7 Cambia el tamaño (`TAMANOS_IMAGEN`).
- **Videos IA**: "Videos de referencia" (`VIDEOS_IA`: 01 Explosión 3D con prompt previo de foto, 02 Lluvia de productos) + "Cómo hacer tu video en Gemini" (9 pasos).

## Catálogo de estilos (cómo agregar uno)
- Jany manda foto + prompt → guardar en `img/estilos/`, agregar entrada a `ESTILOS_IMAGEN` (campos: n, nombre, desc, img, hover (texto o lista que rota), fotos 1/2/3, fotosTxt, pasos, sinBase, pendiente, colores, completa, prompt) y publicar.
- Publicados 01–27. **Ocultos esperando foto**: 09 matcha, 13 sérum, 22 escena (pedir personaje inventado). Falta foto morada de hover para 16.
- Si la imagen pegada no llega como archivo: `pendiente:true` y pedirle que la arrastre.

## Colores y letra de la marca del participante
- Tokens en los prompts: `[COLORES DE MI MARCA]` y `[LETRA DE MI MARCA]`; `conMarca()` los rellena desde localStorage (`KEY+'-marca'`, `KEY+'-letra'`).
- La plataforma detecta colores del logo (aprobar/cambiar/quitar/agregar), elige 1 de 12 mezclas de letras (`TIPOS_MARCA`, sin mostrar nombres) y los manda a la guía con `postMessage {taller:'marca', colores, tipografia}`.
- Al recibir un prompt nuevo de Jany: cambiar los colores fijos del **escenario** por el token (nunca los del producto) y decirle qué se cambió.

## Pendientes
0. **Pago en GHL → acceso automático** (PR 506, mergeado) y **guía con entrada por correo y guardado por alumno** (`docs/TALLER-PAGO-GHL.md`). Falta: variables en Vercel, workflow en GHL, SQL 21 y 22, Redirect URL de la guía, SMTP propio en Supabase y una compra de prueba.
1. **Zoom**: opción 1 botón "Entrar al Zoom" (falta que Jany pase el link de la reunión); opción 2 Zoom dentro de la plataforma (Meeting SDK, junto con Supabase).
2. **Conectar Supabase** (crítico: resultados de grupo y control de diapositivas solo de la ponente no funcionan en modo demo).
3. Cambiar el texto "[LINK DE LA SESIÓN]".
4. Probar "Crear vídeo" de Gemini con cuenta gratis.
5. Preguntas abiertas: estilo 10 (ejemplo de mancuerna vs prompt de bote, letrero "PADEL BALLS"); frases contra copiar marcas en 07/08/09; detectar solo colores principales; foto del estilo 11 sin flechas de Instagram.
6. Liberar espacio en C:.
