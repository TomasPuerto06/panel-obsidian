// Panel en Obsidian: página de Finanzas. Dataview JS. Se llama desde una nota con:
//   await dv.view("Panel/Scripts/finanzas", {})
// Lee una nota por movimiento de Panel/Finanzas/Movimientos (las crea y sincroniza el puente con la app)
// y pinta las tarjetas con las clases p-* de .obsidian/snippets/panel.css.

const CARPETA = (input && input.carpeta) || "Panel/Finanzas/Movimientos";
// Nombre de la inversión para la tarjeta: "nombre_inversion" de Panel/Configuracion.md (si no está, solo "Inversión")
const CONFIG = (typeof dv.page === "function" && dv.page("Panel/Configuracion")) || {};
const NOMBRE_INVERSION = CONFIG.nombre_inversion ? String(CONFIG.nombre_inversion).trim() : "";

const calc = await (async () => {
  const a = typeof app !== "undefined" ? app : dv.app;
  const codigo = await a.vault.adapter.read("Panel/Scripts/finanzas/calculos.js");
  const m = { exports: {} };
  new Function("module", "exports", codigo)(m, m.exports);
  return m.exports;
})();
const { esc, dinero, MESES_CORTO } = calc;
const pad = (n) => String(n).padStart(2, "0");

const base = input && input.hoy ? new Date(Number(input.hoy.slice(0, 4)), Number(input.hoy.slice(5, 7)) - 1, Number(input.hoy.slice(8, 10))) : new Date();
const mesActual = base.getFullYear() + "-" + pad(base.getMonth() + 1);

const nombreBoveda = (() => { try { return app.vault.getName(); } catch (e) { return "Boveda"; } })();
const uri = (choice, vars) =>
  "obsidian://quickadd?vault=" + encodeURIComponent(nombreBoveda) + "&choice=" + encodeURIComponent(choice) +
  Object.entries(vars || {}).map(([k, v]) => "&value-" + encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("");

const movs = calc.leerMovimientos(dv, CARPETA);

// Un mes por pantalla; se recuerda el último elegido mientras Obsidian siga abierto.
const mesRecordado = typeof window !== "undefined" ? window.__panelMesFinanzas : null;
let mes = input && input.mes ? input.mes : (/^\d{4}-\d{2}$/.test(mesRecordado || "") ? mesRecordado : mesActual);

// Barras por mes: pares (ingresos y gastos) o simples. Altura en píxeles.
function barrasMeses(meses, series, max, alto) {
  const cols = meses.map((m) => {
    const barras = series.map((s) => {
      const v = m[s.campo];
      const px = v > 0 ? Math.max(3, Math.round(Math.min(v, max) / max * alto)) : 3;
      return `<div class="p-bar-v ${v > 0 ? s.clase : "p-bar-v--none"}" style="height:${px}px" title="${esc(s.nombre + ", " + calc.etiquetaMes(m.mes) + ": " + dinero(v))}"></div>`;
    }).join("");
    return `<div class="p-bars-col${series.length > 1 ? " p-bars-col--par" : ""}">${barras}</div>`;
  }).join("");
  const etiquetas = meses.map((m) => `<span>${MESES_CORTO[Number(m.mes.slice(5, 7)) - 1]}</span>`).join("");
  return `<div class="p-bars" style="height:${alto}px">${cols}</div><div class="p-bars-labels">${etiquetas}</div>`;
}

function pintar(mes) {
  const r = calc.resumen(movs, mes);
  const prev = calc.mesMas(mes, -1), sig = calc.mesMas(mes, 1);

  const acciones =
    `<div class="p-actions p-actions--mes">` +
    `<div class="p-mes"><button type="button" class="p-mes-btn" data-mes="${prev}" aria-label="Mes anterior">‹</button>` +
    `<span class="p-mes-nombre">${esc(calc.etiquetaMes(mes))}</span>` +
    `<button type="button" class="p-mes-btn" data-mes="${sig}" aria-label="Mes siguiente">›</button></div>` +
    `<a class="p-btn p-btn--sec" href="${uri("Sincronizar")}">Sincronizar</a>` +
    `<a class="p-btn" href="${uri("Anadir movimiento")}">Añadir movimiento</a></div>`;

  // Ingresos y gastos de los últimos 6 meses
  const seis = calc.ultimosMeses(movs, mes, 6);
  const maxSeis = Math.max(100, ...seis.map((m) => Math.max(m.ingreso, m.gasto)));
  const hayHistorial = seis.some((m) => m.ingreso > 0 || m.gasto > 0);
  const grafica =
    `<section class="p-card"><div class="p-head"><h2>Ingresos y gastos · últimos 6 meses</h2>` +
    `<div class="p-legend"><span><i class="p-dot p-dot--blue"></i>Ingresos</span><span><i class="p-dot p-dot--red"></i>Gastos</span></div></div>` +
    (hayHistorial
      ? barrasMeses(seis, [{ campo: "ingreso", clase: "p-bar-v--ok", nombre: "Ingresos" }, { campo: "gasto", clase: "p-bar-v--red", nombre: "Gastos" }], maxSeis, 200)
      : `<div class="p-chart p-empty">La gráfica aparecerá cuando haya movimientos</div>`) + `</section>`;

  // Movimientos del mes
  const filas = r.delMes.map((m) => {
    const [, mm, dd] = m.fecha.split("-");
    const signo = m.tipo === "ingreso" ? "+" : "−";
    const clase = m.tipo === "ingreso" ? "p-amount p-amount--in" : "p-amount";
    return `<tr><td class="p-nowrap p-muted">${Number(dd)} ${MESES_CORTO[Number(mm) - 1]}</td><td>${esc(m.concepto)}</td>` +
      `<td><span class="p-tag p-tag--${(m.categoria.length + m.categoria.charCodeAt(0)) % 6}">${esc(m.categoria)}</span></td>` +
      `<td class="p-right ${clase}">${signo}${dinero(m.cantidad)}</td>` +
      `<td class="p-right p-nowrap"><a class="p-link" href="${uri("Editar movimiento", { id: m.id })}">Editar</a> <a class="p-link p-link--borrar" href="${uri("Borrar movimiento", { id: m.id })}">Borrar</a></td></tr>`;
  }).join("");
  const tabla =
    `<section class="p-card"><div class="p-head"><h2>Movimientos de ${esc(calc.nombreMes(mes))}</h2><span class="p-small p-muted">${r.delMes.length} movimientos</span></div>` +
    `<div class="p-table-wrap"><table class="p-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="p-right">Importe</th><th class="p-right">Acciones</th></tr></thead><tbody>` +
    (filas || `<tr><td colspan="5" class="p-muted">Sin movimientos este mes</td></tr>`) + `</tbody></table></div></section>`;

  // Inversión (aportaciones; la app no guarda el valor de mercado)
  const inv = calc.ultimosMeses(movs, mes, 6);
  const maxInv = Math.max(50, ...inv.map((m) => m.inversion));
  const ultima = r.ultimaAportacion ? Number(r.ultimaAportacion.slice(8, 10)) + " " + MESES_CORTO[Number(r.ultimaAportacion.slice(5, 7)) - 1] + " " + r.ultimaAportacion.slice(0, 4) : null;
  const inversion =
    `<section class="p-card p-card--note"><h2>Inversión${NOMBRE_INVERSION ? " · " + esc(NOMBRE_INVERSION) : ""}</h2><span class="p-value">${dinero(r.totalInvertido)}</span>` +
    `<span class="p-small">${r.aportaciones ? "Aportado en total · " + r.aportaciones + " aportaciones, la última el " + ultima : "Sin aportaciones todavía"}</span>` +
    (r.aportaciones ? barrasMeses(inv, [{ campo: "inversion", clase: "p-bar-v--blanco", nombre: "Aportado" }], maxInv, 70) : "") +
    `<span class="p-small">Este mes: ${dinero(r.t.inversion)}</span></section>`;

  // Gastos por categoría del mes
  const totalGas = r.t.gasto;
  const cats = r.categorias.map(([nombre, valor]) =>
    `<div class="p-habit"><div class="p-head"><span class="p-label">${esc(nombre)}</span><span class="p-label p-muted">${dinero(valor)} · ${Math.round(valor / totalGas * 100)} %</span></div>` +
    `<div class="p-bar"><span style="width:${Math.round(valor / totalGas * 100)}%"></span></div></div>`).join("");
  const categorias =
    `<section class="p-card"><h2>Gastos por categoría</h2>${cats || `<div class="p-empty">Sin gastos este mes</div>`}</section>`;

  const html = `<div class="p-page">` + acciones + calc.kpisHtml(r) +
    `<div class="p-layout"><div class="p-main">${grafica}${tabla}</div><div class="p-aside">${inversion}${categorias}</div></div></div>`;

  dv.container.innerHTML = html;
  if (dv.container.querySelectorAll) {
    dv.container.querySelectorAll("[data-mes]").forEach((b) => b.addEventListener("click", () => {
      const nuevo = b.getAttribute("data-mes");
      if (typeof window !== "undefined") window.__panelMesFinanzas = nuevo;
      pintar(nuevo);
    }));
  }
}

pintar(mes);
