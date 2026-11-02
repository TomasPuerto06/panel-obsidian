// Panel en Obsidian: página Calendario. Lee los eventos y los días de gimnasio y pinta el mes con
// etiquetas de hora y título (el HTML sale de calculos.js). Se carga con dv.view("Panel/Scripts/calendario").
const a = typeof app !== "undefined" ? app : dv.app;
const codigo = await a.vault.adapter.read("Panel/Scripts/calendario/calculos.js");
const m = { exports: {} };
new Function("module", "exports", codigo)(m, m.exports);
const c = m.exports;

const ahora = new Date();
const hoy = (input && input.hoy) || ahora.getFullYear() + "-" + String(ahora.getMonth() + 1).padStart(2, "0") + "-" + String(ahora.getDate()).padStart(2, "0");
const eventos = c.leerEventos(dv, (input && input.carpetaCalendario) || "Panel/Calendario");
const gym = c.diasGimnasio(dv, (input && input.carpetaDiario) || "Panel/Diario");
const vault = (() => { try { return a.vault.getName(); } catch (e) { return "Boveda"; } })();
// Las clases no son notas: la sincronización las deja en este archivo. Si aún no está, no salen.
const clases = {};
try {
  JSON.parse(await a.vault.adapter.read("Panel/Scripts/.puente/clases.json")).forEach((x) => { (clases[x.fecha] = clases[x.fecha] || []).push(x); });
} catch (e) { /* todavía sin clases */ }
const opciones = { estilo: "etiquetas", conTitulo: true, semana: true, vault, clases };

dv.container.innerHTML = c.paginaCalendario(eventos, gym, hoy, opciones);
c.activarCalendario(dv.container, eventos, gym, hoy, opciones);   // botones de mes y semana del día pulsado
