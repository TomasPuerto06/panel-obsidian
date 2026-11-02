// Acción de QuickAdd "Anadir agenda": crea un evento propio en Google Calendar ("Agenda del panel") y su nota.
// Toda la lógica está en panel_lib.js (junto a este archivo).
module.exports = async (params) => {
  const src = await params.app.vault.adapter.read("Panel/Scripts/panel_lib.js");
  const m = { exports: {} };
  new Function("module", "exports", src)(m, m.exports);
  return m.exports.anadirAgenda(params);
};
