# Estándar de marca de la plataforma (Hub de Jefes)

Base: la muestra "¿Con cuál letra se ven mejor tus Reels?" que Jany eligió (noviembre 2026).
Todo lo que se ve dentro de un Jefe, el ADN y los hubs sale de aquí. Si algo no está aquí, no se usa.

> Esto es el estilo de **la plataforma**. Los datos de marca de cada cliente (sus colores, su logo, su
> combinación de letras del ADN) se leen siempre de su hub y se usan solo en lo que genera para él.

## Letras: solo 3

| Uso | Letra | Peso | Detalle |
|---|---|---|---|
| **Marca**: logo JEFESHUB, "HUB DE JEFES", nombre del Jefe en la barra de arriba, cifras gigantes | **Bebas Neue** | 400 (es la única) | Siempre MAYÚSCULAS, `letter-spacing: .03em–.04em`. Clase `.marca-grande` |
| Títulos dentro de la página (h1/h2 de sección, títulos de tarjetas) | **Inter Tight** | 800 (ExtraBold); 900 en títulos gigantes | Mayúsculas y minúsculas normales, letras juntas (`letter-spacing: -0.025em` a `-0.035em`); frase clave en bloque lima |
| Texto, botones, campos, subtítulos | **Barlow** | 400 texto · 600 subtítulos · 700 botones | |
| Etiquetas chicas (encima de un campo o sección) | **Barlow** | 700 | MAYÚSCULAS, 11–12 px, `letter-spacing: .12em–.16em` |

Prohibidas en pantallas nuevas: Sora, Inter, JetBrains Mono y cualquier otra. (Las letras del ADN de un
cliente sí se usan, pero solo en sus imágenes, anuncios y muestras de su marca.)

Google Fonts:
`https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600;700;800;900&family=Bebas+Neue&family=Barlow:wght@400;500;600;700&display=swap`

## Colores y lo que significan

| Color | Hex | Significa |
|---|---|---|
| Blanco | `#FFFFFF` | **Área de trabajo**: donde la persona escribe, elige y llena. |
| Gris claro | `#F6F7F1` (fondo) / `#E4E6DB` (bordes) | Paneles y tarjetas dentro del área de trabajo. |
| Negro | `#0F0E0C` | **Resultado final / vista previa**: lo que se va a publicar o mandar (post, reel, anuncio, mensaje, reporte terminado). Si está en negro, es "así se verá". También la opción elegida. |
| Lima | `#C9F507` | **Lo importante**: la palabra clave de un título, la acción principal, etiquetas como "Recomendada". Poco y donde importa. |
| Oliva | `#A4B41C` | Apoyo: viñetas, íconos, líneas. Nunca texto largo. |
| Gris texto | `#5D6055` | Textos secundarios y ayudas. |

El lima nunca va como letra sobre blanco (no se lee): siempre como bloque con letra negra.

## Títulos con bloque lima

La palabra o frase clave del título va en un bloque lima detrás (como resaltador):

```html
<h1>¿Con cuál letra <span class="marca-resalta">se ven mejor</span> tus Reels?</h1>
```

Una sola frase resaltada por título.

## Botones

| Tipo | Cómo se ve | Clase |
|---|---|---|
| Acción principal (Generar, Guardar, Siguiente) | Lima, letra negra, Barlow 700 | (la de cada Jefe; ej. `.ask-btn`) |
| Elegir una opción (pestañas, filtros, Negro/Blanco/Video) | Blanco con borde gris; la elegida en negro con letra blanca | `.marca-opcion` + `aria-pressed="true"` |
| Secundario (Cancelar, Ver más) | Transparente con borde gris | |
| Etiqueta | Bloque lima, MAYÚSCULAS chicas | `.marca-etiqueta` |

Todos: esquinas de 12 px, alto mínimo 44 px en celular, se hunden un poco al presionarlos.

## Ya aplicado (PR "Estándar de marca")

- Sora → Inter Tight, Inter → Barlow y JetBrains Mono → Barlow en los 12 Jefes, el ADN y los hubs.
- Bebas Neue en "HUB DE JEFES" (5 hubs) y en el nombre de cada Jefe en la barra de arriba.
- `js/jefes-nav.js` trae las clases `.marca-grande`, `.marca-resalta`, `.marca-etiqueta` y `.marca-opcion` para todos los Jefes.

## Siguiente (por Jefe)

- Poner el bloque lima en el título principal de cada Jefe.
- Pasar pestañas y filtros al estilo `.marca-opcion`.
- Revisar que lo que está en negro sea solo vista previa / resultado final.
