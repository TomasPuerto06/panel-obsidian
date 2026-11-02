// Acción de QuickAdd "Marcar entreno": lo que hiciste un día, desde el plan de la semana (llega por enlace con value-dia y value-valor).
// Toda la lógica está en panel_lib.js (junto a este archivo).
module.exports = async (params) => {
  const src = await params.app.vault.adapter.read("Panel/Scripts/panel_lib.js");
  const m = { exports: {} };
  new Function("module", "exports", src)(m, m.exports);
  return m.exports.marcarEntreno(params);
};
