// ============================================================
//  CONFIGURACIÓN DEL EVENTO
//  Todo el contenido de la landing se edita aquí.
//  (Los textos actuales son de EJEMPLO — los cambiamos juntas.)
// ============================================================

const EVENTO = {
  marca: "Red Impulso Mujer MX",
  nombre: "Brigada Impulso Mujer",
  lema: "Un día para cuidarnos, aprender y crecer juntas",
  fecha: "Sábado 00 de mes, 2026",
  horario: "9:00 a 17:00 h",
  lugar: "Lugar por confirmar",
  direccion: "Dirección por confirmar",
  mapaUrl: "", // link de Google Maps (opcional)

  descripcion:
    "Texto de ejemplo: aquí va de qué trata la brigada, a quién va dirigida y por qué es importante asistir. Lo definimos juntas.",

  // Cada actividad aparece como tarjeta y como opción en el registro.
  // cupo: número de lugares (o null si no hay límite)
  actividades: [
    {
      id: "actividad-1",
      titulo: "Actividad 1",
      hora: "9:00 – 10:30",
      descripcion: "Descripción breve de la actividad.",
      cupo: 30,
    },
    {
      id: "actividad-2",
      titulo: "Actividad 2",
      hora: "10:30 – 12:00",
      descripcion: "Descripción breve de la actividad.",
      cupo: 30,
    },
    {
      id: "actividad-3",
      titulo: "Actividad 3",
      hora: "12:00 – 13:30",
      descripcion: "Descripción breve de la actividad.",
      cupo: null,
    },
    {
      id: "actividad-4",
      titulo: "Actividad 4",
      hora: "15:00 – 17:00",
      descripcion: "Descripción breve de la actividad.",
      cupo: 20,
    },
  ],

  preguntasFrecuentes: [
    { p: "¿Tiene costo?", r: "Respuesta por definir." },
    { p: "¿Puedo registrarme a varias actividades?", r: "Sí, puedes elegir todas las que quieras mientras no se empalmen los horarios." },
    { p: "¿Qué debo llevar?", r: "Respuesta por definir." },
  ],

  contacto: {
    whatsapp: "", // ej. "5215512345678"
    email: "",
    instagram: "",
    facebook: "",
  },

  // URL donde se guardan los registros (Google Sheets vía Apps Script).
  // Mientras esté vacío, el formulario funciona en MODO PRUEBA y no envía nada.
  formEndpoint: "",
};
