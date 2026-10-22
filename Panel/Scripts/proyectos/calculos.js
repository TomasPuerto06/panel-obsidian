// Panel en Obsidian: proyectos. Cálculos y piezas de HTML (compartidos por la página de Proyectos y la
// tarjeta de Inicio). Lo cargan los view.js de Dataview con new Function (ver proyectos/view.js).
// Separado a propósito de la lectura de Dataview: las funciones de HTML reciben datos ya leídos, así que se
// podrán reutilizar cuando la app del Panel de vida adopte el mismo diseño.
//
// Cada proyecto es una nota de Proyectos/ con estas propiedades:
//   tipo: proyecto
//   estado: texto libre con el estado
//   situacion: en-marcha | pendiente | idea | terminado
//   siguiente_paso: (opcional) qué toca hacer ahora (si hay plan, es la primera casilla sin marcar)
//   progreso: (opcional) número de 0 a 100, solo si la nota no tiene plan.
// El avance sale de la sección "## Plan para terminar" de la nota: lista de casillas "- [ ]" y "- [x]".
// Al marcar una casilla (cuando se cierra ese hito), la barra del panel se recalcula sola.

const SITUACIONES = ["en-marcha", "pendiente", "idea", "terminado"];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function leerProyectos(dv, carpeta) {
  const out = [];
  for (const p of Array.from(dv.pages('"' + carpeta + '"'))) {
    if (p.tipo !== "proyecto") continue;
    const progreso = typeof p.progreso === "number" && p.progreso >= 0 && p.progreso <= 100 ? Math.round(p.progreso) : null;
    out.push({
      nombre: p.file.name, ruta: p.file.path,
      estado: p.estado ? String(p.estado) : "",
      situacion: SITUACIONES.includes(p.situacion) ? p.situacion : "pendiente",
      siguiente: p.siguiente_paso ? String(p.siguiente_paso) : "",
      progreso,
    });
  }
  return out.sort((a, b) => SITUACIONES.indexOf(a.situacion) - SITUACIONES.indexOf(b.situacion) || a.nombre.localeCompare(b.nombre));
}

// Hitos de la sección "## Plan para terminar" de la nota: casillas "- [ ]" y "- [x]". null si no hay plan.
function planDeTexto(texto) {
  const lineas = String(texto || "").replace(/\r\n/g, "\n").split("\n");
  const ini = lineas.findIndex((l) => /^##\s+Plan para terminar\s*$/.test(l));
  if (ini === -1) return null;
  const items = [];
  for (let i = ini + 1; i < lineas.length; i++) {
    if (/^##\s/.test(lineas[i])) break;
    const m = lineas[i].match(/^\s*-\s\[([ xX])\]\s+(.*\S)\s*$/);
    if (m) items.push({ hecho: m[1] !== " ", texto: m[2] });
  }
  return items.length ? items : null;
}

// Lee el plan de cada proyecto y calcula su avance. Prioridad: casillas del plan > propiedad `progreso`
// > 100 % si está terminado. `leer(ruta)` devuelve el texto de la nota.
async function cargarPlanes(proys, leer) {
  for (const p of proys) {
    let items = null;
    try { items = planDeTexto(await leer(p.ruta)); } catch (e) { items = null; }
    if (items) {
      p.hechos = items.filter((i) => i.hecho).length;
      p.total = items.length;
      p.progreso = Math.round(p.hechos / p.total * 100);
      const siguiente = items.find((i) => !i.hecho);
      p.siguiente = siguiente ? siguiente.texto : "Plan completado";
    } else if (p.progreso === null && p.situacion === "terminado") {
      p.progreso = 100;
    }
  }
  return proys;
}

const delGrupo = (proys, ...sits) => proys.filter((p) => sits.includes(p.situacion));
const enlace = (p) => `<a class="internal-link" data-href="${esc(p.ruta)}" href="${esc(p.ruta)}">${esc(p.nombre)}</a>`;
const inicial = (n) => esc(n.trim().charAt(0).toUpperCase());

function filaProyecto(p, conEstado) {
  const barra = p.progreso === null ? "" : `<div class="p-bar"><span style="width:${p.progreso}%"></span></div>`;
  const pct = p.progreso === null ? "" : `<span class="p-label p-muted">${p.progreso} %</span>`;
  const hitos = p.total ? `<span class="p-small p-muted">${p.hechos} de ${p.total} hitos</span>` : "";
  return `<div class="p-proy"><span class="p-proy-icono p-proy-icono--${p.situacion}">${inicial(p.nombre)}</span>` +
    `<div class="p-proy-cuerpo"><div class="p-head"><span class="p-label"><b>${enlace(p)}</b></span>${pct}</div>${barra}${hitos}` +
    (conEstado && p.estado ? `<span class="p-small p-muted">${esc(p.estado)}</span>` : "") + `</div></div>`;
}

function tarjeta(titulo, cuerpo, vacioTexto, nota) {
  return `<section class="p-card"><div class="p-head"><h2>${esc(titulo)}</h2>${nota ? `<span class="p-small p-muted">${esc(nota)}</span>` : ""}</div>` +
    (cuerpo || `<div class="p-empty">${esc(vacioTexto)}</div>`) + `</section>`;
}

function tarjetaLista(titulo, proys, vacioTexto, conEstado) {
  return tarjeta(titulo, proys.map((p) => filaProyecto(p, conEstado)).join(""), vacioTexto);
}

function tarjetaPasos(proys) {
  const filas = proys.filter((p) => p.siguiente && p.situacion !== "terminado")
    .map((p) => `<div class="p-paso"><span class="p-label"><b>${enlace(p)}</b></span><span class="p-small p-muted">${esc(p.siguiente)}</span></div>`).join("");
  return tarjeta("Próximos pasos", filas, "Sin pasos pendientes");
}

// Tarjeta "Proyectos" de la página de Inicio: los que están en marcha o pendientes (máximo 5).
function tarjetaInicio(proys) {
  const activos = delGrupo(proys, "en-marcha", "pendiente").slice(0, 5);
  return `<section class="p-card"><h3>Proyectos</h3>` +
    (activos.length ? activos.map((p) => filaProyecto(p, false)).join("") : `<div class="p-empty">Sin proyectos en marcha</div>`) + `</section>`;
}

module.exports = { SITUACIONES, esc, leerProyectos, planDeTexto, cargarPlanes, delGrupo, filaProyecto, tarjeta, tarjetaLista, tarjetaPasos, tarjetaInicio };
