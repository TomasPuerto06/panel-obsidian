// Acción de QuickAdd "Poner nota de examen": calificación y apunte de un examen ya hecho (llega por enlace con value-id, o se elige de una lista).
// Toda la lógica está en panel_lib.js (junto a este archivo).
module.exports = async (params) => {
  const src = await params.app.vault.adapter.read("Panel/Scripts/panel_lib.js");
  const m = { exports: {} };
  new Function("module", "exports", src)(m, m.exports);
  return m.exports.ponerNotaExamen(params);
};
