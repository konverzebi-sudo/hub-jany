// Pinta el contenido de config.js en la página y maneja el registro.

(function () {
  const E = EVENTO;
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Textos simples
  document.querySelectorAll("[data-bind]").forEach((el) => {
    el.textContent = E[el.dataset.bind] ?? "";
  });
  document.title = `${E.nombre} | ${E.marca}`;

  // Tarjetas de actividades
  $("#lista-actividades").innerHTML = E.actividades.map((a) => `
    <article class="card">
      <span class="card__hora">${esc(a.hora)}</span>
      <h3>${esc(a.titulo)}</h3>
      <p>${esc(a.descripcion)}</p>
      ${a.cupo ? `<span class="card__cupo">Cupo: ${a.cupo} lugares</span>` : ""}
    </article>`).join("");

  // Opciones del formulario
  $("#opciones-actividades").innerHTML = E.actividades.map((a) => `
    <label class="check">
      <input type="checkbox" name="actividades" value="${esc(a.id)}" />
      <span>${esc(a.titulo)} <small>${esc(a.hora)}</small></span>
    </label>`).join("");

  // Preguntas frecuentes
  $("#lista-faq").innerHTML = E.preguntasFrecuentes.map((f) => `
    <details><summary>${esc(f.p)}</summary><p>${esc(f.r)}</p></details>`).join("");

  // Contacto
  const c = E.contacto, links = [];
  if (c.whatsapp) links.push(`<a href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (c.email) links.push(`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);
  if (c.instagram) links.push(`<a href="${esc(c.instagram)}" target="_blank" rel="noopener">Instagram</a>`);
  if (c.facebook) links.push(`<a href="${esc(c.facebook)}" target="_blank" rel="noopener">Facebook</a>`);
  $("#contacto").innerHTML = links.join("");

  // Registro
  const form = $("#form-registro");
  const msg = $("#form-msg");
  const setMsg = (text, tipo) => { msg.textContent = text; msg.className = "form__msg " + (tipo || ""); };

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const elegidas = data.getAll("actividades");

    if (!data.get("nombre")?.trim() || !data.get("telefono")?.trim())
      return setMsg("Por favor escribe tu nombre y teléfono.", "error");
    if (!elegidas.length)
      return setMsg("Elige al menos una actividad.", "error");
    if (!data.get("aviso"))
      return setMsg("Necesitamos tu autorización para usar tus datos.", "error");

    const registro = {
      fecha_registro: new Date().toISOString(),
      nombre: data.get("nombre").trim(),
      telefono: data.get("telefono").trim(),
      email: data.get("email")?.trim() || "",
      edad: data.get("edad") || "",
      ubicacion: data.get("ubicacion")?.trim() || "",
      actividades: elegidas
        .map((id) => E.actividades.find((a) => a.id === id)?.titulo || id)
        .join(", "),
    };

    if (!E.formEndpoint) {
      console.log("[MODO PRUEBA] Registro:", registro);
      form.reset();
      return setMsg("✔ Registro de prueba recibido (aún no se guarda en ningún lado).", "ok");
    }

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    setMsg("Enviando…");
    try {
      await fetch(E.formEndpoint, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(registro),
      });
      form.reset();
      setMsg("¡Listo! Tu registro quedó guardado. Te contactaremos por WhatsApp.", "ok");
    } catch (e) {
      setMsg("No se pudo enviar. Intenta de nuevo o escríbenos por WhatsApp.", "error");
    } finally {
      btn.disabled = false;
    }
  });
})();
