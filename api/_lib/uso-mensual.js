// Resumen mensual permanente del uso de IA de cada hub (<hub>:uso-tokens-mensual).
// El registro detallado (<hub>:uso-tokens-log) solo guarda los últimos 500 usos; este resumen
// nunca se recorta, así que /hubs puede mostrar el gasto real por mes aunque el hub sea muy activo.
// Forma: { desde: <fecha del primer uso sumado aquí>, meses: { '2026-10': { llamadas, inputTokens,
// outputTokens, cacheReadTokens, cacheWriteTokens } } }. Los meses son de la hora de México.

const ZONA = 'America/Mexico_City';

function mesDe(fecha) {
  const d = new Date(fecha);
  if (isNaN(d)) return null;
  // sv-SE da el formato AAAA-MM-DD, del que se toma AAAA-MM.
  return d.toLocaleDateString('sv-SE', { timeZone: ZONA }).slice(0, 7);
}

// Suma un registro de uso (el mismo objeto que se guarda en uso-tokens-log) a su mes.
function sumarAlMes(resumen, item) {
  const r = resumen && typeof resumen === 'object' && !Array.isArray(resumen) ? resumen : {};
  const fecha = (item && item.date) || new Date().toISOString();
  const mes = mesDe(fecha);
  if (!mes) return r;
  if (!r.desde) r.desde = fecha;
  if (!r.meses || typeof r.meses !== 'object') r.meses = {};
  const m = r.meses[mes] || (r.meses[mes] = { llamadas: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  m.llamadas += 1;
  m.inputTokens += item.inputTokens || 0;
  m.outputTokens += item.outputTokens || 0;
  m.cacheReadTokens += item.cacheReadTokens || 0;
  m.cacheWriteTokens += item.cacheWriteTokens || 0;
  return r;
}

module.exports = { sumarAlMes, mesDe, ZONA };
