// ============================================================
//  CONFIGURACIÓN DEL EVENTO
//  Todo el contenido de la landing se edita aquí.
// ============================================================

const EVENTO = {
  marca: "Red Impulso Mujer",
  nombre: "Brigada de Salud",
  lema: "Una mañana para cuidar tu mente, tu cuerpo y tu salud. Octubre Rosa.",
  fecha: "Por confirmar",
  horario: "9:00 a. m. – 1:00 p. m.",
  lugar: "Por confirmar",
  direccion: "",
  mapaUrl: "", // link de Google Maps (opcional)

  descripcion:
    "Te invitamos a una mañana dedicada a ti: pláticas de salud mental, un taller para recuperar el equilibrio, orientación sobre prevención del cáncer de mama y técnicas de autoexploración con la Secretaría de Salud. Además, contaremos con examen de la vista, mastografías y sesiones de terapia emocional, todo gratis.",

  // Programa del día (se muestra como agenda)
  programa: [
    { hora: "9:00 a. m.", titulo: "Bienvenida" },
    { hora: "9:00 – 9:15 a. m.", titulo: "Meditación" },
    { hora: "9:15 – 10:00 a. m.", titulo: "Plática de salud mental", frase: "Mente en calma, vida en equilibrio", detalle: "Herramientas para cuidar mi salud mental." },
    { hora: "10:00 – 11:00 a. m.", titulo: "Taller", frase: "Respira, suelta y vuelve a ti", detalle: "El poder de detenerte para recuperar el equilibrio." },
    { hora: "11:00 – 11:20 a. m.", titulo: "Receso", pausa: true },
    { hora: "11:20 a. m. – 12:00 p. m.", titulo: "Plática de orientación y prevención del cáncer de mama", frase: "Octubre Rosa: salud, prevención y esperanza" },
    { hora: "12:00 – 12:20 p. m.", titulo: "Testimonio: Mary Quintero" },
    { hora: "12:20 – 12:40 p. m.", titulo: "Taller de técnicas de autoexploración mamaria", detalle: "Secretaría de Salud" },
    { hora: "12:40 – 12:55 p. m.", titulo: "Preguntas y respuestas" },
    { hora: "12:55 p. m.", titulo: "Clausura" },
  ],

  // Opciones que la persona puede elegir al registrarse.
  // conHorario: la persona elige un horario. Los horarios y el cupo de cada uno los define
  // el servidor (vista y mastografía: cada 15 min, 1 persona; terapia: cada 30 min, 10 personas).
  // Los ids deben coincidir con api/storage/[key].js (EVENTOS) en hub-jany.
  opcionesRegistro: [
    {
      id: "talleres",
      titulo: "Pláticas y talleres",
      descripcion: "Todo el programa de 9:00 a. m. a 1:00 p. m.",
    },
    {
      id: "vista",
      titulo: "Examen de la vista gratis",
      descripcion: "Turnos de 15 minutos. Elige tu horario.",
      conHorario: true,
    },
    {
      id: "mastografia",
      titulo: "Mastografía",
      descripcion: "Turnos de 15 minutos. Elige tu horario.",
      conHorario: true,
    },
    {
      id: "terapia",
      titulo: "Sesión de terapia emocional",
      descripcion: "Sesiones cada 30 minutos, hasta 10 personas por horario.",
      conHorario: true,
    },
  ],

  preguntasFrecuentes: [
    { p: "¿Tiene costo?", r: "No, todas las actividades y servicios son gratuitos." },
    { p: "¿Puedo registrarme a varias opciones?", r: "Sí, puedes elegir todas las que quieras. Para el examen de la vista y la mastografía eliges un horario de 15 minutos." },
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
