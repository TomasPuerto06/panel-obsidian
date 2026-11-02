// Acción de QuickAdd "Escribir nota": cambia el texto de la nota de hoy y lo envía a Google.
// Toda la lógica está en panel_lib.js (junto a este archivo).
module.exports = async (params) => {
  const src = await params.app.vault.adapter.read("Panel/Scripts/panel_lib.js");
  const m = { exports: {} };
  new Function("module", "exports", src)(m, m.exports);
  return m.exports.escribirNotaDia(params);
};
