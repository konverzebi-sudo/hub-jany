// Pinta el contenido de config.js en la página y maneja el registro.

(function () {
  const E = EVENTO;
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hora12 = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}`;
  };

  // Textos simples
  document.querySelectorAll("[data-bind]").forEach((el) => {
    el.textContent = E[el.dataset.bind] ?? "";
  });

  // Programa
  $("#lista-programa").innerHTML = E.programa.map((a) => `
    <li class="${a.pausa ? "pausa" : ""}">
      <span class="agenda__hora">${esc(a.hora)}</span>
      <div class="agenda__info">
        <span class="agenda__titulo">${esc(a.titulo)}</span>
        ${a.frase ? `<span class="agenda__frase">“${esc(a.frase)}”</span>` : ""}
        ${a.detalle ? `<span class="agenda__detalle">${esc(a.detalle)}</span>` : ""}
      </div>
    </li>`).join("");

  // Opciones del registro (las que llevan turno muestran sus horarios al marcarlas)
  $("#opciones-registro").innerHTML = E.opcionesRegistro.map((o) => `
    <label class="opcion">
      <input type="checkbox" name="opciones" value="${esc(o.id)}" />
      <span class="opcion__caja"><strong>${esc(o.titulo)}</strong><small>${esc(o.descripcion)}</small></span>
    </label>
    ${o.conHorario ? `
    <div class="horarios" id="horarios-${esc(o.id)}" hidden>
      <p>Elige tu horario para ${esc(o.titulo.toLowerCase())}:</p>
      <div class="horarios__grid"></div>
    </div>` : ""}`).join("");

  const conHorario = E.opcionesRegistro.filter((o) => o.conHorario);

  function pintarHorarios(servicios) {
    conHorario.forEach((o) => {
      const caja = $(`#horarios-${o.id} .horarios__grid`);
      if (!servicios[o.id] && caja.querySelector(".turno")) return; // sin datos nuevos: se queda como está
      const elegido = caja.querySelector("input:checked")?.value;
      const lista = servicios[o.id] || [];
      caja.innerHTML = lista.length
        ? lista.map((t) => `
          <label class="turno">
            <input type="radio" name="horario-${esc(o.id)}" value="${esc(t.hora)}" ${t.libre ? "" : "disabled"} ${t.libre && t.hora === elegido ? "checked" : ""} />
            <span>${esc(hora12(t.hora))}</span>
          </label>`).join("")
        : '<small class="muted">No se pudieron cargar los horarios. Recarga la página.</small>';
    });
  }

  // Sin servidor (modo prueba) se muestran turnos de 9:00 a 12:45, todos libres.
  function horariosDePrueba() {
    const lista = [];
    for (let t = 9 * 60; t < 13 * 60; t += 15) {
      lista.push({ hora: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`, libre: true });
    }
    return Object.fromEntries(conHorario.map((o) => [o.id, lista]));
  }

  async function cargarHorarios() {
    if (!E.formEndpoint) return pintarHorarios(horariosDePrueba());
    try {
      const r = await fetch(`${E.formEndpoint}?evento=${encodeURIComponent(E.eventoId)}&disponibilidad=1`);
      if (!r.ok) throw new Error(r.status);
      pintarHorarios((await r.json()).servicios || {});
    } catch (e) {
      pintarHorarios({});
    }
  }
  cargarHorarios();

  $("#opciones-registro").addEventListener("change", (ev) => {
    if (ev.target.name !== "opciones") return;
    const caja = $(`#horarios-${ev.target.value}`);
    if (caja) caja.hidden = !ev.target.checked;
  });

  // Preguntas frecuentes
  $("#lista-faq").innerHTML = E.preguntasFrecuentes.map((f) => `
    <details><summary>${esc(f.p)}</summary><p>${esc(f.r)}</p></details>`).join("");

  // Contacto y lugar
  const c = E.contacto, links = [];
  if (c.whatsapp) links.push(`<a href="https://wa.me/${esc(c.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>`);
  if (c.email) links.push(`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`);
  if (c.instagram) links.push(`<a href="${esc(c.instagram)}" target="_blank" rel="noopener">Instagram</a>`);
  if (c.facebook) links.push(`<a href="${esc(c.facebook)}" target="_blank" rel="noopener">Facebook</a>`);
  $("#contacto").innerHTML = links.join("");
  $("#footer-lugar").textContent = [E.lugar, E.direccion].filter((x) => x && x !== "Por confirmar").join(" · ");

  // Registro
  const form = $("#form-registro");
  const msg = $("#form-msg");
  const setMsg = (text, tipo) => { msg.textContent = text; msg.className = "form__msg " + (tipo || ""); };
  const titulo = (id) => E.opcionesRegistro.find((o) => o.id === id)?.titulo || id;

  function resetForm() {
    form.reset();
    conHorario.forEach((o) => { $(`#horarios-${o.id}`).hidden = true; });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const elegidas = data.getAll("opciones");
    const nombre = data.get("nombre").trim();
    const telefono = data.get("telefono").replace(/\D/g, "");
    const horarios = {};

    if (!elegidas.length) return setMsg("Elige al menos una opción.", "error");
    for (const o of conHorario) {
      if (!elegidas.includes(o.id)) continue;
      horarios[o.id] = data.get(`horario-${o.id}`);
      if (!horarios[o.id]) return setMsg(`Elige tu horario para ${o.titulo.toLowerCase()}.`, "error");
    }
    if (!nombre) return setMsg("Por favor escribe tu nombre.", "error");
    if (telefono.length < 10) return setMsg("Escribe tu teléfono a 10 dígitos.", "error");

    const registro = { evento: E.eventoId, nombre, telefono, opciones: elegidas, horarios, sitio: data.get("sitio") || "" };
    const resumen = elegidas.map((id) => titulo(id) + (horarios[id] ? ` (${hora12(horarios[id])})` : "")).join(", ");

    if (!E.formEndpoint) {
      console.log("[MODO PRUEBA] Registro:", registro);
      resetForm();
      return setMsg(`✔ Registro de prueba: ${resumen}. (No se guarda en ningún lado.)`, "ok");
    }

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    setMsg("Enviando…");
    try {
      const r = await fetch(E.formEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registro),
      });
      const resp = await r.json().catch(() => ({}));
      if (r.status === 409) {
        pintarHorarios(resp.servicios || {});
        const cuales = (resp.ocupados || []).map((id) => titulo(id).toLowerCase()).join(" y ");
        return setMsg(`Ese horario de ${cuales} se acaba de ocupar. Elige otro, por favor.`, "error");
      }
      if (!r.ok) throw new Error(resp.error || r.status);
      resetForm();
      cargarHorarios();
      setMsg(`¡Listo${resp.nuevo === false ? ", actualizamos tu registro" : ""}! ${resumen}. Te esperamos 💗`, "ok");
    } catch (e) {
      setMsg("No se pudo enviar. Intenta de nuevo.", "error");
    } finally {
      btn.disabled = false;
    }
  });
})();
