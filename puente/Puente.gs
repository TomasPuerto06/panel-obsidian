/**
 * Panel Puente: la puerta entre Obsidian y la hoja "Panel de vida".
 *
 * Es un proyecto de Apps Script APARTE del Panel de vida. La web del Panel de vida sigue en "solo yo";
 * este proyecto solo sabe leer y escribir cuatro pestañas (Gimnasio, Hábitos, Finanzas y Tareas) y dos calendarios
 * elegidos por nombre: "Exámenes y entregas" (se lee y se escribe) y "Trabajo" (se lee y solo se pueden CREAR turnos;
 * nunca se editan ni se borran desde aquí). No ve el calendario
 * personal ni el de clases, ni el correo.
 *
 * Seguridad (solo puede usarlo quien tenga el SECRETO, que solo está en tu Obsidian y aquí):
 *  - Cada petición va firmada con HMAC-SHA256: el secreto nunca viaja por la red.
 *  - La firma incluye la hora y un número de un solo uso: una petición copiada no sirve ni pasados 5
 *    minutos ni una segunda vez.
 *  - Tras 10 intentos fallidos se bloquea todo durante 15 minutos.
 *  - Las respuestas de error no dicen por qué fallan.
 *  - Interruptor de emergencia: la propiedad ACTIVO = no desactiva todo.
 *  - Solo se aceptan entrenos, hábitos y tipos de la lista blanca, con sus rangos.
 *
 * Propiedades del script (Configuración del proyecto > Propiedades del script):
 *   HOJA     = ID de la hoja de cálculo "Panel de vida" (el texto largo de su URL).
 *   SECRETO  = lo crea la función crearSecreto(); no lo escribas a mano.
 *   ACTIVO   = (opcional) "no" para apagar el puente.
 */

const ZONA = 'Europe/Madrid';
const VERSION = 1;
const VENTANA_MS = 5 * 60 * 1000;   // una petición vale 5 minutos
const MAX_FALLOS = 10;              // intentos fallidos antes del bloqueo
const BLOQUEO_S = 15 * 60;          // duración del bloqueo
const MAX_OPS_LOTE = 200;
const MAX_DIAS_LECTURA = 400;

const PESTANAS = { gimnasio: 'Gimnasio', habitos: 'Hábitos', finanzas: 'Finanzas', tareas: 'Tareas' };
// Calendarios de Google a los que llega el puente, por NOMBRE (nunca el personal ni el de clases):
// "examenes" se lee y se escribe; en "trabajo" solo se leen y se crean turnos (guardarTurno), nunca se editan ni borran.
const CALENDARIOS = { examenes: 'Exámenes y entregas', trabajo: 'Trabajo' };
const MAX_EVENTOS = 500;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const ENTRENOS = ['pht', 'eba', 'pierna'];
const TIPOS = ['ingreso', 'gasto', 'ahorro', 'inversion'];
// Hábitos permitidos y su rango. 'cinta' ya existía en la app; el resto son nuevos.
const HABITOS = {
  cinta: [0, 600], agua: [0, 10], sueno: [0, 24], animo: [1, 5],
  pasos: [0, 1], lectura: [0, 1], preparar_dia: [0, 1], proyecto: [0, 1],
};

const NO_AUTORIZADO = { ok: false, error: 'no autorizado' };

/** Error con mensaje que SÍ se puede enseñar (datos mal formados). El resto da "error interno". */
class ErrorPuente extends Error {}

// ---------- Entradas web ----------

function doPost(e) {
  return responder_(procesar_(e && e.postData ? e.postData.contents : ''));
}

/** Sin interfaz: abrir la URL en el navegador no enseña nada. */
function doGet() {
  return responder_(NO_AUTORIZADO);
}

function responder_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Autenticación ----------

function procesar_(cuerpo) {
  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  if (props.getProperty('ACTIVO') === 'no') return NO_AUTORIZADO;
  if (Number(cache.get('fallos') || 0) >= MAX_FALLOS) return NO_AUTORIZADO;

  let p;
  try { p = JSON.parse(cuerpo); } catch (e) { return fallo_(cache); }
  if (!p || typeof p.t !== 'number' || typeof p.n !== 'string' || typeof p.op !== 'string' ||
      typeof p.d !== 'string' || typeof p.s !== 'string' || p.n.length < 16 || p.n.length > 64) return fallo_(cache);

  const secreto = props.getProperty('SECRETO');
  if (!secreto) return fallo_(cache);

  const esperada = firmar_(secreto, [p.t, p.n, p.op, p.d].join('.'));
  if (!iguales_(esperada, p.s)) return fallo_(cache);
  if (Math.abs(Date.now() - p.t) > VENTANA_MS) return fallo_(cache);
  if (cache.get('n_' + p.n)) return fallo_(cache);          // número ya usado: repetición
  cache.put('n_' + p.n, '1', 600);

  // A partir de aquí la petición es auténtica.
  let datos;
  try { datos = JSON.parse(p.d || '{}'); } catch (e) { return { ok: false, error: 'datos no válidos' }; }

  const cerrojo = LockService.getScriptLock();
  cerrojo.waitLock(20000);
  try {
    return operacion_(p.op, datos);
  } catch (err) {
    return { ok: false, error: err instanceof ErrorPuente ? err.message : 'error interno' };
  } finally {
    cerrojo.releaseLock();
  }
}

function fallo_(cache) {
  cache.put('fallos', String(Number(cache.get('fallos') || 0) + 1), BLOQUEO_S);
  return NO_AUTORIZADO;
}

function firmar_(secreto, mensaje) {
  const bytes = Utilities.computeHmacSha256Signature(mensaje, secreto);
  return bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/** Comparación que tarda lo mismo aunque la diferencia esté al principio o al final. */
function iguales_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- Operaciones ----------

function operacion_(op, datos) {
  switch (op) {
    case 'ping': return { ok: true, version: VERSION };
    case 'leer': return Object.assign({ ok: true }, leer_(datos));
    case 'lote': return lote_(datos);
    case 'guardarDia': guardarDia_(datos); return { ok: true };
    case 'guardarMovimiento': return { ok: true, id: guardarMovimiento_(datos) };
    case 'borrarMovimiento': borrarMovimiento_(datos); return { ok: true };
    case 'guardarTarea': return { ok: true, id: guardarTarea_(datos) };
    case 'borrarTarea': borrarTarea_(datos); return { ok: true };
    case 'guardarEvento': return { ok: true, id: guardarEvento_(datos) };
    case 'borrarEvento': borrarEvento_(datos); return { ok: true };
    case 'guardarTurno': return { ok: true, id: guardarTurno_(datos) };
    default: throw new ErrorPuente('operación no válida');
  }
}

/** Varias escrituras en una sola llamada (la cola pendiente de Obsidian). */
function lote_(datos) {
  const ops = datos && datos.ops;
  if (!Array.isArray(ops) || ops.length > MAX_OPS_LOTE) throw new ErrorPuente('lote no válido');
  ops.forEach((o) => {
    if (!o || !OPS_LOTE.includes(o.op)) throw new ErrorPuente('lote no válido');
  });
  // Se valida todo ANTES de escribir nada: si algo está mal, no se escribe nada.
  ops.forEach((o) => validarOperacion_(o.op, o.datos));
  const ids = [];
  const eventos = [];   // ids de los eventos guardados, en el orden del lote
  ops.forEach((o) => {
    if (o.op === 'guardarDia') guardarDia_(o.datos);
    else if (o.op === 'guardarMovimiento') ids.push(guardarMovimiento_(o.datos));
    else if (o.op === 'guardarTarea') ids.push(guardarTarea_(o.datos));
    else if (o.op === 'borrarTarea') borrarTarea_(o.datos);
    else if (o.op === 'guardarEvento') eventos.push(guardarEvento_(o.datos));
    else if (o.op === 'borrarEvento') borrarEvento_(o.datos);
    else borrarMovimiento_(o.datos);
  });
  return { ok: true, hechas: ops.length, ids: ids, eventos: eventos };
}

const OPS_LOTE = ['guardarDia', 'guardarMovimiento', 'borrarMovimiento', 'guardarTarea', 'borrarTarea', 'guardarEvento', 'borrarEvento'];

function validarOperacion_(op, d) {
  if (op === 'guardarDia') normalizarDia_(d);
  else if (op === 'guardarMovimiento') normalizarMovimiento_(d);
  else if (op === 'guardarTarea') normalizarTarea_(d);
  else if (op === 'guardarEvento') normalizarEvento_(d);
  else if (op === 'borrarEvento') validarIdEvento_(d && d.id);
  else validarId_(d && d.id);
}

// ---------- Validación ----------

function fechaValida_(t) {
  if (typeof t !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const f = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)));
  return f.getFullYear() === Number(t.slice(0, 4)) && f.getMonth() === Number(t.slice(5, 7)) - 1 && f.getDate() === Number(t.slice(8, 10));
}

function exigirFecha_(t) {
  if (!fechaValida_(t)) throw new ErrorPuente('fecha no válida');
  return t;
}

function validarId_(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new ErrorPuente('id no válido');
  return id;
}

/** Devuelve el día limpio y validado: { fecha, entreno?, habitos? } o lanza ErrorPuente. */
function normalizarDia_(d) {
  if (!d || typeof d !== 'object') throw new ErrorPuente('día no válido');
  const dia = { fecha: exigirFecha_(d.fecha) };
  if ('entreno' in d) {
    if (d.entreno !== null && d.entreno !== 'descanso' && !ENTRENOS.includes(d.entreno)) throw new ErrorPuente('entreno no válido');
    dia.entreno = d.entreno;
  }
  if (d.habitos !== undefined) {
    if (!d.habitos || typeof d.habitos !== 'object') throw new ErrorPuente('hábitos no válidos');
    dia.habitos = {};
    Object.keys(d.habitos).forEach((nombre) => {
      if (!(nombre in HABITOS)) throw new ErrorPuente('hábito no válido');
      const v = d.habitos[nombre];
      if (v === null) { dia.habitos[nombre] = null; return; }
      const rango = HABITOS[nombre];
      if (typeof v !== 'number' || !isFinite(v) || v < rango[0] || v > rango[1]) throw new ErrorPuente('valor no válido para ' + nombre);
      dia.habitos[nombre] = v;
    });
  }
  return dia;
}

function normalizarMovimiento_(d) {
  if (!d || typeof d !== 'object') throw new ErrorPuente('movimiento no válido');
  const concepto = typeof d.concepto === 'string' ? d.concepto.trim() : '';
  const categoria = typeof d.categoria === 'string' && d.categoria.trim() ? d.categoria.trim() : 'otros';
  if (!concepto || concepto.length > 120) throw new ErrorPuente('concepto no válido');
  if (categoria.length > 40) throw new ErrorPuente('categoría no válida');
  if (!TIPOS.includes(d.tipo)) throw new ErrorPuente('tipo no válido');
  if (typeof d.cantidad !== 'number' || !isFinite(d.cantidad) || !(d.cantidad > 0) || d.cantidad > 1e7) throw new ErrorPuente('cantidad no válida');
  return {
    id: d.id === undefined || d.id === null ? null : validarId_(d.id),
    fecha: exigirFecha_(d.fecha), concepto: concepto, tipo: d.tipo, categoria: categoria,
    cantidad: Math.round(d.cantidad * 100) / 100,
  };
}

/** Tarea limpia y validada: { id|null, tarea, fecha ('' si no tiene), categoria, hecha } o lanza ErrorPuente. */
function normalizarTarea_(d) {
  if (!d || typeof d !== 'object') throw new ErrorPuente('tarea no válida');
  const tarea = typeof d.tarea === 'string' ? d.tarea.trim() : '';
  const categoria = typeof d.categoria === 'string' && d.categoria.trim() ? d.categoria.trim() : 'personal';
  if (!tarea || tarea.length > 200) throw new ErrorPuente('texto de la tarea no válido');
  if (categoria.length > 40) throw new ErrorPuente('categoría no válida');
  if (d.hecha !== undefined && typeof d.hecha !== 'boolean') throw new ErrorPuente('estado de la tarea no válido');
  return {
    id: d.id === undefined || d.id === null ? null : validarId_(d.id),
    tarea: tarea, categoria: categoria, hecha: d.hecha === true,
    fecha: d.fecha === undefined || d.fecha === null || d.fecha === '' ? '' : exigirFecha_(d.fecha),
  };
}

/** Los ids de Google Calendar llevan "@google.com" y a veces guiones bajos. */
function validarIdEvento_(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_@.-]{8,128}$/.test(id)) throw new ErrorPuente('id no válido');
  return id;
}

/** Evento limpio y validado: { id|null, titulo, fecha, todoElDia, horaInicio, horaFin, notas } o lanza ErrorPuente. */
function normalizarEvento_(d) {
  if (!d || typeof d !== 'object') throw new ErrorPuente('evento no válido');
  const titulo = typeof d.titulo === 'string' ? d.titulo.trim() : '';
  const notas = typeof d.notas === 'string' ? d.notas.trim() : '';
  if (!titulo || titulo.length > 120) throw new ErrorPuente('título del evento no válido');
  if (notas.length > 500) throw new ErrorPuente('notas del evento no válidas');
  if (d.todoElDia !== undefined && typeof d.todoElDia !== 'boolean') throw new ErrorPuente('evento no válido');
  const todoElDia = d.todoElDia === true;
  const horaInicio = d.horaInicio === undefined || d.horaInicio === null || d.horaInicio === '' ? null : d.horaInicio;
  const horaFin = d.horaFin === undefined || d.horaFin === null || d.horaFin === '' ? null : d.horaFin;
  if (!todoElDia) {
    if (!RE_HORA.test(horaInicio || '')) throw new ErrorPuente('hora de inicio no válida');
    if (horaFin !== null && (!RE_HORA.test(horaFin) || horaFin <= horaInicio)) throw new ErrorPuente('hora de fin no válida');
  }
  return {
    id: d.id === undefined || d.id === null ? null : validarIdEvento_(d.id),
    titulo: titulo, notas: notas, todoElDia: todoElDia, fecha: exigirFecha_(d.fecha),
    horaInicio: todoElDia ? null : horaInicio, horaFin: todoElDia ? null : horaFin,
  };
}

function normalizarTurno_(d) {
  if (!d || typeof d !== 'object' || (d.id !== undefined && d.id !== null)) throw new ErrorPuente('turno no válido');
  const titulo = typeof d.titulo === 'string' ? d.titulo.trim() : '';
  if (!titulo || titulo.length > 80) throw new ErrorPuente('título del turno no válido');
  const fecha = exigirFecha_(d.fecha);
  if (!RE_HORA.test(d.horaInicio || '')) throw new ErrorPuente('hora de inicio no válida');
  if (!RE_HORA.test(d.horaFin || '') || d.horaFin <= d.horaInicio) throw new ErrorPuente('hora de fin no válida');
  return { titulo: titulo, fecha: fecha, horaInicio: d.horaInicio, horaFin: d.horaFin };
}

// ---------- Hoja ----------

function libro_() {
  const id = PropertiesService.getScriptProperties().getProperty('HOJA');
  if (!id) throw new ErrorPuente('falta configurar la hoja');
  return SpreadsheetApp.openById(id);
}

function pestana_(clave) {
  const hoja = libro_().getSheetByName(PESTANAS[clave]);
  if (!hoja) throw new ErrorPuente('falta la pestaña ' + PESTANAS[clave]);
  return hoja;
}

function aTexto_(fecha) { return Utilities.formatDate(fecha, ZONA, 'yyyy-MM-dd'); }
function aFecha_(texto) { return Utilities.parseDate(texto + ' 00:00', ZONA, 'yyyy-MM-dd HH:mm'); }

/** Número de fila (1 = cabecera) cuya fecha coincide y que cumple el filtro, o null. */
function buscarFila_(hoja, fecha, filtro) {
  const filas = hoja.getDataRange().getValues();
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    if (f[0] instanceof Date && aTexto_(f[0]) === fecha && (!filtro || filtro(f))) return i + 1;
  }
  return null;
}

// ---------- Escritura: salud y rutina ----------

function guardarDia_(datos) {
  const dia = normalizarDia_(datos);
  if ('entreno' in dia) aplicarEntreno_(dia.fecha, dia.entreno);
  if (dia.habitos) Object.keys(dia.habitos).forEach((n) => aplicarHabito_(dia.fecha, n, dia.habitos[n]));
}

function aplicarEntreno_(fecha, entreno) {
  const hoja = pestana_('gimnasio');
  const fila = buscarFila_(hoja, fecha);
  const actual = fila ? hoja.getRange(fila, 1, 1, 4).getValues()[0] : null;
  if (ENTRENOS.includes(entreno)) {
    const notas = actual ? actual[3] : '';
    if (fila) hoja.deleteRow(fila);
    hoja.appendRow([aFecha_(fecha), entreno, 'hecho', notas]);
  } else if (actual && actual[2] === 'hecho') {
    // "descanso" o vacío: se quita un entreno hecho; un "fallado" marcado en la app no se toca.
    hoja.deleteRow(fila);
  }
}

function aplicarHabito_(fecha, nombre, valor) {
  const hoja = pestana_('habitos');
  const fila = buscarFila_(hoja, fecha, (f) => f[1] === nombre);
  if (valor === null) { if (fila) hoja.deleteRow(fila); return; }
  if (fila) hoja.getRange(fila, 3).setValue(valor);
  else hoja.appendRow([aFecha_(fecha), nombre, valor]);
}

// ---------- Escritura: finanzas ----------

const COL_ID = 6;

function filaDeMovimiento_(hoja, id) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return null;
  const ids = hoja.getRange(1, COL_ID, ultima, 1).getValues();
  const i = ids.findIndex((f, n) => n > 0 && String(f[0]) === id);
  return i > 0 ? i + 1 : null;
}

/** Un texto que empieza por = + - @ se interpretaría como fórmula en la hoja: se guarda como texto. */
function textoSeguro_(t) {
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}

function guardarMovimiento_(datos) {
  const m = normalizarMovimiento_(datos);
  const hoja = pestana_('finanzas');
  const id = m.id || Utilities.getUuid();
  const fila = filaDeMovimiento_(hoja, id);
  const valores = [aFecha_(m.fecha), textoSeguro_(m.concepto), m.tipo, textoSeguro_(m.categoria), m.cantidad];
  if (fila) hoja.getRange(fila, 1, 1, 5).setValues([valores]);
  else hoja.appendRow(valores.concat([id]));
  return id;
}

function borrarMovimiento_(datos) {
  const id = validarId_(datos && datos.id);
  const hoja = pestana_('finanzas');
  const fila = filaDeMovimiento_(hoja, id);
  if (fila) hoja.deleteRow(fila);
}

// ---------- Escritura: tareas (pestaña Tareas: ID | Tarea | Fecha | Categoría | Hecha | Creada) ----------

function filaDeTarea_(hoja, id) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return null;
  const ids = hoja.getRange(1, 1, ultima, 1).getValues();
  const i = ids.findIndex((f, n) => n > 0 && String(f[0]) === id);
  return i > 0 ? i + 1 : null;
}

function guardarTarea_(datos) {
  const t = normalizarTarea_(datos);
  const hoja = pestana_('tareas');
  const id = t.id || Utilities.getUuid();
  const fila = filaDeTarea_(hoja, id);
  const fecha = t.fecha ? aFecha_(t.fecha) : '';
  const valores = [textoSeguro_(t.tarea), fecha, textoSeguro_(t.categoria), t.hecha];
  if (fila) hoja.getRange(fila, 2, 1, 4).setValues([valores]);   // la columna "Creada" no se toca
  else hoja.appendRow([id].concat(valores, [new Date()]));
  return id;
}

function borrarTarea_(datos) {
  const id = validarId_(datos && datos.id);
  const hoja = pestana_('tareas');
  const fila = filaDeTarea_(hoja, id);
  if (fila) hoja.deleteRow(fila);
}

// ---------- Calendario (solo "Exámenes y entregas" se escribe; "Trabajo" solo se lee) ----------

function calendario_(clave, obligatorio) {
  const lista = CalendarApp.getCalendarsByName(CALENDARIOS[clave]).filter((c) => c.isOwnedByMe());
  if (!lista.length) {
    if (obligatorio) throw new ErrorPuente('falta el calendario ' + CALENDARIOS[clave]);
    return null;
  }
  return lista[0];
}

function aHoraFecha_(fecha, hora) { return Utilities.parseDate(fecha + ' ' + hora, ZONA, 'yyyy-MM-dd HH:mm'); }

/** Crea o actualiza un evento del calendario de exámenes y entregas. Devuelve su id. */
function guardarEvento_(datos) {
  const e = normalizarEvento_(datos);
  const cal = calendario_('examenes', true);
  let ev = null;
  if (e.id) {
    ev = cal.getEventById(e.id);
    if (!ev) throw new ErrorPuente('evento no encontrado');   // no existe o no es de este calendario
  }
  if (e.todoElDia) {
    if (ev) ev.setAllDayDate(aFecha_(e.fecha));
    else ev = cal.createAllDayEvent(e.titulo, aFecha_(e.fecha), { description: e.notas });
  } else {
    const inicio = aHoraFecha_(e.fecha, e.horaInicio);
    const fin = e.horaFin ? aHoraFecha_(e.fecha, e.horaFin) : new Date(inicio.getTime() + 60 * 60 * 1000);
    if (ev) ev.setTime(inicio, fin);
    else ev = cal.createEvent(e.titulo, inicio, fin, { description: e.notas });
  }
  if (e.id) { ev.setTitle(e.titulo); ev.setDescription(e.notas); }
  return ev.getId();
}

/**
 * Crea un turno en el calendario "Trabajo". Solo CREA: no acepta id, así que no puede
 * cambiar ni borrar turnos que ya existen. Sin descripción. No entra en los lotes: crear necesita conexión porque el
 * id lo da Google, igual que con los exámenes.
 */
function guardarTurno_(datos) {
  const t = normalizarTurno_(datos);
  return calendario_('trabajo', true).createEvent(t.titulo, aHoraFecha_(t.fecha, t.horaInicio), aHoraFecha_(t.fecha, t.horaFin)).getId();
}

function borrarEvento_(datos) {
  const id = validarIdEvento_(datos && datos.id);
  const ev = calendario_('examenes', true).getEventById(id);   // un evento de "Trabajo" no se encuentra aquí
  if (ev) ev.deleteEvent();
}

/** Eventos de los dos calendarios entre dos fechas (ambas incluidas), ordenados. */
function leerEventos_(desde, hasta) {
  const ini = aFecha_(desde);
  const fin = aFecha_(hasta);
  fin.setTime(fin.getTime() + 36 * 60 * 60 * 1000);          // hasta el día siguiente...
  const limite = aFecha_(aTexto_(fin));                       // ...a las 00:00 de Madrid
  const salida = [];
  Object.keys(CALENDARIOS).forEach((clave) => {
    const cal = calendario_(clave, clave === 'examenes');
    if (!cal) return;
    cal.getEvents(ini, limite).forEach((ev) => {
      const todoElDia = ev.isAllDayEvent();
      const inicio = todoElDia ? ev.getAllDayStartDate() : ev.getStartTime();
      salida.push({
        id: ev.getId(), calendario: clave, titulo: String(ev.getTitle()), todoElDia: todoElDia,
        fecha: aTexto_(inicio),
        horaInicio: todoElDia ? null : Utilities.formatDate(ev.getStartTime(), ZONA, 'HH:mm'),
        horaFin: todoElDia ? null : Utilities.formatDate(ev.getEndTime(), ZONA, 'HH:mm'),
        notas: clave === 'examenes' ? String(ev.getDescription() || '').slice(0, 300) : '',   // de "Trabajo" no sale ni el texto
      });
    });
  });
  if (salida.length > MAX_EVENTOS) throw new ErrorPuente('demasiados eventos: pide un rango menor');
  return salida.sort((a, b) => (a.fecha + (a.horaInicio || '')).localeCompare(b.fecha + (b.horaInicio || '')));
}

// ---------- Lectura ----------

/**
 * datos = { desde, hasta?, movDesde? }
 * Devuelve los días con datos entre desde y hasta (entreno y hábitos) y los movimientos de finanzas
 * (todos, o los posteriores a movDesde).
 */
function leer_(datos) {
  const desde = exigirFecha_(datos && datos.desde);
  const hasta = datos && datos.hasta ? exigirFecha_(datos.hasta) : aTexto_(new Date());
  const movDesde = datos && datos.movDesde ? exigirFecha_(datos.movDesde) : null;
  if (hasta < desde || (aFecha_(hasta) - aFecha_(desde)) / 86400000 > MAX_DIAS_LECTURA) throw new ErrorPuente('rango no válido');

  const dias = {};
  const dia = (f) => (dias[f] = dias[f] || { fecha: f, entreno: null, habitos: {} });

  pestana_('gimnasio').getDataRange().getValues().slice(1).forEach((f) => {
    if (!(f[0] instanceof Date)) return;
    const t = aTexto_(f[0]);
    if (t >= desde && t <= hasta && f[2] === 'hecho' && ENTRENOS.includes(f[1])) dia(t).entreno = f[1];
  });
  pestana_('habitos').getDataRange().getValues().slice(1).forEach((f) => {
    if (!(f[0] instanceof Date) || !(f[1] in HABITOS)) return;
    const t = aTexto_(f[0]);
    if (t >= desde && t <= hasta && f[2] !== '' && isFinite(Number(f[2]))) dia(t).habitos[f[1]] = Number(f[2]);
  });

  // Movimientos: a las filas sin ID (escritas a mano en la hoja) se les da uno, como hace la app.
  const hoja = pestana_('finanzas');
  const movimientos = [];
  hoja.getDataRange().getValues().forEach((f, i) => {
    if (i === 0 || !(f[0] instanceof Date)) return;
    let id = f[COL_ID - 1];
    if (!id) { id = Utilities.getUuid(); hoja.getRange(i + 1, COL_ID).setValue(id); }
    const t = aTexto_(f[0]);
    if (movDesde && t < movDesde) return;
    movimientos.push({ id: String(id), fecha: t, concepto: String(f[1]), tipo: f[2], categoria: f[3] || 'otros', cantidad: Number(f[4]) || 0 });
  });
  movimientos.sort((a, b) => a.fecha.localeCompare(b.fecha));

  // Tareas (las filas sin ID no se listan, igual que en la app)
  const tareas = pestana_('tareas').getDataRange().getValues().slice(1).filter((f) => f[0]).map((f) => ({
    id: String(f[0]), tarea: String(f[1]), fecha: f[2] instanceof Date ? aTexto_(f[2]) : '',
    categoria: f[3] ? String(f[3]) : 'personal', hecha: f[4] === true,
  }));

  const resultado = { dias: Object.keys(dias).sort().map((k) => dias[k]), movimientos: movimientos, tareas: tareas };

  // Eventos de calendario: solo si se piden (eventosDesde y eventosHasta)
  if (datos && (datos.eventosDesde || datos.eventosHasta)) {
    const ed = exigirFecha_(datos.eventosDesde), eh = exigirFecha_(datos.eventosHasta);
    if (eh < ed || (aFecha_(eh) - aFecha_(ed)) / 86400000 > MAX_DIAS_LECTURA) throw new ErrorPuente('rango no válido');
    resultado.eventos = leerEventos_(ed, eh);
  }
  return resultado;
}

// ---------- Para ejecutar a mano desde el editor ----------

/**
 * Crea (o cambia) el SECRETO y lo enseña UNA vez en el registro de ejecución.
 * Cópialo en Obsidian ("Configurar puente"). Si lo cambias, hay que cambiarlo también en Obsidian.
 */
function crearSecreto() {
  const secreto = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('SECRETO', secreto);
  Logger.log('SECRETO nuevo (cópialo ahora en Obsidian; no lo compartas):\n' + secreto);
}

// Cabeceras de cada pestaña: las columnas que leen y escriben las funciones de arriba
const CABECERAS = {
  gimnasio: ['Fecha', 'Entreno', 'Estado', 'Notas'],
  habitos: ['Fecha', 'Hábito', 'Valor'],
  finanzas: ['Fecha', 'Concepto', 'Tipo', 'Categoría', 'Cantidad', 'ID'],
  tareas: ['ID', 'Tarea', 'Fecha', 'Categoría', 'Hecha', 'Creada'],
};

/**
 * Para empezar de cero: si la propiedad HOJA está vacía, crea una hoja nueva "Panel de vida" y guarda su ID;
 * después crea las pestañas (con sus cabeceras) y los calendarios que falten. No cambia ni borra nada que ya exista.
 */
function prepararTodo() {
  const props = PropertiesService.getScriptProperties();
  let libro;
  let nuevo = false;
  if (props.getProperty('HOJA')) libro = libro_();
  else {
    libro = SpreadsheetApp.create('Panel de vida');
    props.setProperty('HOJA', libro.getId());
    nuevo = true;
    Logger.log('Hoja nueva creada: ' + libro.getUrl());
  }
  Object.keys(PESTANAS).forEach((clave) => {
    if (libro.getSheetByName(PESTANAS[clave])) return;
    const hoja = libro.insertSheet(PESTANAS[clave]);
    hoja.appendRow(CABECERAS[clave]);
    hoja.setFrozenRows(1);
    Logger.log('Pestaña creada: ' + PESTANAS[clave]);
  });
  // Una hoja nueva trae una pestaña vacía ("Hoja 1"): se quita
  if (nuevo) {
    libro.getSheets().filter((h) => !Object.values(PESTANAS).includes(h.getName()) && h.getLastRow() === 0)
      .forEach((h) => libro.deleteSheet(h));
  }
  Object.keys(CALENDARIOS).forEach((clave) => {
    if (calendario_(clave, false)) return;
    CalendarApp.createCalendar(CALENDARIOS[clave]);
    Logger.log('Calendario creado: ' + CALENDARIOS[clave]);
  });
  Logger.log('Listo. Ahora ejecuta crearSecreto (si aún no lo has hecho) y después comprobar.');
}

/** Comprueba que el puente llega a la hoja y enseña cuántas filas hay en cada pestaña. */
function comprobar() {
  Object.keys(PESTANAS).forEach((clave) => {
    Logger.log(PESTANAS[clave] + ': ' + Math.max(0, pestana_(clave).getLastRow() - 1) + ' filas');
  });
  Object.keys(CALENDARIOS).forEach((clave) => {
    Logger.log('Calendario "' + CALENDARIOS[clave] + '": ' +
      (calendario_(clave, false) ? 'encontrado (' + (clave === 'examenes' ? 'se lee y se escribe' : 'se lee y se crean turnos') + ')' : 'NO ENCONTRADO (el nombre debe ser exacto)'));
  });
  Logger.log('SECRETO configurado: ' + (PropertiesService.getScriptProperties().getProperty('SECRETO') ? 'sí' : 'NO (ejecuta crearSecreto)'));
}

/** Apaga el puente (ACTIVO = no). Para volver a encenderlo, borra la propiedad ACTIVO o ponla en "si". */
function apagar() {
  PropertiesService.getScriptProperties().setProperty('ACTIVO', 'no');
  Logger.log('Puente apagado.');
}
