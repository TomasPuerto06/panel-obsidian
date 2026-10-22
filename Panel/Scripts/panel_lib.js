// Panel en Obsidian: librería de los formularios y de la sincronización con Google Sheets.
//
// Los archivos pequeños de Panel/Scripts (registrar_dia.js, sincronizar.js, anadir_movimiento.js,
// editar_movimiento.js, borrar_movimiento.js y configurar_puente.js) cargan esta librería y llaman a
// una de sus funciones. Son las acciones de QuickAdd.
//
// Cómo se habla con la app (el "puente", ver Proyectos/Panel_de_vida/puente/Puente.gs):
//  - Cada petición va firmada con HMAC-SHA256 con un secreto que solo está en Panel/Scripts/.puente/
//    conexion.json (fuera de Git) y en las propiedades del script de Google. La firma incluye la hora y un
//    número de un solo uso.
//  - Todo lo que se escribe aquí se guarda primero en las notas y se encola en pendiente.json; si no hay
//    conexión, se envía en la siguiente sincronización.
//  - "Sheets manda": al sincronizar, primero se envía lo pendiente y luego las notas se ajustan a lo que
//    diga la hoja (últimos 14 días de salud y todos los movimientos).

const CFG = {
  diario: "Panel/Diario",
  plantilla: "Panel/Plantillas/Plantilla - Nota del dia.md",
  movimientos: "Panel/Finanzas/Movimientos",
  tareas: "Panel/Tareas",
  calendario: "Panel/Calendario",
  diasEventosAntes: 30,      // eventos de calendario: desde hace 30 días...
  diasEventosDespues: 120,   // ...hasta dentro de 120
  puente: "Panel/Scripts/.puente",
  diasSync: 14,        // días de salud que se traen en cada sincronización
  diasPrimera: 60,     // y en la primera, para que las gráficas de semanas tengan historia
  urlPermitida: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/,
};
const RUTA = {
  conexion: CFG.puente + "/conexion.json",
  pendiente: CFG.puente + "/pendiente.json",
  rechazadas: CFG.puente + "/rechazadas.json",
  estado: CFG.puente + "/estado.json",
  configuracion: "Panel/Configuracion.md",   // ajustes del usuario (objetivos, título de los turnos…)
};

const SIN = "Sin cambios";
const DESCANSO = "Descanso";
const ENTRENOS = [
  { id: "pht", nombre: "Pecho · Hombro · Tríceps" },
  { id: "eba", nombre: "Espalda · Bíceps · Abs" },
  { id: "pierna", nombre: "Pierna" },
];
const NOMBRES_ENTRENO = ENTRENOS.map((e) => e.nombre).concat([DESCANSO]);
const TIPOS = ["gasto", "ingreso", "ahorro", "inversion"];
// Categorías de movimiento propuestas (sin tildes ni espacios). El formulario añade las que ya usen tus movimientos.
const CATEGORIAS = ["comida", "transporte", "ocio", "compras", "servicios", "nomina", "inversion", "ahorro", "otros"];
// Categorías de tarea que ofrece el formulario (al editar, se añade la que ya tenga la tarea)
const CAT_TAREAS = ["personal", "clase", "trabajo", "gimnasio", "proyecto"];
// Hábitos del puente: nombre en la hoja -> [propiedad de la nota, mínimo, máximo, es sí/no]
const HABITOS = {
  cinta: ["cinta_min", 0, 600, false],
  agua: ["agua_litros", 0, 10, false],
  sueno: ["sueno_horas", 0, 24, false],
  animo: ["animo", 1, 5, false],
  pasos: ["pasos", 0, 1, true],
  lectura: ["lectura", 0, 1, true],
  preparar_dia: ["preparar_dia", 0, 1, true],
  proyecto: ["proyecto", 0, 1, true],
};

// ---------- Utilidades ----------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseFecha = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const sumarDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const hoyTexto = () => ymd(new Date());

function fechaValida(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const f = parseFecha(s);
  return ymd(f) === s;
}

// Número escrito por una persona: acepta coma o punto. Vacío = null; ilegible = NaN.
function numero(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const ALIAS_ENTRENO = { pht: "pht", pechohombrotriceps: "pht", eba: "eba", espaldabicepsabs: "eba", pierna: "pierna", descanso: "descanso" };
// Nombre guardado en la nota (o código antiguo) -> id de la hoja ("pht", "eba", "pierna"), "descanso" o null
function idEntreno(valor) {
  if (valor === false) return "descanso";
  if (typeof valor !== "string") return null;
  return ALIAS_ENTRENO[norm(valor)] || null;
}
const nombreEntreno = (id) => (ENTRENOS.find((e) => e.id === id) || {}).nombre || null;

function nuevoId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const h = () => Math.floor(Math.random() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => (c === "x" ? h() : ((Math.random() * 4) | 8).toString(16)));
}

function aviso(params, texto) {
  try { new params.obsidian.Notice(texto); } catch (e) { /* sin aviso */ }
}

// ---------- Ficheros ----------
async function leerJson(app, ruta, defecto) {
  try {
    if (!(await app.vault.adapter.exists(ruta))) return defecto;
    return JSON.parse(await app.vault.adapter.read(ruta));
  } catch (e) { return defecto; }
}

async function escribirJson(app, ruta, valor) {
  if (!(await app.vault.adapter.exists(CFG.puente))) await app.vault.adapter.mkdir(CFG.puente);
  await app.vault.adapter.write(ruta, JSON.stringify(valor, null, 2));
}

async function asegurarCarpeta(app, ruta) {
  let acumulada = "";
  for (const parte of ruta.split("/")) {
    acumulada = acumulada ? acumulada + "/" + parte : parte;
    if (!app.vault.getAbstractFileByPath(acumulada)) await app.vault.createFolder(acumulada);
  }
}

const frontmatterDe = (app, archivo) => (app.metadataCache.getFileCache(archivo) || {}).frontmatter || {};

// ---------- Notas del día ----------
async function crearNotaDia(app, fecha) {
  const ruta = CFG.diario + "/" + fecha + ".md";
  const plantilla = app.vault.getAbstractFileByPath(CFG.plantilla);
  let contenido = plantilla
    ? await app.vault.read(plantilla)
    : "---\ntipo: nota-del-dia\nfecha: {{date:YYYY-MM-DD}}\n---\n\n## Notas\n";
  contenido = contenido.replace(/\{\{date:YYYY-MM-DD\}\}/g, fecha);
  await asegurarCarpeta(app, CFG.diario);
  return await app.vault.create(ruta, contenido);
}

// Añade texto al final de la sección "## Notas" (la crea si falta) sin tocar el resto de la nota.
function anadirNota(data, texto) {
  const lineas = data.split("\n");
  const ini = lineas.findIndex((l) => /^##\s+Notas\s*$/.test(l));
  if (ini === -1) return data.trimEnd() + "\n\n## Notas\n\n" + texto + "\n";
  let fin = lineas.length;
  for (let i = ini + 1; i < lineas.length; i++) {
    if (/^##\s/.test(lineas[i])) { fin = i; break; }
  }
  const antes = lineas.slice(0, fin).join("\n").trimEnd();
  const despues = lineas.slice(fin).join("\n");
  return antes + "\n\n" + texto + "\n" + (despues ? "\n" + despues : "");
}

// Datos de una nota del día en el formato del puente. Devuelve null si no hay nada que enviar.
function notaADia(fecha, fm) {
  const dia = { fecha, habitos: {} };
  const e = idEntreno(fm.entreno);
  if (e) dia.entreno = e;
  Object.keys(HABITOS).forEach((h) => {
    const [prop, min, max, esSiNo] = HABITOS[h];
    const v = fm[prop];
    if (esSiNo) { if (v === true) dia.habitos[h] = 1; return; }
    if (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max) dia.habitos[h] = v;
  });
  return dia.entreno || Object.keys(dia.habitos).length ? dia : null;
}

// ---------- Nombres de las notas de movimientos y tareas ----------
// "<carpeta>/<fecha> <8 primeros caracteres del id>.md". Si otra nota ya usa ese nombre (ids que empiezan
// igual el mismo día), se usa el id completo, para que una colisión nunca pare la sincronización.
const prefijoNota = (dir, fecha) => dir + "/" + fecha + " ";
function rutaLibre(app, dir, fecha, id, actual) {
  const corta = prefijoNota(dir, fecha) + String(id).slice(0, 8) + ".md";
  const ocupante = app.vault.getAbstractFileByPath(corta);
  if (!ocupante || (actual && ocupante.path === actual.path)) return corta;
  return prefijoNota(dir, fecha) + String(id) + ".md";
}

// ---------- Movimientos de finanzas ----------

function propsMov(m) {
  return { tipo: "movimiento", id: m.id, fecha: m.fecha, concepto: m.concepto, clase: m.tipo, categoria: m.categoria || "otros", cantidad: m.cantidad };
}

async function escribirNotaMov(app, m, archivo) {
  if (!archivo) {
    await asegurarCarpeta(app, CFG.movimientos);
    archivo = await app.vault.create(rutaLibre(app, CFG.movimientos, m.fecha, m.id, null), "---\n---\n");
  } else if (!archivo.path.startsWith(prefijoNota(CFG.movimientos, m.fecha))) {
    await app.fileManager.renameFile(archivo, rutaLibre(app, CFG.movimientos, m.fecha, m.id, archivo));   // cambió la fecha
  }
  await app.fileManager.processFrontMatter(archivo, (fm) => { Object.assign(fm, propsMov(m)); });
  return archivo;
}

function notasDeMovimientos(app) {
  const porId = {};
  app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(CFG.movimientos + "/")).forEach((f) => {
    const fm = frontmatterDe(app, f);
    if (fm.id) porId[String(fm.id)] = f;
  });
  return porId;
}

function movDeNota(fm) {
  return { id: String(fm.id), fecha: String(fm.fecha), concepto: String(fm.concepto || ""), tipo: fm.clase, categoria: fm.categoria || "otros", cantidad: Number(fm.cantidad) };
}

function validarMovimiento(m) {
  if (!fechaValida(m.fecha)) return "Fecha no válida: escribe AAAA-MM-DD";
  if (!m.concepto || m.concepto.length > 120) return "El concepto es obligatorio (máximo 120 caracteres)";
  if (!TIPOS.includes(m.tipo)) return "Tipo de movimiento no válido";
  if (!(m.cantidad > 0) || !Number.isFinite(m.cantidad) || m.cantidad > 1e7) return "La cantidad debe ser un número mayor que 0";
  if (String(m.categoria).length > 40) return "La categoría es demasiado larga (máximo 40 caracteres)";
  return null;
}

// ---------- Tareas ----------
// Una nota por tarea en Panel/Tareas: tipo, id (el de la fila de la hoja), tarea, fecha (puede faltar),
// categoria y hecha.
function propsTarea(t) {
  return { tipo: "tarea", id: t.id, tarea: t.tarea, fecha: t.fecha || null, categoria: t.categoria || "personal", hecha: t.hecha === true };
}

async function escribirNotaTarea(app, t, archivo) {
  const dia = t.fecha || "sin fecha";
  if (!archivo) {
    await asegurarCarpeta(app, CFG.tareas);
    archivo = await app.vault.create(rutaLibre(app, CFG.tareas, dia, t.id, null), "---\n---\n");
  } else if (!archivo.path.startsWith(prefijoNota(CFG.tareas, dia))) {
    await app.fileManager.renameFile(archivo, rutaLibre(app, CFG.tareas, dia, t.id, archivo));   // cambió la fecha
  }
  await app.fileManager.processFrontMatter(archivo, (fm) => { Object.assign(fm, propsTarea(t)); });
  return archivo;
}

function notasDeTareas(app) {
  const porId = {};
  app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(CFG.tareas + "/")).forEach((f) => {
    const fm = frontmatterDe(app, f);
    if (fm.id && fm.tipo === "tarea") porId[String(fm.id)] = f;
  });
  return porId;
}

function tareaDeNota(fm) {
  return { id: String(fm.id), tarea: String(fm.tarea || ""), fecha: fm.fecha ? String(fm.fecha).slice(0, 10) : "", categoria: fm.categoria ? String(fm.categoria) : "personal", hecha: fm.hecha === true };
}

function validarTarea(t) {
  if (!t.tarea || t.tarea.length > 200) return "La tarea es obligatoria (máximo 200 caracteres)";
  if (t.fecha && !fechaValida(t.fecha)) return "Fecha no válida: escribe AAAA-MM-DD o déjala vacía";
  if (String(t.categoria).length > 40) return "La categoría es demasiado larga (máximo 40 caracteres)";
  return null;
}

// ---------- Eventos de calendario (exámenes y turnos de trabajo) ----------
// Una nota por evento en Panel/Calendario: tipo, id (el de Google Calendar), titulo, fecha, inicio y fin (fecha y
// hora "AAAA-MM-DDTHH:MM"; faltan si es de todo el día), todo_el_dia, categoria (examen o trabajo),
// calendario (examenes o trabajo) y notas. Las horas no se guardan como "09:00" suelto porque YAML puede leerlo
// como un número. Los turnos de "trabajo" solo se pueden crear desde aquí (anadirTurno); se cambian y se borran en
// Google Calendar.
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// El panel no usa entregas: todo lo del calendario de exámenes es un examen.
const categoriaEvento = (e) => (e.calendario === "trabajo" ? "trabajo" : "examen");

function propsEvento(e) {
  return {
    tipo: "evento", id: e.id, titulo: e.titulo, fecha: e.fecha,
    inicio: e.horaInicio ? e.fecha + "T" + e.horaInicio : null, fin: e.horaFin ? e.fecha + "T" + e.horaFin : null,
    todo_el_dia: e.todoElDia === true, categoria: categoriaEvento(e), calendario: e.calendario || "examenes", notas: e.notas || null,
  };
}

const horaDe = (v) => (v ? String(v).slice(11, 16) : null);

function eventoDeNota(fm) {
  return {
    id: String(fm.id), titulo: String(fm.titulo || ""), fecha: String(fm.fecha || "").slice(0, 10),
    horaInicio: horaDe(fm.inicio), horaFin: horaDe(fm.fin), todoElDia: fm.todo_el_dia === true,
    calendario: fm.calendario ? String(fm.calendario) : "examenes", notas: fm.notas ? String(fm.notas) : "",
  };
}

async function escribirNotaEvento(app, e, archivo) {
  if (!archivo) {
    await asegurarCarpeta(app, CFG.calendario);
    archivo = await app.vault.create(rutaLibre(app, CFG.calendario, e.fecha, e.id, null), "---\n---\n");
  } else if (!archivo.path.startsWith(prefijoNota(CFG.calendario, e.fecha))) {
    await app.fileManager.renameFile(archivo, rutaLibre(app, CFG.calendario, e.fecha, e.id, archivo));   // cambió la fecha
  }
  await app.fileManager.processFrontMatter(archivo, (fm) => { Object.assign(fm, propsEvento(e)); });
  return archivo;
}

function notasDeEventos(app) {
  const porId = {};
  app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(CFG.calendario + "/")).forEach((f) => {
    const fm = frontmatterDe(app, f);
    if (fm.id && fm.tipo === "evento") porId[String(fm.id)] = f;
  });
  return porId;
}

function validarEvento(e) {
  if (!e.titulo || e.titulo.length > 120) return "El título es obligatorio (máximo 120 caracteres)";
  if (!fechaValida(e.fecha)) return "Fecha no válida: escribe AAAA-MM-DD";
  if (!e.todoElDia) {
    if (!RE_HORA.test(e.horaInicio || "")) return "La hora de inicio debe ser HH:MM (por ejemplo 09:00); déjala vacía si es de todo el día";
    if (e.horaFin && (!RE_HORA.test(e.horaFin) || e.horaFin <= e.horaInicio)) return "La hora de fin debe ser HH:MM y posterior a la de inicio";
  }
  if ((e.notas || "").length > 500) return "Las notas son demasiado largas (máximo 500 caracteres)";
  return null;
}

// Quita la palabra "Examen" del principio ("Examen Historia" -> "Historia") para el formulario de edición.
function sinPrefijo(titulo) {
  const t = String(titulo || "").trim();
  const m = t.match(/^examen\s*(de\s+|:|-)?\s*(.*)$/i);
  return m && m[2] ? m[2] : t;
}

// ---------- Conexión con el puente ----------
async function cargarConexion(params) {
  const c = await leerJson(params.app, RUTA.conexion, null);
  if (!c || !c.url || !c.secreto) return null;
  if (!CFG.urlPermitida.test(c.url)) return null;
  return c;
}

async function firmar(secreto, mensaje) {
  const enc = new TextEncoder();
  const clave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, enc.encode(mensaje));
  return Array.from(new Uint8Array(firma)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function nonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Devuelve { ok:true, ...datos } | { ok:false, error } | { sinConexion:true } | { respuestaRara:true }
async function llamar(params, conexion, op, datos) {
  const t = Date.now();
  const n = nonce();
  // Tildes, ñ y € como \uXXXX: Apps Script no firma en UTF-8 y con ellas las firmas no coincidirían
  const d = JSON.stringify(datos === undefined ? {} : datos)
    .replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  const s = await firmar(conexion.secreto, [t, n, op, d].join("."));
  let res;
  try {
    res = await params.obsidian.requestUrl({
      url: conexion.url, method: "POST", contentType: "application/json",
      body: JSON.stringify({ t, n, op, d, s }), throw: false,
    });
  } catch (e) {
    return { sinConexion: true };
  }
  let json;
  try { json = res.json; } catch (e) { json = null; }
  if (!json || typeof json !== "object" || typeof json.ok !== "boolean") return { respuestaRara: true, estado: res && res.status };
  return json;
}

// ---------- Cola de pendientes ----------
async function encolar(app, op, datos) {
  const cola = await leerJson(app, RUTA.pendiente, []);
  if (op === "guardarDia") {
    const previo = cola.find((x) => x.op === "guardarDia" && x.datos.fecha === datos.fecha);
    if (previo) {
      if ("entreno" in datos) previo.datos.entreno = datos.entreno;
      if (datos.habitos) previo.datos.habitos = Object.assign(previo.datos.habitos || {}, datos.habitos);
    } else cola.push({ op, datos });
  } else if (op === "guardarMovimiento" || op === "guardarTarea" || op === "guardarEvento") {
    // Lo último que se guarda de un mismo elemento sustituye a lo anterior
    const i = cola.findIndex((x) => x.op !== "guardarDia" && x.datos.id === datos.id);
    if (i >= 0) cola.splice(i, 1);
    cola.push({ op, datos });
  } else if (op === "borrarMovimiento" || op === "borrarTarea" || op === "borrarEvento") {
    for (let i = cola.length - 1; i >= 0; i--) if (cola[i].op !== "guardarDia" && cola[i].datos.id === datos.id) cola.splice(i, 1);
    cola.push({ op, datos });
  }
  await escribirJson(app, RUTA.pendiente, cola);
}

// Envía la cola. Devuelve { ok, enviadas, pendientes, sinConexion?, rechazadas? }
async function vaciarCola(params, conexion) {
  const { app } = params;
  let cola = await leerJson(app, RUTA.pendiente, []);
  if (!cola.length) return { ok: true, enviadas: 0, pendientes: 0 };
  let enviadas = 0;
  const rechazadas = [];

  while (cola.length) {
    const lote = cola.slice(0, 200);
    const r = await llamar(params, conexion, "lote", { ops: lote });
    if (r.sinConexion) return { ok: false, sinConexion: true, enviadas, pendientes: cola.length };
    if (r.respuestaRara) return { ok: false, respuestaRara: true, enviadas, pendientes: cola.length };
    if (r.ok) { cola = cola.slice(lote.length); enviadas += lote.length; await escribirJson(app, RUTA.pendiente, cola); continue; }
    if (r.error === "no autorizado") return { ok: false, noAutorizado: true, enviadas, pendientes: cola.length };
    // El lote entero falló por datos no válidos: se prueba una a una para aislar la mala.
    for (const op of lote) {
      const u = await llamar(params, conexion, op.op, op.datos);
      if (u.sinConexion) return { ok: false, sinConexion: true, enviadas, pendientes: cola.length };
      if (u.ok) { enviadas++; }
      else if (u.error === "no autorizado") return { ok: false, noAutorizado: true, enviadas, pendientes: cola.length };
      else if (u.error === "operación no válida") return { ok: false, puenteAntiguo: true, enviadas, pendientes: cola.length };  // se queda en la cola
      else rechazadas.push({ op: op.op, datos: op.datos, error: u.error, cuando: new Date().toISOString() });
      cola = cola.filter((x) => x !== op && JSON.stringify(x) !== JSON.stringify(op));
      await escribirJson(app, RUTA.pendiente, cola);
    }
  }
  if (rechazadas.length) {
    const previas = await leerJson(app, RUTA.rechazadas, []);
    await escribirJson(app, RUTA.rechazadas, previas.concat(rechazadas));
  }
  return { ok: true, enviadas, pendientes: 0, rechazadas: rechazadas.length };
}

function textoErrorCola(r) {
  if (r.sinConexion) return "sin conexión; queda pendiente";
  if (r.noAutorizado) return "el puente no te reconoce (revisa el secreto en «Configurar puente»)";
  if (r.respuestaRara) return "el puente no respondió como se esperaba (¿URL o despliegue?)";
  if (r.puenteAntiguo) return "el puente de Google es de una versión antigua: pega el Puente.gs nuevo y crea una versión nueva del despliegue; queda pendiente";
  return "no se pudo enviar";
}

// Guarda en la cola y lo intenta enviar ya. Devuelve el texto para el aviso.
async function enviarOEncolar(params, op, datos) {
  await encolar(params.app, op, datos);
  const conexion = await cargarConexion(params);
  if (!conexion) return "guardado en Obsidian; configura el puente para enviarlo a Google";
  const r = await vaciarCola(params, conexion);
  if (r.ok) return r.rechazadas ? "guardado en Obsidian, pero Google lo rechazó (mira rechazadas.json)" : "guardado y enviado a Google";
  return "guardado en Obsidian; " + textoErrorCola(r);
}

// ---------- Acción: Registrar dia ----------
async function registrarDia(params) {
  const { app, quickAddApi } = params;
  const hoy = hoyTexto();
  const sino = [SIN, "Sí", "No"];

  let r;
  try {
    r = await quickAddApi.requestInputs([
      { id: "fecha", label: "Día (AAAA-MM-DD)", type: "text", defaultValue: hoy },
      { id: "animo", label: "Ánimo (1 a 5)", type: "dropdown", options: [SIN, "1", "2", "3", "4", "5"], defaultValue: SIN },
      { id: "sueno", label: "Horas de sueño (objetivo 7)", type: "text", placeholder: "Por ejemplo 7,5", optional: true },
      { id: "entreno", label: "Entreno", type: "dropdown", options: [SIN, ...NOMBRES_ENTRENO], defaultValue: SIN },
      { id: "cinta", label: "Cinta (minutos; 0 si no andaste)", type: "text", placeholder: "30", optional: true },
      { id: "agua", label: "Agua (litros; objetivo 2,5)", type: "text", placeholder: "2,5", optional: true },
      { id: "pasos", label: "Pasos", type: "dropdown", options: sino, defaultValue: SIN },
      { id: "lectura", label: "Lectura", type: "dropdown", options: sino, defaultValue: SIN },
      { id: "preparar_dia", label: "Preparar el día siguiente", type: "dropdown", options: sino, defaultValue: SIN },
      { id: "proyecto", label: "Tiempo de proyecto", type: "dropdown", options: sino, defaultValue: SIN },
      { id: "notas", label: "Notas del día", type: "textarea", placeholder: "Qué has hecho, cómo te has sentido…", optional: true },
    ]);
  } catch (e) { return; }

  // 1. Validar todo antes de escribir nada
  const fecha = String(r.fecha || hoy).trim();
  if (!fechaValida(fecha)) { aviso(params, "Día no válido: escribe AAAA-MM-DD"); return; }

  const cambios = {};   // propiedades de la nota
  const errores = [];
  const lee = (clave, texto, hab) => {
    const [prop, min, max] = HABITOS[hab];
    const n = numero(r[clave]);
    if (n === null) return;
    if (Number.isNaN(n) || n < min || n > max) { errores.push(texto + " (entre " + min + " y " + max + ")"); return; }
    cambios[prop] = n;
  };
  if (r.animo && r.animo !== SIN) cambios.animo = Number(r.animo);
  lee("sueno", "Horas de sueño", "sueno");
  lee("cinta", "Minutos de cinta", "cinta");
  lee("agua", "Agua", "agua");
  if (r.entreno && r.entreno !== SIN) cambios.entreno = r.entreno;
  for (const k of ["pasos", "lectura", "preparar_dia", "proyecto"]) {
    if (r[k] === "Sí") cambios[k] = true;
    else if (r[k] === "No") cambios[k] = false;
  }
  if (errores.length) { aviso(params, "Revisa: " + errores.join("; ")); return; }

  const notas = String(r.notas || "").trim();
  if (Object.keys(cambios).length === 0 && !notas) { aviso(params, "No había nada que registrar"); return; }

  // 2. Escribir en la nota del día (se crea si no existe)
  const ruta = CFG.diario + "/" + fecha + ".md";
  let archivo = app.vault.getAbstractFileByPath(ruta);
  if (!archivo) archivo = await crearNotaDia(app, fecha);
  await app.fileManager.processFrontMatter(archivo, (fm) => {
    Object.assign(fm, cambios);
    if (!fm.tipo) fm.tipo = "nota-del-dia";
    if (!fm.fecha) fm.fecha = fecha;
  });
  if (notas) await app.vault.process(archivo, (data) => anadirNota(data, notas));

  // 3. Enviar a la app (lo que cambió, no el día entero)
  const envio = { fecha, habitos: {} };
  if ("entreno" in cambios) envio.entreno = idEntreno(cambios.entreno);
  Object.keys(HABITOS).forEach((h) => {
    const [prop, , , esSiNo] = HABITOS[h];
    if (!(prop in cambios)) return;
    envio.habitos[h] = esSiNo ? (cambios[prop] ? 1 : null) : cambios[prop];
  });
  let estado = "";
  if ("entreno" in envio || Object.keys(envio.habitos).length) estado = await enviarOEncolar(params, "guardarDia", envio);
  aviso(params, "Registrado el " + fecha + (estado ? ": " + estado : ""));
}

// ---------- Acciones de finanzas ----------
function categoriasConocidas(app) {
  const set = new Set(CATEGORIAS);
  Object.values(notasDeMovimientos(app)).forEach((f) => { const c = frontmatterDe(app, f).categoria; if (c) set.add(String(c)); });
  return Array.from(set);
}

function camposMovimiento(app, def) {
  return [
    { id: "fecha", label: "Fecha (AAAA-MM-DD)", type: "text", defaultValue: def.fecha },
    { id: "concepto", label: "Concepto", type: "text", defaultValue: def.concepto },
    { id: "tipo", label: "Tipo", type: "dropdown", options: TIPOS, defaultValue: def.tipo },
    { id: "categoria", label: "Categoría", type: "suggester", options: categoriasConocidas(app), defaultValue: def.categoria, suggesterConfig: { allowCustomInput: true } },
    { id: "cantidad", label: "Cantidad en € (mayor que 0)", type: "text", defaultValue: def.cantidad === "" ? "" : String(def.cantidad).replace(".", ",") },
  ];
}

function leerFormMovimiento(r, id) {
  return {
    id,
    fecha: String(r.fecha || "").trim(),
    concepto: String(r.concepto || "").trim(),
    tipo: r.tipo,
    categoria: String(r.categoria || "").trim() || "otros",
    cantidad: numero(r.cantidad),
  };
}

async function anadirMovimiento(params) {
  const { app, quickAddApi } = params;
  let r;
  try { r = await quickAddApi.requestInputs(camposMovimiento(app, { fecha: hoyTexto(), concepto: "", tipo: "gasto", categoria: "otros", cantidad: "" })); }
  catch (e) { return; }
  const m = leerFormMovimiento(r, nuevoId());
  const error = validarMovimiento(m);
  if (error) { aviso(params, error); return; }
  await escribirNotaMov(app, m, null);
  const estado = await enviarOEncolar(params, "guardarMovimiento", m);
  aviso(params, "Movimiento «" + m.concepto + "» (" + m.cantidad + " €): " + estado);
}

// Elige un movimiento: por el id que llega en el enlace (value-id) o de una lista de los últimos 30.
async function elegirMovimiento(params) {
  const { app, quickAddApi } = params;
  const porId = notasDeMovimientos(app);
  const idDado = params.variables && params.variables.id ? String(params.variables.id) : null;
  if (idDado) {
    if (!porId[idDado]) { aviso(params, "Ese movimiento ya no existe"); return null; }
    return { id: idDado, archivo: porId[idDado] };
  }
  const lista = Object.entries(porId).map(([id, archivo]) => ({ id, archivo, fm: frontmatterDe(app, archivo) }))
    .sort((a, b) => String(b.fm.fecha).localeCompare(String(a.fm.fecha))).slice(0, 30);
  if (!lista.length) { aviso(params, "No hay movimientos todavía"); return null; }
  const etiquetas = lista.map((x) => x.fm.fecha + " · " + x.fm.concepto + " · " + x.fm.cantidad + " €");
  let elegido;
  try { elegido = await quickAddApi.suggester(etiquetas, lista); } catch (e) { return null; }
  return elegido ? { id: elegido.id, archivo: elegido.archivo } : null;
}

async function editarMovimiento(params) {
  const { app, quickAddApi } = params;
  const sel = await elegirMovimiento(params);
  if (!sel) return;
  const fm = frontmatterDe(app, sel.archivo);
  let r;
  try { r = await quickAddApi.requestInputs(camposMovimiento(app, { fecha: String(fm.fecha), concepto: String(fm.concepto || ""), tipo: fm.clase, categoria: fm.categoria || "otros", cantidad: fm.cantidad })); }
  catch (e) { return; }
  const m = leerFormMovimiento(r, sel.id);
  const error = validarMovimiento(m);
  if (error) { aviso(params, error); return; }
  await escribirNotaMov(app, m, sel.archivo);
  const estado = await enviarOEncolar(params, "guardarMovimiento", m);
  aviso(params, "Movimiento «" + m.concepto + "» actualizado: " + estado);
}

async function borrarMovimiento(params) {
  const { app, quickAddApi } = params;
  const sel = await elegirMovimiento(params);
  if (!sel) return;
  const fm = frontmatterDe(app, sel.archivo);
  let confirmado = false;
  try { confirmado = await quickAddApi.yesNoPrompt("Borrar movimiento", "¿Borrar «" + fm.concepto + "» (" + fm.cantidad + " €, " + fm.fecha + ")? Se borra también de Google."); }
  catch (e) { return; }
  if (!confirmado) return;
  await app.fileManager.trashFile(sel.archivo);   // a la papelera de Obsidian: se puede recuperar
  const estado = await enviarOEncolar(params, "borrarMovimiento", { id: sel.id });
  aviso(params, "Movimiento borrado: " + estado);
}

// ---------- Acciones de tareas ----------
// Sin campo de fecha (el panel no la usa): una tarea guardada desde aquí queda sin fecha en la hoja.
function camposTarea(def) {
  const categorias = Array.from(new Set(CAT_TAREAS.concat(def.categoria ? [def.categoria] : [])));
  return [
    { id: "tarea", label: "Tarea", type: "text", defaultValue: def.tarea || "" },
    { id: "categoria", label: "Categoría", type: "dropdown", options: categorias, defaultValue: def.categoria || "personal" },
  ];
}

function leerFormTarea(r, id, hecha) {
  return { id, tarea: String(r.tarea || "").trim(), fecha: String(r.fecha || "").trim(), categoria: String(r.categoria || "").trim() || "personal", hecha: hecha === true };
}

async function anadirTarea(params) {
  const { app, quickAddApi } = params;
  let r;
  try { r = await quickAddApi.requestInputs(camposTarea({ categoria: params.variables && params.variables.categoria ? String(params.variables.categoria) : "personal" })); }
  catch (e) { return; }
  const t = leerFormTarea(r, nuevoId(), false);
  const error = validarTarea(t);
  if (error) { aviso(params, error); return; }
  await escribirNotaTarea(app, t, null);
  const estado = await enviarOEncolar(params, "guardarTarea", t);
  aviso(params, "Tarea «" + t.tarea + "»: " + estado);
}

// Elige una tarea: por el id del enlace (value-id) o de una lista de las 30 primeras pendientes.
async function elegirTarea(params) {
  const { app, quickAddApi } = params;
  const porId = notasDeTareas(app);
  const idDado = params.variables && params.variables.id ? String(params.variables.id) : null;
  if (idDado) {
    if (!porId[idDado]) { aviso(params, "Esa tarea ya no existe"); return null; }
    return { id: idDado, archivo: porId[idDado] };
  }
  const lista = Object.entries(porId).map(([id, archivo]) => ({ id, archivo, t: tareaDeNota(frontmatterDe(app, archivo)) }))
    .sort((a, b) => (a.t.hecha - b.t.hecha) || a.t.tarea.localeCompare(b.t.tarea, "es")).slice(0, 30);
  if (!lista.length) { aviso(params, "No hay tareas todavía"); return null; }
  const etiquetas = lista.map((x) => (x.t.hecha ? "[hecha] " : "") + x.t.tarea + " · " + x.t.categoria);
  let elegido;
  try { elegido = await quickAddApi.suggester(etiquetas, lista); } catch (e) { return null; }
  return elegido ? { id: elegido.id, archivo: elegido.archivo } : null;
}

async function editarTarea(params) {
  const { app, quickAddApi } = params;
  const sel = await elegirTarea(params);
  if (!sel) return;
  const actual = tareaDeNota(frontmatterDe(app, sel.archivo));
  let r;
  try { r = await quickAddApi.requestInputs(camposTarea(actual)); } catch (e) { return; }
  const t = leerFormTarea(r, sel.id, actual.hecha);
  const error = validarTarea(t);
  if (error) { aviso(params, error); return; }
  await escribirNotaTarea(app, t, sel.archivo);
  const estado = await enviarOEncolar(params, "guardarTarea", t);
  aviso(params, "Tarea «" + t.tarea + "» actualizada: " + estado);
}

// Marca una tarea como hecha o la devuelve a pendiente (cambia el estado actual).
async function marcarTarea(params) {
  const { app } = params;
  const sel = await elegirTarea(params);
  if (!sel) return;
  const t = tareaDeNota(frontmatterDe(app, sel.archivo));
  t.hecha = !t.hecha;
  await escribirNotaTarea(app, t, sel.archivo);
  const estado = await enviarOEncolar(params, "guardarTarea", t);
  aviso(params, "«" + t.tarea + "» " + (t.hecha ? "hecha" : "otra vez pendiente") + ": " + estado);
}

async function borrarTarea(params) {
  const { app, quickAddApi } = params;
  const sel = await elegirTarea(params);
  if (!sel) return;
  const t = tareaDeNota(frontmatterDe(app, sel.archivo));
  let confirmado = false;
  try { confirmado = await quickAddApi.yesNoPrompt("Borrar tarea", "¿Borrar «" + t.tarea + "»? Se borra también de Google."); } catch (e) { return; }
  if (!confirmado) return;
  await app.fileManager.trashFile(sel.archivo);   // a la papelera de Obsidian: se puede recuperar
  const estado = await enviarOEncolar(params, "borrarTarea", { id: sel.id });
  aviso(params, "Tarea borrada: " + estado);
}

// ---------- Acciones de exámenes ----------
function camposEvento(def) {
  return [
    { id: "titulo", label: "Asignatura", type: "text", defaultValue: def.titulo || "" },
    { id: "fecha", label: "Fecha (AAAA-MM-DD)", type: "text", defaultValue: def.fecha || hoyTexto() },
    { id: "hora", label: "Hora de inicio (HH:MM; vacío = todo el día)", type: "text", placeholder: "09:00", defaultValue: def.hora || "", optional: true },
    { id: "hora_fin", label: "Hora de fin (opcional)", type: "text", placeholder: "10:30", defaultValue: def.horaFin || "", optional: true },
    { id: "notas", label: "Notas (aula, material…)", type: "textarea", defaultValue: def.notas || "", optional: true },
  ];
}

function leerFormEvento(r, id) {
  const base = String(r.titulo || "").trim();
  // El título lleva "Examen" delante ("Examen Historia"), como los que ya crea la app
  const titulo = !base || norm(base).startsWith("examen") ? base : "Examen " + base;
  const hora = String(r.hora || "").trim();
  return {
    id, titulo, fecha: String(r.fecha || "").trim(), todoElDia: hora === "",
    horaInicio: hora === "" ? null : hora, horaFin: hora === "" ? null : (String(r.hora_fin || "").trim() || null),
    notas: String(r.notas || "").trim(),
  };
}

async function anadirEvento(params) {
  const { app, quickAddApi } = params;
  const conexion = await cargarConexion(params);
  if (!conexion) { aviso(params, "Configura el puente: los exámenes se crean en Google Calendar"); return; }
  let r;
  try { r = await quickAddApi.requestInputs(camposEvento({})); }
  catch (e) { return; }
  const e = leerFormEvento(r, null);
  const error = validarEvento(e);
  if (error) { aviso(params, error); return; }
  // Crear necesita conexión: el id lo da Google Calendar, así que no se puede dejar en la cola
  const datos = { titulo: e.titulo, fecha: e.fecha, todoElDia: e.todoElDia, horaInicio: e.horaInicio, horaFin: e.horaFin, notas: e.notas };
  const res = await llamar(params, conexion, "guardarEvento", datos);
  if (res.sinConexion) { aviso(params, "No se creó: crear un examen necesita conexión"); return; }
  if (res.respuestaRara) { aviso(params, "No se creó: " + textoErrorCola(res)); return; }
  if (!res.ok) {
    aviso(params, "No se creó: " + (res.error === "no autorizado" ? textoErrorCola({ noAutorizado: true }) : res.error === "operación no válida" ? textoErrorCola({ puenteAntiguo: true }) : res.error));
    return;
  }
  e.id = res.id; e.calendario = "examenes";
  await escribirNotaEvento(app, e, null);
  aviso(params, "«" + e.titulo + "» creado el " + e.fecha + " y enviado a Google Calendar");
}

// Elige un examen (del calendario "Exámenes y entregas" de Google): por el id del enlace (value-id) o de una lista.
async function elegirEvento(params) {
  const { app, quickAddApi } = params;
  const porId = notasDeEventos(app);
  const idDado = params.variables && params.variables.id ? String(params.variables.id) : null;
  let sel = null;
  if (idDado) {
    if (!porId[idDado]) { aviso(params, "Ese evento ya no existe"); return null; }
    sel = { id: idDado, archivo: porId[idDado] };
  } else {
    const hoy = hoyTexto();
    const lista = Object.entries(porId).map(([id, archivo]) => ({ id, archivo, e: eventoDeNota(frontmatterDe(app, archivo)) }))
      .filter((x) => x.e.calendario === "examenes" && x.e.fecha >= hoy).sort((a, b) => a.e.fecha.localeCompare(b.e.fecha)).slice(0, 30);
    if (!lista.length) { aviso(params, "No hay exámenes próximos"); return null; }
    let elegido;
    try { elegido = await quickAddApi.suggester(lista.map((x) => x.e.fecha + " · " + x.e.titulo), lista); } catch (err) { return null; }
    if (!elegido) return null;
    sel = { id: elegido.id, archivo: elegido.archivo };
  }
  if (eventoDeNota(frontmatterDe(app, sel.archivo)).calendario !== "examenes") {
    aviso(params, "Los turnos de Trabajo solo se pueden cambiar en Google Calendar"); return null;
  }
  return sel;
}

async function editarEvento(params) {
  const { app, quickAddApi } = params;
  const sel = await elegirEvento(params);
  if (!sel) return;
  const actual = eventoDeNota(frontmatterDe(app, sel.archivo));
  let r;
  try { r = await quickAddApi.requestInputs(camposEvento({ titulo: sinPrefijo(actual.titulo), fecha: actual.fecha, hora: actual.horaInicio, horaFin: actual.horaFin, notas: actual.notas })); }
  catch (e) { return; }
  const e = leerFormEvento(r, sel.id);
  e.calendario = "examenes";
  const error = validarEvento(e);
  if (error) { aviso(params, error); return; }
  await escribirNotaEvento(app, e, sel.archivo);
  const estado = await enviarOEncolar(params, "guardarEvento", { id: e.id, titulo: e.titulo, fecha: e.fecha, todoElDia: e.todoElDia, horaInicio: e.horaInicio, horaFin: e.horaFin, notas: e.notas });
  aviso(params, "«" + e.titulo + "» actualizado: " + estado);
}

async function borrarEvento(params) {
  const { app, quickAddApi } = params;
  const sel = await elegirEvento(params);
  if (!sel) return;
  const e = eventoDeNota(frontmatterDe(app, sel.archivo));
  let confirmado = false;
  try { confirmado = await quickAddApi.yesNoPrompt("Borrar del calendario", "¿Borrar «" + e.titulo + "» (" + e.fecha + ")? Se borra también de Google Calendar."); } catch (err) { return; }
  if (!confirmado) return;
  await app.fileManager.trashFile(sel.archivo);   // a la papelera de Obsidian: se puede recuperar la nota (el evento de Google no)
  const estado = await enviarOEncolar(params, "borrarEvento", { id: sel.id });
  aviso(params, "Evento borrado: " + estado);
}

// ---------- Turnos de trabajo ----------
// Solo se crean (el puente no deja cambiar ni borrar turnos: eso se hace en Google Calendar). Crear necesita
// conexión, porque el id lo da Google; después se escribe su nota como la de cualquier evento de "Trabajo".
async function anadirTurno(params) {
  const { app, quickAddApi } = params;
  const conexion = await cargarConexion(params);
  if (!conexion) { aviso(params, "Configura el puente: los turnos se crean en Google Calendar"); return; }
  // Título propuesto: "titulo_turno" de Panel/Configuracion.md
  const cfg = app.vault.getAbstractFileByPath(RUTA.configuracion);
  const tituloTurno = (cfg && String(frontmatterDe(app, cfg).titulo_turno || "").trim()) || "Turno";
  let r;
  try {
    r = await quickAddApi.requestInputs([
      { id: "fecha", label: "Fecha (AAAA-MM-DD)", type: "text", defaultValue: hoyTexto() },
      { id: "hora", label: "Hora de entrada (HH:MM)", type: "text", placeholder: "16:00" },
      { id: "hora_fin", label: "Hora de salida (HH:MM)", type: "text", placeholder: "20:00" },
      { id: "titulo", label: "Título", type: "text", defaultValue: tituloTurno },
    ]);
  } catch (e) { return; }
  const t = {
    titulo: String(r.titulo || "").trim(), fecha: String(r.fecha || "").trim(),
    horaInicio: String(r.hora || "").trim(), horaFin: String(r.hora_fin || "").trim(),
  };
  if (!t.titulo || t.titulo.length > 80) { aviso(params, "El título es obligatorio (máximo 80 caracteres)"); return; }
  if (!fechaValida(t.fecha)) { aviso(params, "Fecha no válida: escribe AAAA-MM-DD"); return; }
  if (!RE_HORA.test(t.horaInicio)) { aviso(params, "La hora de entrada debe ser HH:MM (por ejemplo 16:00)"); return; }
  if (!RE_HORA.test(t.horaFin) || t.horaFin <= t.horaInicio) { aviso(params, "La hora de salida debe ser HH:MM y posterior a la de entrada"); return; }
  const res = await llamar(params, conexion, "guardarTurno", t);
  if (res.sinConexion) { aviso(params, "No se creó: crear un turno necesita conexión"); return; }
  if (res.respuestaRara) { aviso(params, "No se creó: " + textoErrorCola(res)); return; }
  if (!res.ok) {
    aviso(params, "No se creó: " + (res.error === "no autorizado" ? textoErrorCola({ noAutorizado: true })
      : res.error === "operación no válida" ? "el puente de Google es de una versión antigua: pega el Puente.gs nuevo y crea una versión nueva del despliegue" : res.error));
    return;
  }
  await escribirNotaEvento(app, { id: res.id, titulo: t.titulo, fecha: t.fecha, todoElDia: false, horaInicio: t.horaInicio, horaFin: t.horaFin, calendario: "trabajo", notas: "" }, null);
  aviso(params, "«" + t.titulo + "» el " + t.fecha + " de " + t.horaInicio + " a " + t.horaFin + ": creado en Google Calendar");
}

// ---------- Nota de un examen ya hecho ----------
// La calificación y el apunte se guardan solo en la nota del examen (propiedades calificacion y apunte); no van a
// Google Calendar. La sincronización solo reescribe sus propias propiedades, así que estas dos se conservan.
async function ponerNotaExamen(params) {
  const { app, quickAddApi } = params;
  const porId = notasDeEventos(app);
  const idDado = params.variables && params.variables.id ? String(params.variables.id) : null;
  let archivo = null;
  if (idDado) {
    archivo = porId[idDado] || null;
    if (!archivo) { aviso(params, "Ese examen ya no existe"); return; }
  } else {
    const hoy = hoyTexto();
    const lista = Object.values(porId).map((f) => ({ archivo: f, fm: frontmatterDe(app, f) }))
      .filter((x) => x.fm.categoria === "examen" && String(x.fm.fecha || "").slice(0, 10) < hoy)
      .sort((a, b) => String(b.fm.fecha).localeCompare(String(a.fm.fecha))).slice(0, 30);
    if (!lista.length) { aviso(params, "Todavía no hay exámenes hechos"); return; }
    let elegido;
    try { elegido = await quickAddApi.suggester(lista.map((x) => String(x.fm.fecha).slice(0, 10) + " · " + x.fm.titulo), lista); } catch (err) { return; }
    if (!elegido) return;
    archivo = elegido.archivo;
  }
  const fm = frontmatterDe(app, archivo);
  if (fm.categoria !== "examen") { aviso(params, "Solo se puede poner nota a un examen"); return; }
  let r;
  try {
    r = await quickAddApi.requestInputs([
      { id: "calificacion", label: "Calificación (0 a 10; vacío si aún no la tienes)", type: "text", placeholder: "7,5",
        defaultValue: typeof fm.calificacion === "number" ? String(fm.calificacion).replace(".", ",") : "", optional: true },
      { id: "apunte", label: "Apunte (algo que quieras recordar)", type: "textarea", defaultValue: fm.apunte ? String(fm.apunte) : "", optional: true },
    ]);
  } catch (err) { return; }
  const texto = String(r.calificacion || "").trim().replace(",", ".");
  const nota = texto === "" ? null : Number(texto);
  if (nota !== null && (!/^\d+(\.\d+)?$/.test(texto) || nota > 10)) { aviso(params, "Calificación no válida: escribe un número de 0 a 10 (por ejemplo 7,5)"); return; }
  const apunte = String(r.apunte || "").trim();
  if (apunte.length > 500) { aviso(params, "El apunte es demasiado largo (máximo 500 caracteres)"); return; }
  await app.fileManager.processFrontMatter(archivo, (f) => { f.calificacion = nota; f.apunte = apunte || null; });
  aviso(params, "«" + fm.titulo + "»: " + (nota === null ? "sin calificación" : "nota " + String(nota).replace(".", ",")) + " guardada en Obsidian");
}

// ---------- Acción: Sincronizar ----------
async function sincronizar(params) {
  const { app } = params;
  const conexion = await cargarConexion(params);
  if (!conexion) { aviso(params, "El puente no está configurado: ejecuta «Configurar puente»"); return; }

  // Primera vez: lo que ya hay en las notas se envía a la app (antes de traer nada, para no pisarlo).
  const estado = await leerJson(app, RUTA.estado, null);
  if (!estado) {
    const dias = [];
    app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(CFG.diario + "/") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f.path.slice(CFG.diario.length + 1))).forEach((f) => {
      const fm = frontmatterDe(app, f);
      if (fm.ejemplo === true) return;
      const dia = notaADia(f.path.slice(CFG.diario.length + 1, -3), fm);
      if (dia) dias.push(dia);
    });
    for (const d of dias) await encolar(app, "guardarDia", d);
    const movs = notasDeMovimientos(app);
    for (const f of Object.values(movs)) {
      const m = movDeNota(frontmatterDe(app, f));
      if (!validarMovimiento(m)) await encolar(app, "guardarMovimiento", m);
    }
    for (const f of Object.values(notasDeTareas(app))) {
      const t = tareaDeNota(frontmatterDe(app, f));
      if (!validarTarea(t)) await encolar(app, "guardarTarea", t);
    }
  }

  // 1. Enviar lo pendiente
  const envio = await vaciarCola(params, conexion);
  if (!envio.ok) { aviso(params, "No se sincronizó: " + textoErrorCola(envio)); return; }

  // 2. Traer de la hoja los últimos días y todos los movimientos
  const hoy = hoyTexto();
  const nDias = estado ? CFG.diasSync : CFG.diasPrimera;
  const desde = ymd(sumarDias(parseFecha(hoy), -(nDias - 1)));
  const evDesde = ymd(sumarDias(parseFecha(hoy), -CFG.diasEventosAntes));
  const evHasta = ymd(sumarDias(parseFecha(hoy), CFG.diasEventosDespues));
  const r = await llamar(params, conexion, "leer", { desde, hasta: hoy, eventosDesde: evDesde, eventosHasta: evHasta });
  if (r.sinConexion) { aviso(params, "No se sincronizó: sin conexión"); return; }
  if (!r.ok) { aviso(params, "No se sincronizó: " + (r.error === "no autorizado" ? textoErrorCola({ noAutorizado: true }) : r.respuestaRara ? textoErrorCola(r) : r.error)); return; }

  const resumen = { dias: 0, creados: 0, actualizados: 0, borrados: 0, omitidos: 0 };

  // 3. Salud: "Sheets manda" para esos días
  const porFecha = {};
  (r.dias || []).forEach((d) => { porFecha[d.fecha] = d; });
  for (let i = 0; i < nDias; i++) {
    const fecha = ymd(sumarDias(parseFecha(desde), i));
    const sd = porFecha[fecha];
    let archivo = app.vault.getAbstractFileByPath(CFG.diario + "/" + fecha + ".md");
    if (!archivo && !sd) continue;
    const actual = archivo ? frontmatterDe(app, archivo) : {};
    if (actual.ejemplo === true) continue;   // las notas de ejemplo nunca se tocan
    const deseado = {};
    const nombre = sd && sd.entreno ? nombreEntreno(sd.entreno) : null;
    deseado.entreno = nombre || (idEntreno(actual.entreno) === "descanso" ? actual.entreno : null);
    Object.keys(HABITOS).forEach((h) => {
      const [prop, , , esSiNo] = HABITOS[h];
      const v = sd && typeof sd.habitos[h] === "number" ? sd.habitos[h] : null;
      deseado[prop] = esSiNo ? v === 1 : v;
    });
    const diferente = Object.keys(deseado).some((k) => {
      const a = actual[k] === undefined || actual[k] === "" ? null : actual[k];
      const b = deseado[k] === undefined ? null : deseado[k];
      if (typeof b === "boolean") return (a === true) !== b;
      return a !== b;
    });
    if (!diferente && archivo) continue;
    if (!archivo) { archivo = await crearNotaDia(app, fecha); resumen.creados++; } else resumen.dias++;
    await app.fileManager.processFrontMatter(archivo, (fm) => {
      Object.assign(fm, deseado);
      if (!fm.tipo) fm.tipo = "nota-del-dia";
      if (!fm.fecha) fm.fecha = fecha;
    });
  }

  // 4. Finanzas: una nota por movimiento
  const movs = r.movimientos || [];
  const porId = notasDeMovimientos(app);
  const enSheets = new Set(movs.map((m) => m.id));
  for (const m of movs) {
    const archivo = porId[m.id];
    if (archivo) {
      const fm = frontmatterDe(app, archivo);
      const igual = fm.fecha === m.fecha && String(fm.concepto) === m.concepto && fm.clase === m.tipo &&
        String(fm.categoria) === m.categoria && Number(fm.cantidad) === m.cantidad && archivo.path.startsWith(prefijoNota(CFG.movimientos, m.fecha));
      if (igual) continue;
      await escribirNotaMov(app, m, archivo); resumen.actualizados++;
    } else { await escribirNotaMov(app, m, null); resumen.creados++; }
  }
  // Movimientos que ya no están en la hoja: se llevan a la papelera, con frenos de seguridad.
  const rechazadas = await leerJson(app, RUTA.rechazadas, []);
  const protegidos = new Set(rechazadas.map((x) => x.datos && x.datos.id).filter(Boolean));
  const huerfanos = Object.keys(porId).filter((id) => !enSheets.has(id) && !protegidos.has(id));
  const limite = Math.max(10, Math.floor(Object.keys(porId).length * 0.3));
  if (huerfanos.length && (movs.length === 0 || huerfanos.length > limite)) {
    resumen.omitidos = huerfanos.length;
    aviso(params, "La hoja no tiene " + huerfanos.length + " movimientos que Obsidian sí. No los borro por seguridad: revisa la hoja.");
  } else {
    for (const id of huerfanos) { await app.fileManager.trashFile(porId[id]); resumen.borrados++; }
  }

  // 5. Tareas: una nota por tarea. Si el puente de Google es antiguo (no devuelve tareas), se salta este paso.
  const tr = { nuevas: 0, actualizadas: 0, borradas: 0 };
  let avisoTareas = "";
  if (!Array.isArray(r.tareas)) {
    avisoTareas = " Las tareas no se sincronizaron: el puente de Google es antiguo (pega el Puente.gs nuevo y crea una versión nueva del despliegue).";
  } else {
    const tPorId = notasDeTareas(app);
    const tEnSheets = new Set(r.tareas.map((t) => t.id));
    for (const t of r.tareas) {
      const archivo = tPorId[t.id];
      if (archivo) {
        const act = tareaDeNota(frontmatterDe(app, archivo));
        const igual = act.tarea === t.tarea && act.fecha === t.fecha && act.categoria === t.categoria && act.hecha === t.hecha && archivo.path.startsWith(prefijoNota(CFG.tareas, t.fecha || "sin fecha"));
        if (igual) continue;
        await escribirNotaTarea(app, t, archivo); tr.actualizadas++;
      } else { await escribirNotaTarea(app, t, null); tr.nuevas++; }
    }
    // Tareas que ya no están en la hoja: a la papelera, con los mismos frenos de seguridad.
    const huerfanasT = Object.keys(tPorId).filter((id) => !tEnSheets.has(id) && !protegidos.has(id));
    const limiteT = Math.max(10, Math.floor(Object.keys(tPorId).length * 0.3));
    if (huerfanasT.length && (r.tareas.length === 0 || huerfanasT.length > limiteT)) {
      avisoTareas = " La hoja no tiene " + huerfanasT.length + " tareas que Obsidian sí: no las borro por seguridad, revisa la hoja.";
    } else {
      for (const id of huerfanasT) { await app.fileManager.trashFile(tPorId[id]); tr.borradas++; }
    }
  }

  // 6. Calendario: una nota por evento de "Exámenes y entregas" y de "Trabajo" (Google Calendar manda).
  const ev = { nuevos: 0, actualizados: 0, borrados: 0 };
  let avisoEventos = "";
  if (!Array.isArray(r.eventos)) {
    avisoEventos = " El calendario no se sincronizó: el puente de Google es antiguo (pega el Puente.gs nuevo, acepta el permiso de calendario y crea una versión nueva del despliegue).";
  } else {
    const ePorId = notasDeEventos(app);
    const eEnGoogle = new Set(r.eventos.map((e) => e.id));
    for (const e of r.eventos) {
      const archivo = ePorId[e.id];
      if (archivo) {
        const act = eventoDeNota(frontmatterDe(app, archivo));
        const igual = act.titulo === e.titulo && act.fecha === e.fecha && act.horaInicio === (e.horaInicio || null) && act.horaFin === (e.horaFin || null) &&
          act.todoElDia === (e.todoElDia === true) && act.calendario === e.calendario && act.notas === (e.notas || "") &&
          archivo.path.startsWith(prefijoNota(CFG.calendario, e.fecha));
        if (igual) continue;
        await escribirNotaEvento(app, e, archivo); ev.actualizados++;
      } else { await escribirNotaEvento(app, e, null); ev.nuevos++; }
    }
    // Eventos que ya no están en Google Calendar: solo se miran las notas dentro del rango consultado
    const huerfanosE = Object.keys(ePorId).filter((id) => {
      if (eEnGoogle.has(id) || protegidos.has(id)) return false;
      const f = eventoDeNota(frontmatterDe(app, ePorId[id])).fecha;
      return f >= evDesde && f <= evHasta;
    });
    const limiteE = Math.max(10, Math.floor(Object.keys(ePorId).length * 0.3));
    if (huerfanosE.length && (r.eventos.length === 0 || huerfanosE.length > limiteE)) {
      avisoEventos = " Google Calendar no tiene " + huerfanosE.length + " eventos que Obsidian sí: no los borro por seguridad, revisa el calendario.";
    } else {
      for (const id of huerfanosE) { await app.fileManager.trashFile(ePorId[id]); ev.borrados++; }
    }
  }

  await escribirJson(app, RUTA.estado, { ultima: new Date().toISOString() });
  aviso(params, "Sincronizado: " + envio.enviadas + " enviados, " + resumen.dias + " días ajustados, " +
    resumen.creados + " creados, " + resumen.actualizados + " movimientos actualizados, " + resumen.borrados + " borrados; tareas: " +
    tr.nuevas + " nuevas, " + tr.actualizadas + " actualizadas, " + tr.borradas + " borradas; calendario: " +
    ev.nuevos + " nuevos, " + ev.actualizados + " actualizados, " + ev.borrados + " borrados." + avisoTareas + avisoEventos);
}

// ---------- Acción: Configurar puente ----------
async function configurarPuente(params) {
  const { app, quickAddApi } = params;
  let r;
  try {
    r = await quickAddApi.requestInputs([
      { id: "url", label: "URL del despliegue (termina en /exec)", type: "text", placeholder: "https://script.google.com/macros/s/…/exec" },
      { id: "secreto", label: "Secreto (el que muestra crearSecreto)", type: "text", placeholder: "64 caracteres" },
    ]);
  } catch (e) { return; }
  const url = String(r.url || "").trim();
  const secreto = String(r.secreto || "").trim();
  if (!CFG.urlPermitida.test(url)) { aviso(params, "La URL no es la de un despliegue de Apps Script (https://script.google.com/macros/s/…/exec)"); return; }
  if (!/^[0-9a-f]{64}$/.test(secreto)) { aviso(params, "El secreto debe tener 64 caracteres (números y letras de la a a la f)"); return; }
  await escribirJson(app, RUTA.conexion, { url, secreto });
  const prueba = await llamar(params, { url, secreto }, "ping", {});
  if (prueba.ok) aviso(params, "Conexión correcta. Ya puedes sincronizar.");
  else aviso(params, "Guardado, pero la prueba falló: " + (prueba.sinConexion ? "sin conexión" : prueba.error === "no autorizado" ? "el secreto no coincide o el puente está apagado" : "el puente no respondió como se esperaba (¿URL o despliegue?)"));
}

module.exports = {
  registrarDia, sincronizar, configurarPuente, anadirMovimiento, editarMovimiento, borrarMovimiento,
  anadirTarea, editarTarea, marcarTarea, borrarTarea,
  anadirEvento, editarEvento, borrarEvento, ponerNotaExamen, anadirTurno,
  // para las pruebas
  _interno: { anadirNota, notaADia, idEntreno, validarMovimiento, firmar, encolar, vaciarCola },
};
