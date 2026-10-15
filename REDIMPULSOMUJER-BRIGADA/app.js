// Pinta el contenido de config.js en la página y maneja el registro paso por paso.

(function () {
  const E = EVENTO;
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hora12 = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "p. m." : "a. m."}`;
  };

  // Textos simples
  document.querySelectorAll("[data-bind]").forEach((el) => {
    el.textContent = E[el.dataset.bind] ?? "";
  });

  // Acceso discreto para las organizadoras: el logo de la barra lleva a la vista privada
  // (sin <a> para que no se vea el link al pasar el mouse; la vista igual pide el código)
  $("#logo-acceso").addEventListener("click", () => { location.href = "registros.html"; });

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

  // ─────────────── Registro paso por paso ───────────────
  const OPC = E.opcionesRegistro;
  const PLATICAS = E.programa.filter((a) => a.id);
  const opcion = (id) => OPC.find((o) => o.id === id);

  const form = $("#form-registro");
  const msg = $("#form-msg");
  const setMsg = (text, tipo) => { msg.textContent = text; msg.className = "form__msg " + (tipo || ""); };

  // Lo que la persona va eligiendo; se conserva al ir hacia atrás y adelante.
  let estado, paso;
  function reiniciar() {
    estado = { servicios: [], platicas: [], horarios: {}, nombre: "", telefono: "" };
    paso = 0;
  }
  reiniciar();

  // Pasos: elegir servicios → uno por cada servicio elegido (en orden) → nombre y teléfono
  const pasos = () => ["servicios", ...OPC.filter((o) => estado.servicios.includes(o.id)).map((o) => o.id), "datos"];

  // Horarios disponibles: { servicio: [{ hora, libre, quedan, cupo }] }
  let disponibilidad = {}, dispOk = false;
  async function cargarHorarios() {
    if (!E.formEndpoint) { disponibilidad = horariosDePrueba(); dispOk = true; return; }
    try {
      const r = await fetch(`${E.formEndpoint}?evento=${encodeURIComponent(E.eventoId)}&disponibilidad=1`);
      if (!r.ok) throw new Error(r.status);
      disponibilidad = (await r.json()).servicios || {};
      dispOk = true;
    } catch (e) {
      dispOk = false;
    }
  }
  // Sin servidor (modo prueba): horarios de 9:00 a 13:00, todos libres.
  function horariosDePrueba() {
    const lista = (cada, cupo) => {
      const out = [];
      for (let t = 9 * 60; t < 13 * 60; t += cada) {
        out.push({ hora: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`, libre: true, quedan: cupo, cupo });
      }
      return out;
    };
    return Object.fromEntries(OPC.filter((o) => o.conHorario).map((o) => [o.id, o.id === "terapia" ? lista(30, 10) : lista(15, 1)]));
  }

  function resumenHTML() {
    return OPC.filter((o) => estado.servicios.includes(o.id)).map((o) => {
      let detalle = "";
      if (o.eligePlaticas) detalle = PLATICAS.filter((p) => estado.platicas.includes(p.id)).map((p) => p.corto).join(", ");
      if (o.conHorario && estado.horarios[o.id]) detalle = hora12(estado.horarios[o.id]);
      return `<li><span>${esc(o.icono)} ${esc(o.titulo)}</span><strong>${esc(detalle)}</strong></li>`;
    }).join("");
  }

  function pintarPaso() {
    const lista = pasos();
    const actual = lista[paso];
    // En el paso 1 aún no se sabe cuántos pasos habrá (depende de lo que elija)
    $("#progreso").textContent = paso === 0 ? "Paso 1" : `Paso ${paso + 1} de ${lista.length}`;
    $("#barra").style.width = paso === 0 ? "8%" : `${((paso + 1) / lista.length) * 100}%`;
    $("#atras").hidden = paso === 0;
    $("#siguiente").textContent = actual === "datos" ? "Confirmar registro" : "Continuar";
    setMsg("");

    if (actual === "servicios") {
      $("#paso").innerHTML = `
        <h3 class="paso__titulo">¿Qué te gustaría?</h3>
        <p class="muted paso__ayuda">Puedes marcar varios.</p>
        <div class="opciones">
          ${OPC.map((o) => `
            <label class="opcion">
              <input type="checkbox" name="servicio" value="${esc(o.id)}" ${estado.servicios.includes(o.id) ? "checked" : ""} />
              <span class="opcion__caja"><strong>${esc(o.icono)} ${esc(o.titulo)}</strong><small>${esc(o.descripcion)}</small></span>
            </label>`).join("")}
        </div>`;
    } else if (actual === "datos") {
      $("#paso").innerHTML = `
        <h3 class="paso__titulo">Último paso: tus datos</h3>
        <ul class="resumen-lista">${resumenHTML()}</ul>
        <label>Nombre completo
          <input name="nombre" required autocomplete="name" placeholder="Tu nombre" value="${esc(estado.nombre)}" />
        </label>
        <label>Teléfono / WhatsApp
          <input name="telefono" type="tel" inputmode="tel" required autocomplete="tel" placeholder="10 dígitos" value="${esc(estado.telefono)}" />
        </label>`;
      form.nombre.focus();
    } else {
      const o = opcion(actual);
      if (o.eligePlaticas) {
        $("#paso").innerHTML = `
          <h3 class="paso__titulo">${esc(o.icono)} ${esc(o.pregunta)}</h3>
          <p class="muted paso__ayuda">Puedes marcar varias.</p>
          <div class="checks-lista">
            ${PLATICAS.map((p) => `
              <label class="opcion">
                <input type="checkbox" name="platica" value="${esc(p.id)}" ${estado.platicas.includes(p.id) ? "checked" : ""} />
                <span class="opcion__caja"><strong>${esc(p.titulo)}</strong><small>${esc(p.hora)}${p.frase ? ` · “${esc(p.frase)}”` : ""}</small></span>
              </label>`).join("")}
          </div>`;
      } else {
        pintarHorarios(o);
      }
    }
  }

  function pintarHorarios(o) {
    const lista = disponibilidad[o.id] || [];
    const elegido = estado.horarios[o.id];
    const estadoTxt = (t) => t.libre
      ? (t.cupo > 1 ? `${t.quedan} ${t.quedan === 1 ? "lugar" : "lugares"}` : "Disponible")
      : (t.cupo > 1 ? "Lleno" : "Ocupado");
    const libres = lista.filter((t) => t.libre).length;
    $("#paso").innerHTML = `
      <h3 class="paso__titulo">${esc(o.icono)} ${esc(o.pregunta)}</h3>
      <p class="muted paso__ayuda">${esc(o.descripcion)} Los horarios en gris ya están ocupados.</p>
      <div class="horarios__grid">
        ${!dispOk ? '<small class="muted">No se pudieron cargar los horarios. Revisa tu internet y recarga la página.</small>'
          : lista.map((t) => `
          <label class="turno${t.libre ? "" : " turno--ocupado"}" ${t.libre ? "" : 'title="Este horario ya no tiene lugar"'}>
            <input type="radio" name="horario" value="${esc(t.hora)}" ${t.libre ? "" : "disabled"} ${t.libre && t.hora === elegido ? "checked" : ""} />
            <span>${esc(hora12(t.hora).replace(/ [ap]\. m\./, ""))}<small>${estadoTxt(t)}</small></span>
          </label>`).join("")}
      </div>
      ${dispOk ? `<small class="horarios__resumen muted">${libres ? `Quedan ${libres} de ${lista.length} horarios disponibles.` : "Ya no quedan horarios disponibles."}</small>` : ""}`;
    // Si el horario que ya tenía elegido se ocupó mientras tanto, se le avisa
    if (elegido && !lista.find((t) => t.hora === elegido && t.libre) && dispOk) {
      delete estado.horarios[o.id];
      setMsg(`El horario de ${hora12(elegido)} se acaba de ocupar. Elige otro, por favor.`, "error");
    }
  }

  // Guarda lo que hay en pantalla en `estado`; devuelve un mensaje de error si falta algo.
  function guardarPaso() {
    const actual = pasos()[paso];
    const data = new FormData(form);
    if (actual === "servicios") {
      estado.servicios = data.getAll("servicio");
      if (!estado.servicios.length) return "Elige al menos una opción.";
    } else if (actual === "datos") {
      estado.nombre = (data.get("nombre") || "").trim();
      estado.telefono = (data.get("telefono") || "").trim();
      if (!estado.nombre) return "Por favor escribe tu nombre.";
      if (telefono10(estado.telefono).length !== 10) return "Escribe tu teléfono a 10 dígitos.";
    } else if (opcion(actual).eligePlaticas) {
      estado.platicas = data.getAll("platica");
      if (!estado.platicas.length) return "Elige al menos una plática o taller.";
    } else {
      const h = data.get("horario");
      if (!h) return "Elige un horario.";
      estado.horarios[actual] = h;
    }
    return "";
  }

  // Siempre a 10 dígitos: "+52 55…" y "55…" deben ser la misma persona (no duplicar turnos)
  const telefono10 = (t) => t.replace(/\D/g, "").replace(/^521?(?=\d{10}$)/, "");

  async function irA(n) {
    paso = n;
    const actual = pasos()[paso];
    if (opcion(actual)?.conHorario) await cargarHorarios(); // horarios frescos al entrar al paso
    pintarPaso();
    form.scrollIntoView({ block: "start" });
  }

  $("#atras").addEventListener("click", () => { guardarPaso(); irA(paso - 1); });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const error = guardarPaso();
    if (error) return setMsg(error, "error");
    if (pasos()[paso] !== "datos") return irA(paso + 1);
    enviar();
  });

  // Mantener los lugares al día mientras la persona está en un paso de horario
  setInterval(async () => {
    const o = opcion(pasos()[paso]);
    if (document.visibilityState !== "visible" || !o?.conHorario || form.hidden) return;
    const elegido = new FormData(form).get("horario");
    if (elegido) estado.horarios[o.id] = elegido;
    await cargarHorarios();
    if (opcion(pasos()[paso]) === o) pintarHorarios(o);
  }, 30000);

  async function enviar() {
    const servicios = estado.servicios;
    const horarios = Object.fromEntries(servicios.filter((s) => opcion(s).conHorario).map((s) => [s, estado.horarios[s]]));
    const platicas = servicios.includes("talleres") ? estado.platicas : [];
    const registro = {
      evento: E.eventoId,
      nombre: estado.nombre,
      telefono: telefono10(estado.telefono),
      opciones: [...servicios, ...platicas],
      horarios,
      sitio: new FormData(form).get("sitio") || "",
    };

    if (!E.formEndpoint) {
      console.log("[MODO PRUEBA] Registro:", registro);
      return listo(true);
    }

    const btn = $("#siguiente");
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
        // Alguien más tomó el horario: regresar a ese paso para elegir otro
        const s = (resp.ocupados || [])[0];
        delete estado.horarios[s];
        await irA(pasos().indexOf(s));
        return setMsg("Ese horario se acaba de ocupar. Elige otro, por favor.", "error");
      }
      if (!r.ok) throw new Error(resp.error || r.status);
      listo(resp.nuevo !== false);
    } catch (e) {
      setMsg("No se pudo enviar. Revisa tu internet e intenta de nuevo.", "error");
    } finally {
      btn.disabled = false;
    }
  }

  function listo(nuevo) {
    $("#listo-titulo").textContent = nuevo ? "¡Listo! Tu lugar quedó apartado" : "¡Listo! Actualizamos tu registro";
    $("#listo-resumen").innerHTML = resumenHTML();
    form.hidden = true;
    $("#registro-listo").hidden = false;
    $("#registro-listo").scrollIntoView({ block: "start" });
  }

  $("#otra").addEventListener("click", () => {
    reiniciar();
    form.reset();
    $("#registro-listo").hidden = true;
    form.hidden = false;
    irA(0);
  });

  pintarPaso();
})();
