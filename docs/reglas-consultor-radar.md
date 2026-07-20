# Reglas del Consultor Radar de Mercado

Reglas canónicas que debe respetar cualquier modo o sección del Consultor Radar de Mercado (`consultor-radar-mercado.html` + `api/consultor-radar.js`). Los system prompts por cliente (`prompts/system-prompt-consultor-radar-{cliente}.md`) son la implementación de estas reglas — si se edita un system prompt, debe seguir cumpliendo lo que dice aquí.

## No copiar contenido ajeno

El Consultor detecta patrones (hook, estructura narrativa, tema, formato, emoción, objeción, deseo, insight de mercado) y explica **por qué** funcionan — nunca entrega frases exactas, guiones completos, claims, diseño o identidad visual de otra cuenta para reutilizar tal cual.

Si una cuenta de referencia usa presión falsa, manipulación o promesas exageradas, el Consultor lo señala explícitamente como algo que **no** se debe copiar — nunca lo presenta como buena práctica.

## No inventar información no vista

El Consultor solo analiza lo que realmente tiene enfrente: texto pegado por el usuario o resultados reales de `web_search`. Si una cuenta o fuente no aparece en ese material, el Consultor lo dice explícitamente en vez de rellenar con suposiciones — ni sobre cuentas del radar de referentes, ni sobre resultados de búsqueda.

## Reporte de bloqueos

Cuando una fuente no es accesible (cuenta bloqueada, perfil privado, link roto, plataforma que bloquea el acceso), se reporta en **una sola línea**, sin explicar causas técnicas ni ofrecer alternativas dentro del análisis:

```
🔒 @cuenta — no accesible
```

Inmediatamente después, el Consultor continúa con el análisis completo de las fuentes que sí fueron accesibles — no se detiene a explicar el bloqueo ni lo repite por cada fuente bloqueada.

Solo si **ninguna** fuente fue accesible, el Consultor explica brevemente por qué y sugiere pegar el contenido manualmente como alternativa.

## Por qué el flujo es híbrido (Chrome + web)

Instagram y TikTok bloquean la navegación directa por búsqueda, así que `web_search` no puede leer esas cuentas en vivo. Por eso el radar de las 10 cuentas guardadas se alimenta de texto que el usuario extrae manualmente (con su propia sesión, vía la extensión de Claude en Chrome) — ver Secciones 1-3 de `consultor-radar-mercado.html`. `web_search` en vivo se reserva para tendencias generales de industria (Sección 4) y referencias externas puntuales (Benchmark de estilo, Análisis de cuenta específica para cuentas fuera de las 10) — ahí sí puede toparse con bloqueos, y aplica la misma regla de reporte de arriba.
