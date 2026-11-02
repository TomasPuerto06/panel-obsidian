// Panel en Obsidian: plan del gimnasio de la semana. Lo carga salud/view.js con new Function.
// El plan no se guarda: se calcula cada vez con lo que ya has hecho, así siempre está al día aunque falles o adelantes
// un entreno. planificarSemana es la misma lógica que el resumen de la mañana (src/servidor/Gimnasio.gs) y la rutina,
// la de CONFIG.gimnasio de Config.gs: pruebas/panel_planificador.js comprueba que coinciden.

const GIMNASIO = {
  entrenos: {
    pht: { nombre: "Pecho · Hombro · Tríceps", grupos: ["pecho", "hombro", "triceps"] },
    eba: { nombre: "Espalda · Bíceps · Abs", grupos: ["espalda", "biceps", "abs"] },
    pierna: { nombre: "Pierna", grupos: ["pierna"] },
  },
  rutina: ["pht", "eba", "pierna", "pht", "eba"],   // orden de la semana
  diasBase: [1, 2, 3, 4, 5],                        // cada uno, por defecto, en este día (1 = lunes)
  descansoMinimo: 2,                                // días libres entre dos entrenos del mismo grupo
  permitirFinde: true,                              // sábado y domingo solo si no hay otra forma
};

const DIAS_CORTO = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Los días van como números enteros (días desde 1970): evita líos de zona horaria.
function diaNum(texto) {
  const [a, m, d] = texto.split("-").map(Number);
  return Date.UTC(a, m - 1, d) / 86400000;
}
const diaTexto = (numero) => new Date(numero * 86400000).toISOString().slice(0, 10);

// Decide qué entreno hacer cada día que queda de la semana. Prueba todas las combinaciones y se queda con la mejor
// según, por orden: 1. más entrenos hechos, 2. menos días de fin de semana, 3. respetar el orden de la rutina,
// 4. entrenar lo antes posible. Regla que nunca se rompe: al menos descansoMinimo días libres entre dos entrenos que
// compartan grupo muscular, también con la semana siguiente. Devuelve { dias: [...7], noCaben: [ids] }.
function planificarSemana({ lunes, hoy, registros, cfg }) {
  const domingo = lunes + 6;
  const separacion = cfg.descansoMinimo + 1;
  const grupos = (e) => cfg.entrenos[e].grupos;
  const esFinde = (dia) => dia - lunes >= 5;

  const porDia = {};
  registros.forEach((r) => { porDia[r.dia] = r; });
  const hechos = registros.filter((r) => r.estado === "hecho");

  // Entrenos que faltan esta semana: la rutina menos lo ya hecho.
  const pendientes = cfg.rutina.slice();
  hechos.filter((r) => r.dia >= lunes && r.dia <= domingo)
    .sort((a, b) => a.dia - b.dia)
    .forEach((r) => {
      const i = pendientes.indexOf(r.entreno);
      if (i >= 0) pendientes.splice(i, 1);
    });

  // Último día entrenado de cada grupo muscular.
  const ultimo = {};
  hechos.forEach((r) => grupos(r.entreno).forEach((g) => {
    ultimo[g] = Math.max(ultimo[g] ?? -Infinity, r.dia);
  }));

  // Primer día de la semana siguiente en que vuelve a tocar cada grupo.
  const limite = {};
  cfg.rutina.forEach((e, i) => grupos(e).forEach((g) => {
    limite[g] = Math.min(limite[g] ?? Infinity, lunes + 7 + cfg.diasBase[i] - 1);
  }));

  // Días disponibles: desde hoy (o mañana si hoy ya está marcado) hasta el domingo.
  const desde = Math.max(lunes, porDia[hoy] ? hoy + 1 : hoy);
  const candidatos = [];
  for (let d = desde; d <= domingo; d++) {
    if (porDia[d]) continue;
    if (esFinde(d) && !cfg.permitirFinde) continue;
    candidatos.push(d);
  }

  const puede = (e, dia, ultimos) => grupos(e).every((g) =>
    (ultimos[g] === undefined || dia - ultimos[g] >= separacion) &&
    (limite[g] === undefined || limite[g] - dia >= separacion));

  // Búsqueda exhaustiva (como mucho 7 días x 5 entrenos: es instantánea).
  let mejor = { asignados: [], puntos: [0, 0, 0, 0] };
  const mejorQue = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
  };

  function buscar(i, k, ultimos, asignados) {
    if (i === candidatos.length || k === pendientes.length) {
      const puntos = [
        asignados.length,
        -asignados.filter((a) => esFinde(a.dia)).length,
        -asignados.reduce((s, a) => s + a.indice, 0),
        -asignados.reduce((s, a) => s + a.dia, 0),
      ];
      if (mejorQue(puntos, mejor.puntos)) mejor = { asignados: asignados.slice(), puntos };
      return;
    }
    const dia = candidatos[i];
    buscar(i + 1, k, ultimos, asignados);                 // opción: descansar ese día
    for (let j = k; j < pendientes.length; j++) {         // opción: hacer el entreno j (saltando los anteriores)
      const e = pendientes[j];
      if (!puede(e, dia, ultimos)) continue;
      const nuevos = Object.assign({}, ultimos);
      grupos(e).forEach((g) => { nuevos[g] = dia; });
      asignados.push({ dia, entreno: e, indice: j });
      buscar(i + 1, j + 1, nuevos, asignados);
      asignados.pop();
    }
  }
  buscar(0, 0, ultimo, []);

  const plan = {};
  mejor.asignados.forEach((a) => { plan[a.dia] = a.entreno; });
  const usados = mejor.asignados.map((a) => a.indice);

  const dias = [];
  for (let d = lunes; d <= domingo; d++) {
    const r = porDia[d];
    if (r && r.estado === "hecho") dias.push({ dia: d, estado: "hecho", entreno: r.entreno });
    else if (r) dias.push({ dia: d, estado: "fallado" });
    else if (plan[d]) dias.push({ dia: d, estado: "plan", entreno: plan[d] });
    else if (d < hoy) dias.push({ dia: d, estado: "pasado" });
    else dias.push({ dia: d, estado: "descanso" });
  }
  return { dias, noCaben: pendientes.filter((_, i) => !usados.includes(i)) };
}

const uri = (vault, vars) => "obsidian://quickadd?vault=" + encodeURIComponent(vault) + "&choice=" + encodeURIComponent("Marcar entreno") +
  Object.entries(vars).map(([k, v]) => "&value-" + k + "=" + encodeURIComponent(v)).join("");

// Tarjeta "Plan de la semana". registros: [{ fecha, entreno ("pht", "eba", "pierna" o "descanso") }].
function tarjetaPlan(hoyTexto, registros, vault) {
  const cfg = GIMNASIO;
  const hoy = diaNum(hoyTexto);
  const lunes = hoy - ((new Date(hoy * 86400000).getUTCDay() + 6) % 7);
  const r = planificarSemana({
    lunes, hoy, cfg,
    registros: registros.map((x) => ({ dia: diaNum(x.fecha), entreno: x.entreno, estado: x.entreno === "descanso" ? "fallado" : "hecho" })),
  });
  const filas = r.dias.map((d, i) => {
    const esHoy = d.dia === hoy;
    const fecha = diaTexto(d.dia);
    const etiqueta = { hecho: "Hecho", plan: esHoy ? "Toca hoy" : "Planificado", fallado: "No fui", pasado: "Sin registrar", descanso: "Descanso" }[d.estado];
    const nombre = d.entreno ? cfg.entrenos[d.entreno].nombre : "—";
    let acciones = "";
    if (esHoy && d.estado === "plan") {
      acciones = `<a class="p-link" href="${uri(vault, { dia: fecha, valor: d.entreno })}">Hecho</a>` +
        `<a class="p-link" href="${uri(vault, { dia: fecha, valor: "descanso" })}">Hoy no voy</a>`;
    } else if (d.dia <= hoy) {
      acciones = `<a class="p-link" href="${uri(vault, { dia: fecha })}">Cambiar</a>`;
    }
    return `<div class="p-plan-dia p-plan-dia--${d.estado}${esHoy ? " p-plan-dia--hoy" : ""}">` +
      `<span class="p-fechacaja"><b>${Number(fecha.slice(8))}</b><small>${DIAS_CORTO[i]}</small></span>` +
      `<div class="p-plan-cuerpo"><span class="p-label">${esc(nombre)}</span><span class="p-small p-plan-estado">${etiqueta}${i >= 5 && d.estado === "plan" ? " · fin de semana" : ""}</span></div>` +
      (acciones ? `<span class="p-tarea-acciones">${acciones}</span>` : "") + `</div>`;
  }).join("");
  const hechos = r.dias.filter((d) => d.estado === "hecho").length;
  const noCaben = r.noCaben.length ? `<span class="p-small p-plan-aviso">No caben esta semana: ${r.noCaben.map((e) => esc(cfg.entrenos[e].nombre)).join(", ")}</span>` : "";
  return `<section class="p-card p-plan"><div class="p-head"><h3>Plan de la semana</h3><span class="p-small p-muted">${hechos} de ${cfg.rutina.length} hechos</span></div>${filas}${noCaben}` +
    `<span class="p-small p-muted">Si fallas un día, el plan se reorganiza solo. Mínimo ${cfg.descansoMinimo} días de descanso por grupo.</span></section>`;
}

module.exports = { GIMNASIO, planificarSemana, tarjetaPlan, diaNum, diaTexto };
