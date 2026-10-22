// Panel en Obsidian: tarjetas de salud y rutina.
// Dataview JS. Se llama desde una nota con:
//   await dv.view("Panel/Scripts/salud", { modo: "inicio" })   // página de Inicio
//   await dv.view("Panel/Scripts/salud", { modo: "salud" })    // página de Salud
// Lee las notas del día de Panel/Diario (una por día, nombre AAAA-MM-DD) y pinta el HTML con las
// clases p-* de .obsidian/snippets/panel.css.
//
// Propiedades de cada nota del día:
//   animo (1 a 5), sueno_horas, entreno (nombre completo del entreno o Descanso), pasos, lectura,
//   preparar_dia, proyecto (sí/no), agua_litros, cinta_min (minutos andados).

const modo = (input && input.modo) || "inicio";
const CARPETA = (input && input.carpeta) || "Panel/Diario";

// Objetivos: se leen de Panel/Configuracion.md; si falta la nota o un valor, se usan estos por defecto.
// agua: litros a partir de los que el hábito cuenta como cumplido.
const CONFIG = (typeof dv.page === "function" && dv.page("Panel/Configuracion")) || {};
const cfgNum = (k, def) => (typeof CONFIG[k] === "number" && isFinite(CONFIG[k]) && CONFIG[k] > 0 ? CONFIG[k] : def);
const OBJ = { gym: cfgNum("objetivo_gimnasio", 5), gymMin: cfgNum("minimo_gimnasio", 4), sueno: cfgNum("objetivo_sueno", 7), agua: cfgNum("objetivo_agua", 3) };
const ENTRENOS = { pht: "Pecho · Hombro · Tríceps", eba: "Espalda · Bíceps · Abs", pierna: "Pierna" };

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const LETRAS = ["D", "L", "M", "X", "J", "V", "S"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// ---------- Fechas (siempre como texto AAAA-MM-DD para evitar líos de zona horaria) ----------
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const base = input && input.hoy ? parse(input.hoy) : new Date();
const hoy = new Date(base.getFullYear(), base.getMonth(), base.getDate());
const hoyS = ymd(hoy);
const ultimos = (n) => Array.from({ length: n }, (_, i) => ymd(addDays(hoy, i - (n - 1))));

// ---------- Utilidades de texto ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const coma = (n, dec = 1) => n.toFixed(dec).replace(".", ",").replace(/,0+$/, "");
const fmtH = (h) => {
  const min = Math.round(h * 60);
  const hh = Math.floor(min / 60), mm = min % 60;
  if (hh === 0) return mm + " min";
  return mm === 0 ? hh + " h" : hh + " h " + mm + " min";
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Lectura de las notas ----------
const notas = {};
for (const p of Array.from(dv.pages('"' + CARPETA + '"'))) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.file.name)) notas[p.file.name] = p;
}
const dato = (s, k) => (notas[s] ? notas[s][k] : null);
const numero = (s, k) => { const v = dato(s, k); return typeof v === "number" && isFinite(v) ? v : null; };
const hecho = (s, k) => dato(s, k) === true;
// El entreno se guarda con su nombre completo ("Pecho · Hombro · Tríceps", "Espalda · Bíceps · Abs",
// "Pierna" o "Descanso"). También se entienden los códigos antiguos (pht, eba, pierna, descanso).
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const CLAVES = { pht: "pht", pechohombrotriceps: "pht", eba: "eba", espaldabicepsabs: "eba", pierna: "pierna", descanso: "descanso" };
const entreno = (s) => {
  const v = dato(s, "entreno");
  if (v === false) return "descanso";
  if (typeof v !== "string") return "";
  return CLAVES[norm(v)] || "";
};
const esEntreno = (s) => Object.prototype.hasOwnProperty.call(ENTRENOS, entreno(s));
const media = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

// ---------- Piezas de HTML ----------
const SIN_DATOS = "Sin datos todavía";

const kpi = (etiqueta, objetivo, valor, pct, claseBarra, nota) =>
  `<div class="p-card"><div class="p-head"><span class="p-label p-muted">${etiqueta}</span><span class="p-small p-muted">${objetivo}</span></div>` +
  `<div class="p-value">${valor}</div><div class="p-bar ${claseBarra}"><span style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%"></span></div>` +
  `<span class="p-small p-muted">${nota}</span></div>`;

const vacio = (titulo, texto, ancho) =>
  `<section class="p-card${ancho ? " p-card--wide" : ""}"><h3>${titulo}</h3><div class="p-empty">${texto}</div></section>`;

// Gráfica de barras. vals: un número o null por cada fecha de "dias".
function barras({ dias, vals, max, objetivo, clase, titulo, etiquetas }) {
  const alto = 200;
  const cols = vals.map((v, i) => {
    if (v === null || v === undefined) {
      return `<div class="p-bars-col"><div class="p-bar-v p-bar-v--none" title="${esc(dias[i])}: sin dato"></div></div>`;
    }
    const px = Math.max(3, Math.round(Math.min(v, max) / max * alto));
    const c = typeof clase === "function" ? clase(v) : clase;
    return `<div class="p-bars-col"><div class="p-bar-v ${c}" style="height:${px}px" title="${esc(titulo(v, dias[i]))}"></div></div>`;
  }).join("");
  const linea = objetivo ? `<div class="p-target" style="bottom:${Math.round(objetivo / max * alto)}px"></div>` : "";
  const labels = (etiquetas || dias.map((d) => LETRAS[parse(d).getDay()])).map((l) => `<span>${esc(l)}</span>`).join("");
  return `<div class="p-bars">${linea}${cols}</div><div class="p-bars-labels">${labels}</div>`;
}

const hayDatos = (vals) => vals.some((v) => v !== null);

// ---------- Cálculos ----------
const dias14 = ultimos(14);
const dias7 = ultimos(7);

// Gimnasio de la semana (lunes a domingo)
const lunes = addDays(hoy, -((hoy.getDay() + 6) % 7));
const semana = Array.from({ length: 7 }, (_, i) => ymd(addDays(lunes, i)));
const gymSemana = semana.filter(esEntreno).length;
const gymRegistrado = semana.some((s) => entreno(s) !== "");

// Sueño y ánimo de los últimos 7 días
const sueno7 = dias7.map((s) => numero(s, "sueno_horas")).filter((v) => v !== null);
const animo7 = dias7.map((s) => ({ s, v: numero(s, "animo") })).filter((x) => x.v !== null);

// ---------- Tarjetas de salud ----------
function tarjetasKpi() {
  // Gimnasio
  let gymValor = "—", gymPct = 0, gymNota = SIN_DATOS;
  if (gymRegistrado) {
    gymValor = gymSemana + " de " + OBJ.gym;
    gymPct = gymSemana / OBJ.gym * 100;
    gymNota = gymSemana >= OBJ.gym ? "Objetivo de la semana cumplido"
      : gymSemana >= OBJ.gymMin ? "Mínimo cumplido; una sesión más para llegar a " + OBJ.gym
      : "Te faltan " + (OBJ.gymMin - gymSemana) + " para el mínimo de " + OBJ.gymMin;
  }
  // Sueño
  let sValor = "—", sPct = 0, sNota = SIN_DATOS;
  const sMedia = media(sueno7);
  if (sMedia !== null) {
    sValor = fmtH(sMedia);
    sPct = sMedia / OBJ.sueno * 100;
    const dif = Math.abs(sMedia - OBJ.sueno);
    sNota = dif < 1 / 60 ? "En el objetivo" : fmtH(dif) + (sMedia < OBJ.sueno ? " por debajo del objetivo" : " por encima del objetivo");
  }
  // Ánimo
  let aValor = "—", aPct = 0, aNota = SIN_DATOS;
  const aMedia = media(animo7.map((x) => x.v));
  if (aMedia !== null) {
    aValor = coma(aMedia) + " / 5";
    aPct = aMedia / 5 * 100;
    const max = Math.max(...animo7.map((x) => x.v));
    const mejor = animo7.filter((x) => x.v === max).pop();
    aNota = "Mejor día: " + DIAS[parse(mejor.s).getDay()];
  }
  return `<div class="p-kpis">` +
    kpi("Gimnasio esta semana", "Objetivo " + OBJ.gym + " (mínimo " + OBJ.gymMin + ")", gymValor, gymPct, "p-bar--green", gymNota) +
    kpi("Sueño medio", "Objetivo " + fmtH(OBJ.sueno), sValor, sPct, "", sNota) +
    kpi("Ánimo medio", "Últimos 7 días", aValor, aPct, "p-bar--purple", aNota) +
    `</div>`;
}

function tarjetaSueno() {
  const vals = dias14.map((s) => numero(s, "sueno_horas"));
  const cuerpo = hayDatos(vals)
    ? barras({
        dias: dias14, vals, max: 9, objetivo: OBJ.sueno,
        clase: (v) => (v >= OBJ.sueno ? "p-bar-v--ok" : "p-bar-v--low"),
        titulo: (v, d) => d + ": " + fmtH(v),
      })
    : `<div class="p-chart p-empty">La gráfica aparecerá cuando haya registros de sueño</div>`;
  return `<section class="p-card p-card--wide"><div class="p-head"><h3>Horas de sueño · últimos 14 días</h3><span class="p-small p-muted">Objetivo: ${fmtH(OBJ.sueno)}</span></div>${cuerpo}</section>`;
}

function tarjetaCinta() {
  const vals = dias14.map((s) => numero(s, "cinta_min"));
  const dias = vals.filter((v) => v !== null && v > 0).length;
  const total = vals.reduce((a, v) => a + (v || 0), 0);
  const max = Math.max(60, ...vals.map((v) => v || 0));
  const cuerpo = hayDatos(vals)
    ? barras({
        dias: dias14, vals: vals.map((v) => (v === 0 ? null : v)), max,
        clase: "p-bar-v--green",
        titulo: (v, d) => d + ": " + v + " min",
      })
    : `<div class="p-chart p-empty">La gráfica aparecerá cuando registres minutos de cinta</div>`;
  const resumen = hayDatos(vals) ? dias + " de 14 días · " + total + " min en total" : SIN_DATOS;
  return `<section class="p-card p-card--wide"><div class="p-head"><h3>Días que andas · últimos 14 días</h3><span class="p-small p-muted">${resumen}</span></div>${cuerpo}</section>`;
}

function tarjetaGimnasio() {
  // Sesiones por semana, últimas 8 semanas (lunes a domingo)
  const semanas = Array.from({ length: 8 }, (_, i) => addDays(lunes, (i - 7) * 7));
  const conteos = semanas.map((l) => {
    const dias = Array.from({ length: 7 }, (_, j) => ymd(addDays(l, j)));
    return dias.some((s) => entreno(s) !== "") ? dias.filter(esEntreno).length : null;
  });
  const etiquetas = semanas.map((l) => l.getDate() + "/" + (l.getMonth() + 1));
  const cuerpo = hayDatos(conteos)
    ? barras({
        dias: semanas.map(ymd), vals: conteos, max: 6, objetivo: OBJ.gym, clase: "p-bar-v--green",
        titulo: (v, d) => "Semana del " + d + ": " + v + " sesiones", etiquetas,
      })
    : `<div class="p-chart p-empty">La gráfica aparecerá cuando registres entrenos</div>`;
  return `<section class="p-card"><div class="p-head"><h3>Gimnasio · sesiones por semana</h3><span class="p-small p-muted">Objetivo ${OBJ.gym}</span></div>${cuerpo}</section>`;
}

function tarjetaAnimo() {
  const vals = dias14.map((s) => numero(s, "animo"));
  const cuerpo = hayDatos(vals)
    ? barras({ dias: dias14, vals, max: 5, clase: "p-bar-v--purple", titulo: (v, d) => d + ": " + v + " de 5" })
    : `<div class="p-chart p-empty">La gráfica aparecerá cuando registres el ánimo</div>`;
  return `<section class="p-card"><div class="p-head"><h3>Ánimo · últimos 14 días</h3><span class="p-small p-muted">Escala de 1 a 5</span></div>${cuerpo}</section>`;
}

// ---------- Hábitos: cuántos se cumplieron cada día (gráfica) y la checklist del día elegido ----------
// Cada hábito es cumplido o no. El día sin nota no tiene punto (no es lo mismo que 0) y la línea lo salta.
const HABITOS = [
  { nombre: "Agua", ok: (s) => (numero(s, "agua_litros") || 0) >= OBJ.agua, detalle: (s) => coma(numero(s, "agua_litros") || 0) + " de " + coma(OBJ.agua) + " L" },
  { nombre: "Pasos", ok: (s) => hecho(s, "pasos") },
  { nombre: "Lectura", ok: (s) => hecho(s, "lectura") },
  { nombre: "Preparar el día siguiente", ok: (s) => hecho(s, "preparar_dia") },
  { nombre: "Tiempo de proyecto", ok: (s) => hecho(s, "proyecto") },
  { nombre: "Cinta", ok: (s) => (numero(s, "cinta_min") || 0) > 0, detalle: (s) => (numero(s, "cinta_min") || 0) + " min" },
];
const cumplidos = (s) => (notas[s] ? HABITOS.filter((h) => h.ok(s)).length : null);
const fechaLarga = (s) => { const d = parse(s); return (s === hoyS ? "Hoy, " : cap(DIAS[d.getDay()]) + " ") + d.getDate() + " de " + MESES[d.getMonth()]; };

// Área de 0 a 6 hábitos. La línea y el área son un SVG estirado al ancho; los puntos y las zonas para
// pasar el ratón o pulsar son botones HTML (uno por día), así no se deforman.
function graficaHabitos(dias, vals) {
  const N = HABITOS.length, n = dias.length;
  const x = (i) => ((i + 0.5) / n * 100).toFixed(2);
  const y = (v) => ((1 - v / N) * 100).toFixed(2);
  const p = vals.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean);
  const camino = "M" + p.map((q) => q[0] + " " + q[1]).join(" L");
  const svg = p.length > 1
    ? `<path class="p-hg-area" d="${camino} L${p[p.length - 1][0]} 100 L${p[0][0]} 100 Z"/><path class="p-hg-linea" d="${camino}"/>` : "";
  const rejilla = [0, N / 2, N].map((v) => `<line class="p-hg-rejilla" x1="0" x2="100" y1="${y(v)}" y2="${y(v)}"/>`).join("");
  const cols = dias.map((s, i) => {
    const v = vals[i];
    const txt = fechaLarga(s) + ": " + (v === null ? "sin registro" : v === N ? "todos los hábitos" : v + " de " + N);
    const punto = v === null ? "" : `<span class="p-hg-punto${v === N ? " p-hg-punto--todos" : ""}" style="top:${y(v)}%"></span>`;
    return `<button type="button" class="p-hg-col${s === hoyS ? " p-hg-col--sel" : ""}${i >= n - 3 ? " p-hg-col--der" : ""}" data-hab-dia="${s}" ` +
      `aria-pressed="${s === hoyS}" aria-label="${esc(txt)}" data-tip="${esc(txt)}" style="left:${(i / n * 100).toFixed(2)}%;width:${(100 / n).toFixed(2)}%">${punto}</button>`;
  }).join("");
  const ejeY = [N, N / 2, 0].map((v) => `<span style="top:${y(v)}%">${v}</span>`).join("");
  const letras = dias.map((d) => `<span>${LETRAS[parse(d).getDay()]}</span>`).join("");
  return `<div class="p-hg"><div class="p-hg-ejey">${ejeY}</div><div class="p-hg-plot">` +
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${rejilla}${svg}</svg>${cols}</div></div>` +
    `<div class="p-bars-labels p-hg-letras">${letras}</div>`;
}

function listaHabitos(s, visible) {
  const v = cumplidos(s);
  const cab = `<div class="p-head"><span class="p-label"><b>${esc(fechaLarga(s))}</b></span>` +
    (v === null ? "" : `<span class="p-small p-muted">${v} de ${HABITOS.length}</span>`) + `</div>`;
  const cuerpo = v === null
    ? `<div class="p-empty">${s === hoyS ? "Aún no hay nota de hoy" : "Sin registro ese día"}</div>`
    : HABITOS.map((h) => {
        const on = h.ok(s);
        return `<div class="p-hlista-fila"><span class="p-hcheck${on ? " p-hcheck--on" : ""}" role="img" aria-label="${on ? "Cumplido" : "Sin cumplir"}"></span>` +
          `<span class="p-label">${esc(h.nombre)}</span>${h.detalle ? `<span class="p-small p-muted">${esc(h.detalle(s))}</span>` : ""}</div>`;
      }).join("");
  return `<div class="p-hlista" data-hab-lista="${s}"${visible ? "" : " hidden"}>${cab}${cuerpo}</div>`;
}

function tarjetaHabitosGrafica() {
  const vals = dias14.map(cumplidos);
  const todos = vals.filter((v) => v === HABITOS.length).length;
  const grafica = hayDatos(vals) ? graficaHabitos(dias14, vals) : `<div class="p-chart p-empty">La gráfica aparecerá cuando registres hábitos</div>`;
  return `<section class="p-card p-card--wide"><div class="p-head"><h3>Hábitos · últimos 14 días</h3>` +
    `<span class="p-small p-muted">${hayDatos(vals) ? todos + (todos === 1 ? " día" : " días") + " con todos cumplidos" : SIN_DATOS}</span></div>` +
    `<div class="p-hab"><div class="p-hab-graf">${grafica}` +
    `<div class="p-legend"><span><i class="p-hg-leyenda"></i>Hábitos cumplidos</span><span><i class="p-hg-leyenda p-hg-leyenda--todos"></i>Todos</span><span>Pulsa un día para ver su lista</span></div></div>` +
    `<div class="p-hab-lista">${dias14.map((s) => listaHabitos(s, s === hoyS)).join("")}</div></div></section>`;
}

// Al pulsar un día de la gráfica, se marca y se enseña su checklist.
function activarHabitos(raiz) {
  if (!raiz || typeof raiz.querySelectorAll !== "function") return;
  const cols = Array.from(raiz.querySelectorAll("[data-hab-dia]"));
  cols.forEach((b) => b.addEventListener("click", () => {
    const s = b.getAttribute("data-hab-dia");
    cols.forEach((c) => { c.classList.toggle("p-hg-col--sel", c === b); c.setAttribute("aria-pressed", String(c === b)); });
    raiz.querySelectorAll("[data-hab-lista]").forEach((l) => { l.hidden = l.getAttribute("data-hab-lista") !== s; });
  }));
}

async function tarjetaNota() {
  const fecha = cap(DIAS[hoy.getDay()]) + " " + hoy.getDate() + " de " + MESES[hoy.getMonth()];
  if (!notas[hoyS]) {
    return `<section class="p-card p-card--note"><div class="p-head"><h3>Nota del día</h3><span class="p-small">${fecha}</span></div>` +
      `<div class="p-empty">La nota de hoy se crea al abrir Obsidian (notas diarias)</div></section>`;
  }
  const p = notas[hoyS];
  const animo = numero(hoyS, "animo");
  const sueno = numero(hoyS, "sueno_horas");
  const e = entreno(hoyS);
  const entrenoTxt = ENTRENOS[e] || (e === "descanso" ? "No fui" : "—");
  let extracto = "";
  try {
    const texto = await dv.io.load(p.file.path);
    const m = texto && texto.match(/##\s+Notas[^\n]*\n([\s\S]*?)(?=\n##\s|$)/);
    extracto = m ? m[1].trim() : "";
  } catch (err) { extracto = ""; }
  if (extracto.length > 300) extracto = extracto.slice(0, 300).trim() + "…";
  const lista =
    `<div class="p-note-list"><span>Ánimo: ${animo === null ? "—" : animo + " / 5"}</span>` +
    `<span>Sueño: ${sueno === null ? "—" : fmtH(sueno)}</span><span>Entreno: ${esc(entrenoTxt)}</span></div>`;
  const notasHtml = extracto ? `<div class="p-note-text">${esc(extracto).replace(/\n/g, "<br>")}</div>` : "";
  const enlace = `<a class="internal-link" data-href="${esc(p.file.path)}" href="${esc(p.file.path)}">Abrir la nota de hoy</a>`;
  return `<section class="p-card p-card--note"><div class="p-head"><h3>Nota del día</h3><span class="p-small">${fecha}</span></div>${lista}${notasHtml}<span class="p-small">${enlace}</span></section>`;
}

// Resumen de finanzas del mes actual, con los movimientos de Panel/Finanzas/Movimientos
// (los cálculos están en Panel/Scripts/finanzas/calculos.js, que comparte la página de Finanzas).
const calc = await (async () => {
  const a = typeof app !== "undefined" ? app : dv.app;
  const codigo = await a.vault.adapter.read("Panel/Scripts/finanzas/calculos.js");
  const m = { exports: {} };
  new Function("module", "exports", codigo)(m, m.exports);
  return m.exports;
})();
// Tarjeta "Proyectos" de Inicio (Panel/Scripts/proyectos/calculos.js, la misma que usa la página de Proyectos).
const calcProy = await (async () => {
  const a = typeof app !== "undefined" ? app : dv.app;
  const codigo = await a.vault.adapter.read("Panel/Scripts/proyectos/calculos.js");
  const m = { exports: {} };
  new Function("module", "exports", codigo)(m, m.exports);
  return m.exports;
})();
const proyectosHtml = await (async () => {
  const ps = calcProy.leerProyectos(dv, (input && input.carpetaProyectos) || "Proyectos");
  await calcProy.cargarPlanes(ps, (ruta) => dv.io.load(ruta));
  return calcProy.tarjetaInicio(ps);
})();

// Calendario de Inicio (Panel/Scripts/calendario/calculos.js, el mismo de Estudios): próximos exámenes, calendario del
// mes con los días de color (los de gimnasio salen de las notas del día).
const calendarioPaq = await (async () => {
  const a = typeof app !== "undefined" ? app : dv.app;
  const codigo = await a.vault.adapter.read("Panel/Scripts/calendario/calculos.js");
  const m = { exports: {} };
  new Function("module", "exports", codigo)(m, m.exports);
  const c = m.exports;
  const nombre = (() => { try { return a.vault.getName(); } catch (e) { return "Boveda"; } })();
  const eventos = c.leerEventos(dv, (input && input.carpetaCalendario) || "Panel/Calendario");
  const gym = new Set(Object.keys(notas).filter(esEntreno));
  return {
    c, eventos, gym,
    examenes: c.tarjetaExamenes(eventos, hoyS, nombre, {}),
    calendario: c.tarjetaCalendario(eventos, gym, hoyS),
    turnos: c.tarjetaTurnos(eventos, hoyS, nombre),   // turnos de la semana, debajo del calendario
  };
})();

// Tarjeta "Tareas" de Inicio (Panel/Scripts/tareas/calculos.js, la misma de Estudios y Proyectos). Sin entregas: el panel no las usa.
const tareasHtml = await (async () => {
  const a = typeof app !== "undefined" ? app : dv.app;
  const codigo = await a.vault.adapter.read("Panel/Scripts/tareas/calculos.js");
  const m = { exports: {} };
  new Function("module", "exports", codigo)(m, m.exports);
  const nombre = (() => { try { return a.vault.getName(); } catch (e) { return "Boveda"; } })();
  const tareas = m.exports.leerTareas(dv, (input && input.carpetaTareas) || "Panel/Tareas");
  return m.exports.tarjetaTareas(tareas, ymd(hoy), nombre, { titulo: "Tareas", ancho: true, vacio: "Sin tareas todavía" });
})();

const finanzasResumen = () => {
  const mes = hoy.getFullYear() + "-" + pad(hoy.getMonth() + 1);
  const r = calc.resumen(calc.leerMovimientos(dv, (input && input.carpetaFinanzas) || "Panel/Finanzas/Movimientos"), mes);
  return `<section class="p-block"><h2>Finanzas · ${calc.nombreMes(mes)}</h2><div class="p-row-cards">` +
    `<div style="flex: 1 1 360px; min-width: 0">${calc.kpisHtml(r, "p-kpis--2")}</div>${calc.anilloHtml(r)}</div></section>`;
};

// ---------- Montaje de cada página ----------
// Botones "Sincronizar" y "Registrar día": abren acciones de QuickAdd (ver panel_lib.js)
let nombreBoveda = "Boveda";
try { nombreBoveda = app.vault.getName(); } catch (err) { /* se queda con el nombre por defecto */ }
const enlaceQA = (accion) => `obsidian://quickadd?vault=${encodeURIComponent(nombreBoveda)}&choice=${encodeURIComponent(accion)}`;
const accion = `<div class="p-actions"><a class="p-btn p-btn--sec" href="${enlaceQA("Sincronizar")}">Sincronizar</a>` +
  `<a class="p-btn" href="${enlaceQA("Registrar dia")}">Registrar día</a></div>`;

const nota = await tarjetaNota();
let html;
if (modo === "salud") {
  // Disposición: arriba, dos columnas que no se estiran entre sí: a la izquierda (3/4) los tres
  // datos y debajo los hábitos; a la derecha (1/4) la nota del día y el ánimo. Los botones van encima, a la derecha. Abajo, a todo el
  // ancho y en tres columnas: sueño, cinta y gimnasio por semana.
  html = `<div class="p-salud">` + accion + `<div class="p-salud-arriba">` +
    `<div class="p-salud-main">` + tarjetasKpi() + tarjetaHabitosGrafica() + `</div>` +
    `<div class="p-salud-aside">` + nota + tarjetaAnimo() + `</div></div>` +
    `<div class="p-salud-fila3">` + tarjetaSueno() + tarjetaCinta() + tarjetaGimnasio() + `</div>` +
    `</div>`;
} else {
  html = accion + `<div class="p-layout"><div class="p-main">` +
    `<section class="p-block"><h2>Salud y rutina</h2>` + tarjetasKpi() + `</section>` +
    tarjetaHabitosGrafica() +
    tarjetaSueno() +
    `<div class="p-row-cards">` + tareasHtml + calendarioPaq.examenes + `</div>` +
    finanzasResumen() +
    `</div><div class="p-aside">` + nota + calendarioPaq.calendario + calendarioPaq.turnos + proyectosHtml + `</div></div>`;
}

// Sin ninguna nota del día todavía (primera vez): aviso que lleva a las páginas de ejemplo
const RUTA_EJEMPLO = "Panel/Ejemplo/Ejemplo - " + (modo === "salud" ? "Salud" : "Inicio") + ".md";
const avisoVacio = Object.keys(notas).length ? "" :
  `<div class="p-aviso">Todavía no hay datos. Mira cómo queda con datos de ejemplo en ` +
  `<a class="internal-link" data-href="${esc(RUTA_EJEMPLO)}" href="${esc(RUTA_EJEMPLO)}">${esc(RUTA_EJEMPLO.split("/").pop().replace(/\.md$/, ""))}</a>` +
  `, o pulsa <b>Registrar día</b> para empezar.</div>`;
dv.container.innerHTML = avisoVacio + html;
activarHabitos(dv.container);   // pulsar un día de la gráfica de hábitos
if (modo !== "salud") calendarioPaq.c.activarCalendario(dv.container, calendarioPaq.eventos, calendarioPaq.gym, hoyS);   // botones de mes
