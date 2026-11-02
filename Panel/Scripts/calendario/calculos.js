// Panel en Obsidian: calendario. Cálculos y HTML de las tarjetas de exámenes y del calendario del mes
// (compartidos por Inicio y Estudios). Lo cargan los view.js de Dataview con new Function. Las
// funciones reciben datos ya leídos y devuelven HTML, para poder reutilizarlas cuando la app del Panel de vida
// adopte el mismo diseño.
//
// Cada evento es una nota de Panel/Calendario (ver panel_lib.js): tipo: evento, id, titulo, fecha, inicio, fin,
// todo_el_dia, categoria (examen, trabajo o agenda), calendario y notas. El panel no usa entregas.

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Dataview entrega las fechas como objetos; aquí siempre se usa texto: AAAA-MM-DD y HH:MM.
function fechaTexto(v) {
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
  if (v && typeof v.toISODate === "function") return v.toISODate() || "";
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + "-" + pad(v.getMonth() + 1) + "-" + pad(v.getDate());
  return "";
}
function horaTexto(v) {
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(11, 16) : null;
  if (v && typeof v.toFormat === "function") return v.toFormat("HH:mm");
  if (v instanceof Date && !isNaN(v)) return pad(v.getHours()) + ":" + pad(v.getMinutes());
  return null;
}

function leerEventos(dv, carpeta) {
  const out = [];
  for (const p of Array.from(dv.pages('"' + carpeta + '"'))) {
    const fecha = fechaTexto(p.fecha);
    if (p.tipo !== "evento" || !p.id || !fecha || !p.titulo) continue;
    out.push({
      id: String(p.id), titulo: String(p.titulo), fecha, horaInicio: horaTexto(p.inicio), horaFin: horaTexto(p.fin),
      todoElDia: p.todo_el_dia === true, categoria: p.categoria === "trabajo" || p.categoria === "agenda" ? p.categoria : "examen",
      calendario: p.calendario ? String(p.calendario) : "examenes", notas: p.notas ? String(p.notas) : "",
      calificacion: typeof p.calificacion === "number" && isFinite(p.calificacion) ? p.calificacion : null,
      apunte: p.apunte ? String(p.apunte) : "",
    });
  }
  return out.sort((a, b) => (a.fecha + (a.horaInicio || "")).localeCompare(b.fecha + (b.horaInicio || "")));
}

// Días en los que se entrenó (nota del día con un entreno de la lista), para pintarlos en verde en el calendario.
function diasGimnasio(dv, carpetaDiario) {
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  const validos = new Set(["pht", "eba", "pierna", "pechohombrotriceps", "espaldabicepsabs"]);
  const dias = new Set();
  for (const p of Array.from(dv.pages('"' + carpetaDiario + '"'))) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.file.name) && typeof p.entreno === "string" && validos.has(norm(p.entreno))) dias.add(p.file.name);
  }
  return dias;
}

function uriQuickAdd(vault, accion, vars) {
  return "obsidian://quickadd?vault=" + encodeURIComponent(vault) + "&choice=" + encodeURIComponent(accion) +
    Object.entries(vars || {}).map(([k, v]) => "&value-" + encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("");
}

const quitarPrefijo = (t) => t.replace(/^examen\s*(de\s+|:|-)?\s*/i, "") || t;
const aFecha = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const diasHasta = (fecha, hoy) => Math.round((aFecha(fecha) - aFecha(hoy)) / 86400000);
const cuando = (n) => (n === 0 ? "hoy" : n === 1 ? "mañana" : "en " + n + " días");
const mesMas = (clave, n) => { const d = new Date(Number(clave.slice(0, 4)), Number(clave.slice(5, 7)) - 1 + n, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); };
const etiquetaMes = (clave) => cap(MESES[Number(clave.slice(5, 7)) - 1]) + " " + clave.slice(0, 4);

// Los 7 días (de lunes a domingo, en texto) de la semana de una fecha.
function diasSemana(fecha) {
  const d = aFecha(fecha);
  const lunes = d.getDate() - ((d.getDay() + 6) % 7);
  return Array.from({ length: 7 }, (_, n) => { const x = new Date(d.getFullYear(), d.getMonth(), lunes + n); return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()); });
}
const etiquetaSemana = (desde, hasta) => `Semana del ${Number(desde.slice(8))} ${MESES_CORTO[Number(desde.slice(5, 7)) - 1]} al ${Number(hasta.slice(8))} ${MESES_CORTO[Number(hasta.slice(5, 7)) - 1]}`;

const proximos = (eventos, hoy, categoria, n) => eventos.filter((e) => e.categoria === categoria && e.fecha >= hoy).slice(0, n);

function horario(e) {
  if (e.todoElDia || !e.horaInicio) return "todo el día";
  return e.horaInicio + (e.horaFin ? " a " + e.horaFin : "");
}

function filaExamen(e, hoy, vault, editable) {
  const [, mm, dd] = e.fecha.split("-");
  const n = diasHasta(e.fecha, hoy);
  const dia = cap(DIAS[aFecha(e.fecha).getDay()]);
  return `<div class="p-examen"><span class="p-fechacaja"><b>${Number(dd)}</b><small>${MESES_CORTO[Number(mm) - 1]}</small></span>` +
    `<div class="p-examen-cuerpo"><span class="p-label"><b>${esc(quitarPrefijo(e.titulo))}</b></span>` +
    `<span class="p-small p-muted">${dia} · ${horario(e)} · ${cuando(n)}</span>` +
    (e.notas ? `<span class="p-small p-muted">${esc(e.notas)}</span>` : "") + `</div>` +
    (editable ? `<span class="p-tarea-acciones"><a class="p-link" href="${uriQuickAdd(vault, "Editar examen", { id: e.id })}">Editar</a>` +
      `<a class="p-link p-link--borrar" href="${uriQuickAdd(vault, "Borrar examen", { id: e.id })}">Borrar</a></span>` : "") + `</div>`;
}

// opts: { max, h ("h2" o "h3") }
function tarjetaExamenes(eventos, hoy, vault, opts) {
  const o = Object.assign({ max: 6, h: "h3" }, opts || {});
  const lista = proximos(eventos, hoy, "examen", 999);
  const mostrados = lista.slice(0, o.max);
  return `<section class="p-card"><div class="p-head"><${o.h}>Próximos exámenes</${o.h}><span class="p-head-der">` +
    (lista.length ? `<span class="p-small p-muted">${lista.length} ${lista.length === 1 ? "examen" : "exámenes"}</span>` : "") +
    `<a class="p-link p-link--mas" href="${uriQuickAdd(vault, "Anadir examen")}">Añadir examen</a></span></div>` +
    (mostrados.length ? mostrados.map((e) => filaExamen(e, hoy, vault, e.calendario === "examenes")).join("") : `<div class="p-empty">Sin exámenes próximos</div>`) +
    (lista.length > o.max ? `<span class="p-small p-muted">y ${lista.length - o.max} más</span>` : "") + `</section>`;
}

// Exámenes ya pasados, del más reciente al más antiguo, con la calificación y el apunte que se ponen desde
// Obsidian (acción "Poner nota de examen"; solo se guardan en la nota del examen). opts: { h }
function tarjetaExamenesHechos(eventos, hoy, vault, opts) {
  const o = Object.assign({ h: "h3" }, opts || {});
  const lista = eventos.filter((e) => e.categoria === "examen" && e.fecha < hoy).reverse();
  const conNota = lista.filter((e) => e.calificacion !== null);
  const media = conNota.length ? conNota.reduce((a, e) => a + e.calificacion, 0) / conNota.length : null;
  const num = (n) => String(Math.round(n * 100) / 100).replace(".", ",");
  const filas = lista.map((e) => {
    const [, mm, dd] = e.fecha.split("-");
    return `<div class="p-examen"><span class="p-fechacaja"><b>${Number(dd)}</b><small>${MESES_CORTO[Number(mm) - 1]}</small></span>` +
      `<div class="p-examen-cuerpo"><span class="p-label"><b>${esc(quitarPrefijo(e.titulo))}</b></span>` +
      (e.apunte ? `<span class="p-small p-muted">${esc(e.apunte)}</span>` : "") + `</div>` +
      (e.calificacion !== null ? `<span class="p-nota">${num(e.calificacion)}</span>` : `<span class="p-small p-muted">Sin nota todavía</span>`) +
      `<span class="p-tarea-acciones"><a class="p-link" href="${uriQuickAdd(vault, "Poner nota de examen", { id: e.id })}">${e.calificacion !== null || e.apunte ? "Editar" : "Poner nota"}</a></span></div>`;
  }).join("");
  return `<section class="p-card"><div class="p-head"><${o.h}>Exámenes hechos</${o.h}>` +
    (media !== null ? `<span class="p-small p-muted">Media ${num(media)} · ${conNota.length} de ${lista.length} con nota</span>` : "") + `</div>` +
    (filas || `<div class="p-empty">Aquí saldrán los exámenes cuando pase su fecha</div>`) + `</section>`;
}

// Turnos de trabajo de la semana de hoy (lunes a domingo), con el botón para añadir uno (acción "Anadir turno").
function tarjetaTurnos(eventos, hoy, vault) {
  const semana = diasSemana(hoy);
  const desde = semana[0], hasta = semana[6];
  const lista = eventos.filter((e) => e.categoria === "trabajo" && e.fecha >= desde && e.fecha <= hasta);
  const minutos = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const total = lista.reduce((a, e) => a + (e.horaInicio && e.horaFin ? minutos(e.horaFin) - minutos(e.horaInicio) : 0), 0);
  const horas = total % 60 ? Math.floor(total / 60) + " h " + (total % 60) + " min" : total / 60 + " h";
  const filas = lista.map((e) => {
    const [, mm, dd] = e.fecha.split("-");
    return `<div class="p-examen${e.fecha < hoy ? " p-examen--pasado" : ""}"><span class="p-fechacaja"><b>${Number(dd)}</b><small>${MESES_CORTO[Number(mm) - 1]}</small></span>` +
      `<div class="p-examen-cuerpo"><span class="p-label"><b>${esc(e.titulo)}</b></span>` +
      `<span class="p-small p-muted">${cap(DIAS[aFecha(e.fecha).getDay()])} · ${horario(e)}</span></div></div>`;
  }).join("");
  return `<section class="p-card"><div class="p-head"><h3>Turnos de trabajo</h3><span class="p-head-der">` +
    (lista.length ? `<span class="p-small p-muted">${lista.length} ${lista.length === 1 ? "turno" : "turnos"} · ${horas}</span>` : "") +
    `<a class="p-link p-link--mas" href="${uriQuickAdd(vault, "Anadir turno")}">Añadir turno</a></span></div>` +
    `<span class="p-small p-muted">${etiquetaSemana(desde, hasta)}</span>` +
    (filas || `<div class="p-empty">Sin turnos esta semana</div>`) + `</section>`;
}

// ---------- Calendario del mes ----------
// Cada día enseña todo lo que tiene, por orden: examen, trabajo, agenda y gimnasio. El detalle va en el title.
// Dos estilos con la misma rejilla: "barras" (compacto: una raya de color por cosa, en Inicio) y "etiquetas"
// (cada cosa con su hora de inicio, en Estudios).
const PRIORIDAD = ["examen", "trabajo", "agenda", "gym"];
const TEXTO_TIPO = { examen: "Examen", trabajo: "Trabajo", agenda: "Agenda", gym: "Gimnasio" };
const MAX_MARCAS = 3;   // si un día tiene más, la última plaza dice cuántas quedan

const DOT_TIPO = { examen: "red", trabajo: "amber", agenda: "purple", gym: "green" };

function marcasCalendario(eventos, diasGym) {
  const marcas = {};
  const poner = (fecha, marca) => { (marcas[fecha] = marcas[fecha] || []).push(marca); };
  eventos.forEach((e) => poner(e.fecha, { tipo: e.categoria, texto: quitarPrefijo(e.titulo), hora: horario(e), inicio: e.todoElDia ? null : e.horaInicio, id: e.id, calendario: e.calendario }));
  Array.from(diasGym || []).forEach((f) => poner(f, { tipo: "gym", texto: "Gimnasio", hora: "", inicio: null }));
  return marcas;
}

const ordenarDia = (delDia) => delDia.slice().sort((a, b) => PRIORIDAD.indexOf(a.tipo) - PRIORIDAD.indexOf(b.tipo));

function marcasDia(delDia, estilo, conTitulo) {
  const visibles = delDia.length > MAX_MARCAS ? delDia.slice(0, MAX_MARCAS - 1) : delDia;
  const resto = delDia.length - visibles.length;
  const etiqueta = (x) => (x.tipo === "gym" ? (conTitulo ? "Gimnasio" : "Gym") : esc(x.inicio || "Todo") + (conTitulo ? ` <span class="p-marca-titulo">${esc(x.texto)}</span>` : ""));
  const filas = visibles.map((x) => (estilo === "etiquetas"
    ? `<span class="p-marca p-marca--${x.tipo}">${etiqueta(x)}</span>`
    : `<i class="p-marca p-marca--${x.tipo}"></i>`)).join("") +
    (resto ? (estilo === "etiquetas" ? `<span class="p-marca p-marca--mas">+${resto}</span>` : `<i class="p-marca p-marca--mas"></i>`) : "");
  return filas ? `<span class="p-dia-marcas">${filas}</span>` : "";
}

const filaEvento = (x) => `<div class="p-cal-ev"><i class="p-dot p-dot--${DOT_TIPO[x.tipo]}"></i>` +
  `<span class="p-label">${x.tipo === "gym" ? "Gimnasio" : TEXTO_TIPO[x.tipo] + ": " + esc(x.texto)}</span>` +
  (x.hora ? `<span class="p-small p-muted">${esc(x.hora)}</span>` : "") + `</div>`;

// Lo que hay un día, debajo del calendario (se cambia al pasar el ratón o al pulsar un día).
function detalleDia(fecha, marcas, hoy) {
  const d = aFecha(fecha);
  const titulo = (fecha === hoy ? "Hoy, " : cap(DIAS[d.getDay()]) + " ") + d.getDate() + " de " + MESES[d.getMonth()];
  const filas = ordenarDia(marcas[fecha] || []).map(filaEvento).join("");
  return `<span class="p-label"><b>${titulo}</b></span>` + (filas || `<span class="p-small p-muted">Nada este día</span>`);
}

// Clases de un día: un bloque plegado con el horario, aparte de los eventos. Solo se leen: no llevan acciones.
function bloqueClases(delDia) {
  if (!delDia || !delDia.length) return "";
  const fin = delDia.map((c) => c.horaFin).sort().pop();
  const filas = delDia.map((c) => `<div class="p-cal-ev"><span class="p-label">${esc(c.titulo)}</span><span class="p-small p-muted">${esc(c.horaInicio)} a ${esc(c.horaFin)}</span></div>`).join("");
  return `<details class="p-sem-clases"><summary><span class="p-label">Clases</span>` +
    `<span class="p-small p-muted">${esc(delDia[0].horaInicio)} a ${esc(fin)} · ${delDia.length}</span></summary>${filas}</details>`;
}

// Los 7 días de la semana de una fecha con lo que hay en cada uno (página Calendario). Hoy va marcado y el día
// pulsado se distingue del resto y, si llega vault, enseña sus acciones: editar y borrar cada evento (el gimnasio
// sale de la nota del día y no se toca aquí) y añadir un examen, un turno o un evento con esa fecha ya puesta
// (value-dia). "Editar examen" y "Borrar examen" sirven para todos: miran de qué calendario es el evento.
// clases: las de cada día ({ fecha: [...] }); solo salen en esta lista, nunca en el mes.
function detalleSemana(fecha, marcas, hoy, sel, vault, clases) {
  const enlace = (accion, vars, texto, clase) => `<a class="p-link${clase ? " " + clase : ""}" href="${uriQuickAdd(vault, accion, vars)}">${texto}</a>`;
  const accionesEvento = (x) => (x.id
    ? `<span class="p-sem-acciones">${enlace("Editar examen", { id: x.id }, "Editar")}${enlace("Borrar examen", { id: x.id }, "Borrar", "p-link--borrar")}</span>` : "");
  const dias = diasSemana(fecha);
  const filas = dias.map((f) => {
    const d = aFecha(f);
    const conAcciones = Boolean(vault) && f === sel;
    const delDia = ordenarDia(marcas[f] || []).map((x) => filaEvento(x) + (conAcciones ? accionesEvento(x) : "")).join("");
    const deClase = bloqueClases(clases && clases[f]);
    const eventos = delDia || deClase ? delDia + deClase : `<span class="p-small p-muted">Nada</span>`;
    const anadir = conAcciones ? `<span class="p-sem-acciones">${enlace("Anadir examen", { dia: f }, "Añadir examen", "p-link--mas")}${enlace("Anadir turno", { dia: f }, "Añadir turno", "p-link--mas")}${enlace("Anadir agenda", { dia: f }, "Añadir evento", "p-link--mas")}</span>` : "";
    return `<div class="p-sem-dia${f === hoy ? " p-sem-dia--hoy" : ""}${f === sel ? " p-sem-dia--sel" : ""}"><span class="p-fechacaja"><b>${d.getDate()}</b><small>${DIAS[d.getDay()].slice(0, 3)}</small></span>` +
      `<div class="p-sem-eventos">${f === hoy ? `<span class="p-small p-sem-hoy">Hoy</span>` : ""}${eventos}${anadir}</div></div>`;
  }).join("");
  return `<span class="p-label"><b>${etiquetaSemana(dias[0], dias[6])}</b></span>${filas}`;
}

// opts: { estilo ("barras" o "etiquetas"), tipos (los que salen en la leyenda), conTitulo (etiquetas con hora y título) }
function cuerpoCalendario(mes, marcas, hoy, sel, opts) {
  const o = Object.assign({ estilo: "barras", tipos: PRIORIDAD }, opts || {});
  const anio = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7)) - 1;
  const huecos = (new Date(anio, m, 1).getDay() + 6) % 7;   // la semana empieza el lunes
  const total = new Date(anio, m + 1, 0).getDate();
  const celdas = Array.from({ length: huecos }, () => `<span class="p-dia p-dia--vacio"></span>`);
  for (let d = 1; d <= total; d++) {
    const fecha = mes + "-" + pad(d);
    const delDia = ordenarDia(marcas[fecha] || []);
    const detalle = delDia.map((x) => TEXTO_TIPO[x.tipo] + (x.tipo === "gym" ? "" : ": " + x.texto)).join(" · ");
    celdas.push(`<span class="p-dia${fecha === hoy ? " p-dia--hoy" : ""}${fecha === (sel || hoy) ? " p-dia--sel" : ""}" ` +
      `data-dia="${fecha}" tabindex="0" role="button"${detalle ? ` title="${esc(detalle)}"` : ""}><span class="p-dia-num">${d}</span>${marcasDia(delDia, o.estilo, o.conTitulo)}</span>`);
  }
  return `<div class="p-head"><button type="button" class="p-mes-btn" data-cal-mes="prev" aria-label="Mes anterior">‹</button>` +
    `<span class="p-label"><b>${etiquetaMes(mes)}</b></span>${o.semana ? `<button type="button" class="p-mes-btn p-mes-btn--hoy" data-cal-mes="hoy">Hoy</button>` : ""}` +
    `<button type="button" class="p-mes-btn" data-cal-mes="next" aria-label="Mes siguiente">›</button></div>` +
    `<div class="p-weekdays"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>` +
    `<div class="p-cal-grid p-cal-grid--${o.estilo}">${celdas.join("")}</div>` +
    `<div class="p-legend">${o.tipos.map((t) => `<span><i class="p-dot p-dot--${DOT_TIPO[t]}"></i>${TEXTO_TIPO[t]}</span>`).join("")}</div>`;
}

// opts: los de cuerpoCalendario, más mes (AAAA-MM; por defecto, el de hoy)
function tarjetaCalendario(eventos, diasGym, hoy, opts) {
  const marcas = marcasCalendario(eventos, diasGym);
  return `<section class="p-card p-card--cal"><h3>Calendario</h3><div data-calendario>${cuerpoCalendario((opts && opts.mes) || hoy.slice(0, 7), marcas, hoy, null, opts)}</div>` +
    `<div class="p-cal-detalle" data-cal-detalle>${detalleDia(hoy, marcas, hoy)}</div></section>`;
}

// Página Calendario: el mes grande a la izquierda y la semana del día elegido a la derecha. Usa las mismas piezas
// que la tarjeta, así que activarCalendario sirve igual (con opts.semana).
function paginaCalendario(eventos, diasGym, hoy, opts) {
  const marcas = marcasCalendario(eventos, diasGym);
  return `<div class="p-calendario"><section class="p-card p-cal-mes"><div data-calendario>${cuerpoCalendario(hoy.slice(0, 7), marcas, hoy, null, opts)}</div></section>` +
    `<section class="p-card p-cal-lado"><div class="p-cal-detalle" data-cal-detalle>${detalleSemana(hoy, marcas, hoy, hoy, opts && opts.vault, opts && opts.clases)}</div></section></div>`;
}

// Hace que los botones ‹ y › cambien de mes (solo se vuelve a pintar el calendario) y que, al pasar el ratón por un
// día o pulsarlo, se vea debajo lo que hay ese día. Al quitar el ratón vuelve el día pulsado (al principio, hoy).
// Con opts.semana se enseña la semana del día pulsado y el ratón no cambia nada: moverla al pasar por encima marea.
// Además, el mes y el día elegidos se recuerdan en window: al guardar un evento Dataview repinta la página y, sin
// esto, volvería a hoy. Se pierden al cerrar Obsidian; el botón Hoy vuelve a la fecha actual.
function activarCalendario(raiz, eventos, diasGym, hoy, opts) {
  const caja = raiz && raiz.querySelector ? raiz.querySelector("[data-calendario]") : null;
  if (!caja) return;
  const marcas = marcasCalendario(eventos, diasGym);
  const detalle = raiz.querySelector("[data-cal-detalle]");
  const conSemana = Boolean(opts && opts.semana);
  const recuerdo = conSemana && typeof window !== "undefined" ? (window.panelCalendario = window.panelCalendario || {}) : {};
  let mesActual = recuerdo.mes || hoy.slice(0, 7), sel = recuerdo.sel || hoy;
  const mostrar =(fecha) => { if (detalle) detalle.innerHTML = conSemana ? detalleSemana(fecha, marcas, hoy, sel, opts.vault, opts.clases) : detalleDia(fecha, marcas, hoy); };
  const pintar = (mes) => {
    mesActual = recuerdo.mes = mes;
    caja.innerHTML = cuerpoCalendario(mes, marcas, hoy, sel, opts);
    caja.querySelectorAll("[data-cal-mes]").forEach((b) => b.addEventListener("click", () => {
      const dir = b.getAttribute("data-cal-mes");
      if (dir !== "hoy") { pintar(mesMas(mes, dir === "prev" ? -1 : 1)); return; }
      sel = recuerdo.sel = hoy; pintar(hoy.slice(0, 7)); mostrar(sel);
    }));
  };
  const diaDe = (ev) => (ev.target && ev.target.closest ? ev.target.closest("[data-dia]") : null);
  const elegir = (celda) => { sel = recuerdo.sel = celda.getAttribute("data-dia"); pintar(mesActual); mostrar(sel); };
  if (typeof caja.addEventListener === "function") {
    if (!conSemana) {
      caja.addEventListener("mouseover", (ev) => { const c = diaDe(ev); if (c) mostrar(c.getAttribute("data-dia")); });
      caja.addEventListener("mouseleave", () => mostrar(sel));
    }
    caja.addEventListener("click", (ev) => { const c = diaDe(ev); if (c) elegir(c); });
    caja.addEventListener("keydown", (ev) => { const c = diaDe(ev); if (c && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); elegir(c); } });
  }
  pintar(mesActual);
  if (conSemana) mostrar(sel);
}

module.exports = {
  leerEventos, diasGimnasio, uriQuickAdd, quitarPrefijo, proximos, tarjetaExamenes, tarjetaExamenesHechos, tarjetaTurnos,
  marcasCalendario, detalleDia, detalleSemana, diasSemana, cuerpoCalendario, tarjetaCalendario, paginaCalendario, activarCalendario, mesMas, diasHasta,
};
