// Panel en Obsidian: tareas. Cálculos y HTML de la tarjeta de tareas (compartida por Inicio, Estudios y
// Proyectos). Lo cargan los view.js de Dataview con new Function. Las funciones reciben datos ya leídos y
// devuelven HTML, para poder reutilizarlas cuando la app del Panel de vida adopte el mismo diseño.
//
// Cada tarea es una nota de Panel/Tareas con: tipo: tarea, id, tarea, fecha (puede faltar), categoria, hecha.
// Categorías de la app: personal, clase, trabajo, gimnasio. Propia del panel: proyecto.

const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Dataview entrega las fechas como objetos; aquí siempre se usa el texto AAAA-MM-DD.
function fechaTexto(v) {
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : "";
  if (v && typeof v.toISODate === "function") return v.toISODate() || "";
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + "-" + pad(v.getMonth() + 1) + "-" + pad(v.getDate());
  return "";
}

function leerTareas(dv, carpeta) {
  const out = [];
  for (const p of Array.from(dv.pages('"' + carpeta + '"'))) {
    if (p.tipo !== "tarea" || !p.id || !p.tarea) continue;
    out.push({
      id: String(p.id), tarea: String(p.tarea), fecha: fechaTexto(p.fecha),
      categoria: p.categoria ? String(p.categoria) : "personal", hecha: p.hecha === true,
    });
  }
  return out;
}

// Las tareas no usan fecha: pendientes por orden alfabético y después las hechas.
const porTexto = (a, b) => a.tarea.localeCompare(b.tarea, "es");
function ordenar(tareas) {
  return tareas.filter((t) => !t.hecha).sort(porTexto).concat(tareas.filter((t) => t.hecha).sort(porTexto));
}

function uriQuickAdd(vault, accion, vars) {
  return "obsidian://quickadd?vault=" + encodeURIComponent(vault) + "&choice=" + encodeURIComponent(accion) +
    Object.entries(vars || {}).map(([k, v]) => "&value-" + encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("");
}

function filaTarea(t, hoy, vault) {
  const marcar = uriQuickAdd(vault, "Marcar tarea", { id: t.id });
  return `<div class="p-tarea${t.hecha ? " p-tarea--hecha" : ""}">` +
    `<a class="p-check${t.hecha ? " p-check--on" : ""}" href="${marcar}" aria-label="${esc((t.hecha ? "Devolver a pendiente: " : "Marcar como hecha: ") + t.tarea)}" title="${t.hecha ? "Devolver a pendiente" : "Marcar como hecha"}"></a>` +
    `<span class="p-tarea-texto">${esc(t.tarea)}</span>` +
    `<span class="p-tag p-tag--${(t.categoria.length + t.categoria.charCodeAt(0)) % 6}">${esc(t.categoria)}</span>` +
    `<span class="p-tarea-acciones"><a class="p-link" href="${uriQuickAdd(vault, "Editar tarea", { id: t.id })}">Editar</a>` +
    `<a class="p-link p-link--borrar" href="${uriQuickAdd(vault, "Borrar tarea", { id: t.id })}">Borrar</a></span></div>`;
}

// opts: { titulo, categorias (lista o null = todas), max (pendientes a mostrar), hechas (hechas a mostrar),
//         ancho, vacio, h (nivel del título: "h2" o "h3"), categoriaNueva (para "Añadir tarea") }
function tarjetaTareas(todas, hoy, vault, opts) {
  const o = Object.assign({ titulo: "Tareas", categorias: null, max: 8, hechas: 2, ancho: false, vacio: "Sin tareas todavía", h: "h3", categoriaNueva: "" }, opts || {});
  const lista = ordenar(todas.filter((t) => !o.categorias || o.categorias.includes(t.categoria)));
  const pendientes = lista.filter((t) => !t.hecha);
  const hechas = lista.filter((t) => t.hecha).slice(0, o.hechas);
  const mostradas = pendientes.slice(0, o.max).concat(hechas);
  const resto = pendientes.length - Math.min(pendientes.length, o.max);
  const nota = pendientes.length ? pendientes.length + (pendientes.length === 1 ? " pendiente" : " pendientes") : "";
  const anadir = uriQuickAdd(vault, "Anadir tarea", o.categoriaNueva ? { categoria: o.categoriaNueva } : {});
  return `<section class="p-card${o.ancho ? " p-card--wide" : ""}"><div class="p-head"><${o.h}>${esc(o.titulo)}</${o.h}>` +
    `<span class="p-head-der">${nota ? `<span class="p-small p-muted">${nota}</span>` : ""}<a class="p-link p-link--mas" href="${anadir}">Añadir tarea</a></span></div>` +
    (mostradas.length ? mostradas.map((t) => filaTarea(t, hoy, vault)).join("") : `<div class="p-empty">${esc(o.vacio)}</div>`) +
    (resto > 0 ? `<span class="p-small p-muted">y ${resto} más</span>` : "") + `</section>`;
}

module.exports = { fechaTexto, leerTareas, ordenar, uriQuickAdd, filaTarea, tarjetaTareas };
