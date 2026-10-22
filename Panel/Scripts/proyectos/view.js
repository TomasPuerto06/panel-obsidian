// Panel en Obsidian: página de Proyectos. Dataview JS. Se llama desde una nota con:
//   await dv.view("Panel/Scripts/proyectos", {})
// Lee las notas de Proyectos/ con `tipo: proyecto` (ver calculos.js) y pinta las tarjetas.

const CARPETA = (input && input.carpeta) || "Proyectos";

const calc = await (async () => {
  const a = typeof app !== "undefined" ? app : dv.app;
  const codigo = await a.vault.adapter.read("Panel/Scripts/proyectos/calculos.js");
  const m = { exports: {} };
  new Function("module", "exports", codigo)(m, m.exports);
  return m.exports;
})();

const proys = calc.leerProyectos(dv, CARPETA);
await calc.cargarPlanes(proys, (ruta) => dv.io.load(ruta));

// Tareas de proyectos: las de categoría "proyecto" (Panel/Scripts/tareas/calculos.js, la misma tarjeta de Inicio y Estudios)
const tareasProyectos = await (async () => {
  const a = typeof app !== "undefined" ? app : dv.app;
  const codigo = await a.vault.adapter.read("Panel/Scripts/tareas/calculos.js");
  const m = { exports: {} };
  new Function("module", "exports", codigo)(m, m.exports);
  const nombre = (() => { try { return a.vault.getName(); } catch (e) { return "Boveda"; } })();
  const hoy = (input && input.hoy) || new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0");
  const tareas = m.exports.leerTareas(dv, (input && input.carpetaTareas) || "Panel/Tareas");
  return m.exports.tarjetaTareas(tareas, hoy, nombre, { titulo: "Tareas de proyectos", categorias: ["proyecto"], categoriaNueva: "proyecto", h: "h2", vacio: "Sin tareas de proyectos todavía" });
})();

const pendientes = calc.delGrupo(proys, "pendiente", "idea");
const principal =
  calc.tarjetaLista("En marcha", calc.delGrupo(proys, "en-marcha"), "Sin proyectos en marcha", true) +
  calc.tarjetaLista("Pendientes e ideas", pendientes, "Sin proyectos pendientes", true) +
  tareasProyectos;
const lateral =
  calc.tarjetaPasos(proys) +
  calc.tarjetaLista("Terminados", calc.delGrupo(proys, "terminado"), "Sin proyectos terminados todavía", true);

dv.container.innerHTML = `<div class="p-layout"><div class="p-main">${principal}</div><div class="p-aside">${lateral}</div></div>`;
