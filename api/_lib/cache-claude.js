// Caché de prompts de Anthropic para todos los Jefes.
// Lo que se repite entre llamadas (instrucciones del Jefe y contexto del negocio) se marca con
// cache_control: si se vuelve a mandar igual dentro de 5 minutos se cobra al 10% del precio de
// entrada (la primera vez cuesta 25% más). Las instrucciones son iguales para todos los clientes,
// así que esa parte se reutiliza también entre clientes que usan el mismo Jefe.
// Bloques de menos de ~1024 tokens no se cachean (Anthropic los ignora sin error).

const EFIMERA = { type: 'ephemeral' };

// system en bloques: [instrucciones fijas (caché)] [contexto del negocio (caché)] [lo variable de
// esta petición, sin caché]. Va en ese orden porque la caché funciona por prefijo: lo que cambia
// en cada pedido tiene que ir al final para no romper lo de antes.
function systemConCache(fijo, contexto, ...variables) {
  const bloques = [];
  if (fijo) bloques.push({ type: 'text', text: fijo, cache_control: EFIMERA });
  if (contexto) bloques.push({ type: 'text', text: contexto, cache_control: EFIMERA });
  const resto = variables.filter(Boolean).join('\n\n');
  if (resto) bloques.push({ type: 'text', text: resto });
  return bloques;
}

// Chats de varios turnos: marca el último mensaje para que el siguiente turno lea todo el
// historial anterior de la caché y solo pague completo lo nuevo. No modifica el arreglo original.
//
// opciones.total / opciones.max: cuántos mensajes válidos había antes del recorte y el límite que
// usa ese chat (40, o 12 en Meta Ads). Cada turno agrega 2 mensajes (respuesta + mensaje nuevo):
// si total > max - 2, el siguiente turno ya recorta los primeros mensajes, su historial empieza
// distinto y lo escrito en caché nunca se reutiliza (se pagaría 1.25x sin leerlo). En ese caso el
// historial no se marca; las instrucciones y el contexto del system siguen saliendo de caché.
// opciones.noReutilizable: el último mensaje trae adjuntos que el siguiente turno no reenvía.
function historialConCache(messages, opciones) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const o = opciones || {};
  if (o.noReutilizable) return messages;
  if (Number.isFinite(o.total) && Number.isFinite(o.max) && o.total > o.max - 2) return messages;
  const copia = messages.slice();
  const ultimo = copia[copia.length - 1];
  const contenido = typeof ultimo.content === 'string'
    ? [{ type: 'text', text: ultimo.content }]
    : Array.isArray(ultimo.content) ? ultimo.content.map((b) => ({ ...b })) : null;
  if (!contenido || contenido.length === 0) return messages;
  contenido[contenido.length - 1] = { ...contenido[contenido.length - 1], cache_control: EFIMERA };
  copia[copia.length - 1] = { ...ultimo, content: contenido };
  return copia;
}

// Con caché, usage.input_tokens ya no incluye lo leído/escrito en caché: se suma todo para que el
// registro de uso siga mostrando el total de tokens de entrada.
function entradaTotal(usage) {
  return (usage?.input_tokens || 0) + (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
}

// Campos para el registro de uso (uso-tokens-log): total de entrada + cuánto salió de caché.
function camposUso(usage) {
  return {
    inputTokens: entradaTotal(usage),
    outputTokens: usage?.output_tokens || 0,
    cacheReadTokens: usage?.cache_read_input_tokens || 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens || 0,
  };
}

module.exports = { systemConCache, historialConCache, entradaTotal, camposUso };
