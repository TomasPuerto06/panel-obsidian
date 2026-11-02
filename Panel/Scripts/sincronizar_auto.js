// Acción de QuickAdd "Sincronizar solo": arranca con Obsidian (Run on startup) y sincroniza cada pocos minutos, en silencio.
// Solo avisa si algo va mal. Estar sin conexión no se avisa: lo pendiente se queda en la cola para la siguiente vuelta.
const MINUTOS = 5;
const ESPERA_INICIAL_MS = 20000;   // al abrir, Obsidian aún está leyendo las propiedades de las notas

module.exports = async (params) => {
  const obsidian = Object.assign({}, params.obsidian, {
    Notice: function (texto) { if (!/sin conexión/.test(texto)) new params.obsidian.Notice(texto); },
  });
  const sincronizar = async () => {
    try {
      const src = await params.app.vault.adapter.read("Panel/Scripts/panel_lib.js");
      const m = { exports: {} };
      new Function("module", "exports", src)(m, m.exports);
      await m.exports.sincronizar({ app: params.app, obsidian, variables: {}, silencio: true });
    } catch (e) { console.error("Panel: fallo al sincronizar", e); }
  };
  if (window.panelSincronizacionAuto) clearInterval(window.panelSincronizacionAuto);
  window.panelSincronizacionAuto = setInterval(sincronizar, MINUTOS * 60000);
  setTimeout(sincronizar, ESPERA_INICIAL_MS);
};
