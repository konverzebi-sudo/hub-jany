// ============================================================
//  CONFIGURACIÓN DEL EVENTO
//  Todo el contenido de la landing se edita aquí.
// ============================================================

const EVENTO = {
  marca: "Red Impulso Mujer",
  nombre: "Brigada de Salud",
  lema: "Una mañana para cuidar tu mente, tu cuerpo y tu salud. Octubre Rosa.",
  fecha: "Martes 27 de octubre",
  horario: "9:00 a. m. – 1:00 p. m.",
  lugar: "Auditorio de la Facultad de Psicología",
  direccion: "",
  mapaUrl: "", // link de Google Maps (opcional)

  descripcion:
    "Te invitamos a una mañana dedicada a ti: pláticas de salud mental, un taller para recuperar el equilibrio, orientación sobre prevención del cáncer de mama y técnicas de autoexploración con la Secretaría de Salud. Además, contaremos con examen de la vista, mastografías y sesiones de terapia emocional, todo gratis.",

  // Programa del día (se muestra como agenda)
  programa: [
    { hora: "9:00 a. m.", titulo: "Bienvenida" },
    { hora: "9:00 – 9:15 a. m.", titulo: "Meditación" },
    // Los que tienen `id` se pueden elegir en el registro (paso "Pláticas y talleres").
    // Los ids deben coincidir con EVENTOS.opciones en api/storage/[key].js (hub-jany).
    { id: "platica-mental", corto: "Salud mental", hora: "9:15 – 10:00 a. m.", titulo: "Plática de salud mental", frase: "Mente en calma, vida en equilibrio", detalle: "Herramientas para cuidar mi salud mental." },
    { id: "taller-respira", corto: "Taller Respira", hora: "10:00 – 11:00 a. m.", titulo: "Taller", frase: "Respira, suelta y vuelve a ti", detalle: "El poder de detenerte para recuperar el equilibrio." },
    { hora: "11:00 – 11:20 a. m.", titulo: "Receso", pausa: true },
    { id: "platica-mama", corto: "Cáncer de mama", hora: "11:20 a. m. – 12:00 p. m.", titulo: "Plática de orientación y prevención del cáncer de mama", frase: "Octubre Rosa: salud, prevención y esperanza" },
    { hora: "12:00 – 12:20 p. m.", titulo: "Testimonio: Mary Quintero" },
    { id: "taller-autoexploracion", corto: "Autoexploración", hora: "12:20 – 12:40 p. m.", titulo: "Taller de técnicas de autoexploración mamaria", detalle: "Secretaría de Salud" },
    { hora: "12:40 – 12:55 p. m.", titulo: "Preguntas y respuestas" },
    { hora: "12:55 p. m.", titulo: "Clausura" },
  ],

  // Opciones que la persona puede elegir al registrarse.
  // conHorario: la persona elige un horario. Los horarios y el cupo de cada uno los define
  // el servidor (vista y mastografía: cada 15 min, 1 persona; terapia: cada 30 min, 10 personas).
  // Los ids deben coincidir con api/storage/[key].js (EVENTOS) en hub-jany.
  // eligePlaticas: su paso pregunta a cuáles pláticas/talleres del programa (los que tienen id).
  // pregunta: el título del paso de ese servicio.
  opcionesRegistro: [
    {
      id: "talleres",
      icono: "🎤",
      titulo: "Pláticas y talleres",
      descripcion: "De 9:00 a. m. a 1:00 p. m.",
      eligePlaticas: true,
      pregunta: "¿A qué pláticas y talleres quieres asistir?",
    },
    {
      id: "vista",
      icono: "👓",
      titulo: "Examen de la vista gratis",
      descripcion: "Turnos de 15 minutos.",
      conHorario: true,
      pregunta: "¿A qué hora quieres tu examen de la vista?",
    },
    {
      id: "mastografia",
      icono: "🎗️",
      titulo: "Mastografía",
      descripcion: "Turnos de 15 minutos.",
      conHorario: true,
      pregunta: "¿A qué hora quieres tu mastografía?",
    },
    {
      id: "terapia",
      icono: "💗",
      titulo: "Sesión de terapia emocional",
      descripcion: "Cada 30 minutos, hasta 10 personas por horario.",
      conHorario: true,
      pregunta: "¿A qué hora quieres tu sesión de terapia emocional?",
    },
  ],

  preguntasFrecuentes: [
    { p: "¿Tiene costo?", r: "No, todas las actividades y servicios son gratuitos." },
    { p: "¿Puedo registrarme a varias opciones?", r: "Sí, puedes elegir todas las que quieras. El registro te va preguntando paso a paso a qué pláticas quieres ir y a qué hora quieres cada servicio." },
    { p: "¿Cómo funciona la terapia emocional?", r: "Son sesiones cada 30 minutos, con hasta 10 personas por horario. Elige el que mejor te acomode al registrarte." },
    { p: "¿Y si quiero cambiar mi horario?", r: "Vuelve a registrarte con el mismo teléfono y elige el nuevo horario; el anterior se libera." },
    { p: "¿Puedo llevar a alguien?", r: "Sí, solo pídele que haga su propio registro para apartar su lugar." },
  ],

  contacto: {
    whatsapp: "", // ej. "5215512345678"
    email: "",
    instagram: "",
    facebook: "",
  },

  // Dónde se guardan los registros (base de datos de jefeshub).
  // Si se deja vacío, el formulario funciona en MODO PRUEBA y no envía nada.
  // La lista se consulta y descarga en registros.html (pide el código).
  formEndpoint: "https://agentes.jefeshub.com/api/storage/registros-evento",
  eventoId: "brigada-salud-rim-2026",
};
