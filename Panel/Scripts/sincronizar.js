// Acción de QuickAdd "Sincronizar": envía lo pendiente a la app y trae lo que haya cambiado en Sheets.
// Toda la lógica está en panel_lib.js (junto a este archivo).
module.exports = async (params) => {
  const src = await params.app.vault.adapter.read("Panel/Scripts/panel_lib.js");
  const m = { exports: {} };
  new Function("module", "exports", src)(m, m.exports);
  return m.exports.sincronizar(params);
};
