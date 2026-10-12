// Miniatura de un post de Instagram para las tarjetas de Jefe de Contenido.
// Instagram entrega la imagen en instagram.com/p/<codigo>/media/ pero su CDN la manda con
// "cross-origin-resource-policy: same-origin", así que el navegador no la deja mostrar en otra página.
// Aquí se pide desde el servidor y se devuelve con el caché del propio sitio.
//
// Solo se consulta instagram.com con un código validado (letras, números, - y _), así que
// el endpoint no sirve para pedir otras direcciones.

module.exports = async function handler(req, res) {
  const code = String((req.query && req.query.c) || '');
  if (!/^[\w-]{5,30}$/.test(code)) { res.status(400).end('código inválido'); return; }

  try {
    const r = await fetch('https://www.instagram.com/p/' + code + '/media/?size=l', {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
    });
    const tipo = r.headers.get('content-type') || '';
    if (!r.ok || !tipo.startsWith('image/')) { res.status(404).end('sin imagen'); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', tipo);
    // Las direcciones de Instagram caducan, por eso el caché es de un día y no más.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).end('no se pudo pedir la imagen');
  }
};
