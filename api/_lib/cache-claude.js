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
function historialConCache(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
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
