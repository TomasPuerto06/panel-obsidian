// Panel en Obsidian: página de Estudios. Dataview JS. Se llama desde una nota con:
//   await dv.view("Panel/Scripts/estudios", {})
// Lee las notas de Estudios/: la nota principal de cada asignatura (`tipo: asignatura`), sus apuntes y
// chuleta (`tipo: apuntes`, `tipo: chuleta`) y sus prácticas (`tipo: practica`), todos con `asignatura`.
// También enseña los exámenes (próximos y hechos), el calendario y las tareas de estudio.

const CARPETA = (input && input.carpeta) || "Estudios";
// Asignaturas que todavía no tienen material: la lista "asignaturas_sin_material" de Panel/Configuracion.md
const CONFIG = (typeof dv.page === "function" && dv.page("Panel/Configuracion")) || {};
const SIN_MATERIAL = Array.from(CONFIG.asignaturas_sin_material || []).map(String).filter(Boolean);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enlace = (ruta, texto) => `<a class="internal-link" data-href="${esc(ruta)}" href="${esc(ruta)}">${esc(texto)}</a>`;

const paginas = Array.from(dv.pages('"' + CARPETA + '"')).filter((p) => p.asignatura);
const nombres = Array.from(new Set(paginas.filter((p) => p.tipo === "asignatura").map((p) => String(p.asignatura)))).sort((a, b) => a.localeCompare(b, "es"));

const filas = nombres.map((nombre) => {
  const delas = paginas.filter((p) => String(p.asignatura) === nombre);
  const principal = delas.find((p) => p.tipo === "asignatura");
  const apuntes = delas.find((p) => p.tipo === "apuntes");
  const chuleta = delas.find((p) => p.tipo === "chuleta");
  const practicas = delas.filter((p) => p.tipo === "practica").length;
  const enlaces = [apuntes && enlace(apuntes.file.path, "Apuntes"), chuleta && enlace(chuleta.file.path, "Chuleta")].filter(Boolean).join(" ");
  return `<div class="p-asig"><div class="p-head"><span class="p-label"><b>${enlace(principal.file.path, nombre)}</b></span>` +
    `<span class="p-small p-muted">${practicas} ${practicas === 1 ? "práctica" : "prácticas"}</span></div>` +
    `<div class="p-asig-enlaces">${enlaces}</div></div>`;
}).join("");

const asignaturas =
  `<section class="p-card"><div class="p-head"><h2>Asignaturas</h2><span class="p-small p-muted">${nombres.length} con material</span></div>` +
  (filas ? `<div class="p-asig-grid">${filas}</div>` : `<div class="p-empty">Sin asignaturas todavía</div>`) +
  (SIN_MATERIAL.length ? `<div class="p-small p-muted">Sin material todavía: ${SIN_MATERIAL.map(esc).join(", ")}</div>` : "") + `</section>`;

const vacio = (titulo, texto) => `<section class="p-card"><h2>${titulo}</h2><div class="p-empty">${texto}</div></section>`;

// Tareas de estudio: las de categoría "clase" (Panel/Scripts/tareas/calculos.js, la misma tarjeta de Inicio y Proyectos)
const tareasEstudio = await (async () => {
  const a = typeof app !== "undefined" ? app : dv.app;
  const codigo = await a.vault.adapter.read("Panel/Scripts/tareas/calculos.js");
  const m = { exports: {} };
  new Function("module", "exports", codigo)(m, m.exports);
  const nombre = (() => { try { return a.vault.getName(); } catch (e) { return "Boveda"; } })();
  const hoy = (input && input.hoy) || new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0");
  const tareas = m.exports.leerTareas(dv, (input && input.carpetaTareas) || "Panel/Tareas");
  return m.exports.tarjetaTareas(tareas, hoy, nombre, { titulo: "Tareas de estudio", categorias: ["clase"], categoriaNueva: "clase", h: "h2", vacio: "Sin tareas de clase todavía" });
})();

// Próximos exámenes y calendario del mes (Panel/Scripts/calendario/calculos.js, el mismo de Inicio). Los días de
// gimnasio salen de las notas del día.
const calendarioEstudios = await (async () => {
  const a = typeof app !== "undefined" ? app : dv.app;
  const codigo = await a.vault.adapter.read("Panel/Scripts/calendario/calculos.js");
  const m = { exports: {} };
  new Function("module", "exports", codigo)(m, m.exports);
  const c = m.exports;
  const nombre = (() => { try { return a.vault.getName(); } catch (e) { return "Boveda"; } })();
  const hoy = (input && input.hoy) || new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0");
  const eventos = c.leerEventos(dv, (input && input.carpetaCalendario) || "Panel/Calendario");
  const gym = c.diasGimnasio(dv, (input && input.carpetaDiario) || "Panel/Diario");
  return {
    c, eventos, gym, hoy,
    examenes: c.tarjetaExamenes(eventos, hoy, nombre, { h: "h2", max: Infinity }),   // aquí todos; en Inicio, 6
    hechos: c.tarjetaExamenesHechos(eventos, hoy, nombre, { h: "h2" }),
    calendario: c.tarjetaCalendario(eventos, gym, hoy),
  };
})();

// Disposición: arriba, en tres columnas, próximos exámenes, exámenes hechos y el calendario
// (más grande, con el detalle del día); abajo, en dos columnas, asignaturas y tareas de estudio.
dv.container.innerHTML =
  `<div class="p-estudios"><div class="p-estudios-fila1">${calendarioEstudios.examenes}${calendarioEstudios.hechos}${calendarioEstudios.calendario}</div>` +
  `<div class="p-estudios-fila2">${asignaturas}${tareasEstudio}</div></div>`;
calendarioEstudios.c.activarCalendario(dv.container, calendarioEstudios.eventos, calendarioEstudios.gym, calendarioEstudios.hoy);   // botones de mes
