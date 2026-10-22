// Panel en Obsidian: cálculos y piezas de HTML de las finanzas (compartidos por la página de Finanzas y
// el resumen de Inicio). Lo cargan los view.js de Dataview con:
//   const calc = (() => { const m = { exports: {} }; new Function("module", "exports", codigo)(m, m.exports); return m.exports; })();
// Cada movimiento es una nota de Panel/Finanzas/Movimientos con las propiedades:
//   id, fecha, concepto, clase (ingreso, gasto, ahorro o inversion), categoria, cantidad.

const TIPOS = ["ingreso", "gasto", "ahorro", "inversion"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Dataview convierte "2026-10-20" en una fecha; aquí siempre se trabaja con el texto AAAA-MM-DD.
function fechaTexto(v) {
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
  if (v && typeof v.toISODate === "function") return v.toISODate();
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + "-" + pad(v.getMonth() + 1) + "-" + pad(v.getDate());
  return null;
}

// 1234.5 -> "1.234,50 €"; 640 -> "640 €"
function dinero(n) {
  const cents = Math.round(Math.abs(n) * 100);
  const ent = Math.floor(cents / 100), dec = cents % 100;
  const s = String(ent).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (dec ? "," + pad(dec) : "");
  return (n < 0 && cents ? "−" : "") + s + " €";
}

function leerMovimientos(dv, carpeta) {
  const out = [];
  for (const p of Array.from(dv.pages('"' + carpeta + '"'))) {
    const fecha = fechaTexto(p.fecha);
    if (!p.id || !fecha || !TIPOS.includes(p.clase) || typeof p.cantidad !== "number" || !isFinite(p.cantidad)) continue;
    out.push({ id: String(p.id), fecha, concepto: String(p.concepto || ""), tipo: p.clase, categoria: String(p.categoria || "otros"), cantidad: p.cantidad });
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.id.localeCompare(b.id));
}

const claveMes = (fecha) => fecha.slice(0, 7);
function mesMas(clave, n) {
  const d = new Date(Number(clave.slice(0, 4)), Number(clave.slice(5, 7)) - 1 + n, 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1);
}
const nombreMes = (clave) => MESES[Number(clave.slice(5, 7)) - 1];
const etiquetaMes = (clave) => nombreMes(clave).charAt(0).toUpperCase() + nombreMes(clave).slice(1) + " " + clave.slice(0, 4);

function sumar(movs) {
  const t = { ingreso: 0, gasto: 0, ahorro: 0, inversion: 0 };
  movs.forEach((m) => { t[m.tipo] += m.cantidad; });
  return t;
}

function resumen(movs, mes) {
  const delMes = movs.filter((m) => claveMes(m.fecha) === mes);
  const t = sumar(delMes);
  const ant = sumar(movs.filter((m) => claveMes(m.fecha) === mesMas(mes, -1)));
  const porCat = {};
  delMes.filter((m) => m.tipo === "gasto").forEach((m) => { porCat[m.categoria] = (porCat[m.categoria] || 0) + m.cantidad; });
  const categorias = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const inversiones = movs.filter((m) => m.tipo === "inversion");
  return {
    mes, delMes, t, ant, categorias,
    hayDatos: delMes.length > 0,
    totalInvertido: inversiones.reduce((s, m) => s + m.cantidad, 0),
    aportaciones: inversiones.length,
    ultimaAportacion: inversiones.length ? inversiones.map((m) => m.fecha).sort().pop() : null,
  };
}

// Totales por mes de los n últimos meses (el último es "mes").
function ultimosMeses(movs, mes, n) {
  return Array.from({ length: n }, (_, i) => {
    const clave = mesMas(mes, i - (n - 1));
    return Object.assign({ mes: clave }, sumar(movs.filter((m) => claveMes(m.fecha) === clave)));
  });
}

// ---------- Piezas de HTML ----------
const SIN_DATOS = "Sin datos todavía";

function tarjetaKpi(punto, etiqueta, valor, nota) {
  return `<div class="p-card"><div class="p-kpi-title"><i class="p-dot p-dot--${punto}"></i><span class="p-label p-muted">${etiqueta}</span></div>` +
    `<span class="p-value">${valor}</span><span class="p-small p-muted">${nota}</span></div>`;
}

// Las cuatro tarjetas del mes: ingresos, gastos, ahorro e invertido.
function kpisHtml(r, extra) {
  const cab = `<div class="p-kpis${extra ? " " + extra : ""}">`;
  if (!r.hayDatos) {
    return cab + [["blue", "Ingresos"], ["red", "Gastos"], ["green", "Ahorro"], ["purple", "Invertido"]]
      .map(([c, e]) => tarjetaKpi(c, e, "—", SIN_DATOS)).join("") + `</div>`;
  }
  const t = r.t;
  let notaIng = "Sin ingresos el mes anterior para comparar";
  if (r.ant.ingreso > 0) {
    const pct = Math.round((t.ingreso - r.ant.ingreso) / r.ant.ingreso * 100);
    notaIng = (pct > 0 ? "+" : pct < 0 ? "−" : "") + Math.abs(pct) + " % frente a " + nombreMes(mesMas(r.mes, -1));
  }
  const notaGas = r.categorias.length ? dinero(r.categorias[0][1]) + " en " + esc(r.categorias[0][0]) + ", la más alta" : "Sin gastos este mes";
  const notaAho = t.ingreso > 0 ? Math.round(t.ahorro / t.ingreso * 100) + " % de lo que has ingresado" : "Sin ingresos este mes";
  const notaInv = t.inversion > 0 ? "Aportación del mes hecha" : "Sin aportación este mes";
  return cab +
    tarjetaKpi("blue", "Ingresos", dinero(t.ingreso), notaIng) +
    tarjetaKpi("red", "Gastos", dinero(t.gasto), notaGas) +
    tarjetaKpi("green", "Ahorro", dinero(t.ahorro), notaAho) +
    tarjetaKpi("purple", "Invertido", dinero(t.inversion), notaInv) + `</div>`;
}

// Anillo con "a dónde va el dinero" y su leyenda.
function anilloHtml(r) {
  const t = r.t;
  const disponible = Math.max(0, t.ingreso - t.gasto - t.ahorro - t.inversion);
  const partes = [
    ["Gastos", t.gasto, "#ff5c6c"], ["Inversión", t.inversion, "#4f86ff"],
    ["Ahorro", t.ahorro, "#2ecc8f"], ["Disponible", disponible, "#c3c6d4"],
  ];
  const total = partes.reduce((s, p) => s + p[1], 0);
  if (!r.hayDatos || total <= 0) {
    return `<div class="p-card p-donut" style="flex: 1 1 360px"><div class="p-ring"><span class="p-value">—</span><span class="p-small p-muted">ingresos</span></div>` +
      `<div class="p-empty">A dónde va el dinero: ${SIN_DATOS.toLowerCase()}</div></div>`;
  }
  let acum = 0;
  const tramos = partes.filter((p) => p[1] > 0).map((p) => {
    const ini = acum / total * 360; acum += p[1]; const fin = acum / total * 360;
    return `${p[2]} ${ini.toFixed(2)}deg ${fin.toFixed(2)}deg`;
  }).join(", ");
  const leyenda = partes.map(([nombre, valor, color]) =>
    `<div class="p-leg-fila"><i class="p-dot" style="background:${color}"></i><span class="p-leg-nombre">${nombre}</span>` +
    `<span class="p-muted">${dinero(valor)}</span><span class="p-leg-pct">${Math.round(valor / total * 100)} %</span></div>`).join("");
  return `<div class="p-card p-donut" style="flex: 1 1 360px">` +
    `<div class="p-ring p-ring--datos" style="background: conic-gradient(${tramos})"><div class="p-ring-hueco"><span class="p-value">${dinero(t.ingreso)}</span><span class="p-small p-muted">ingresos</span></div></div>` +
    `<div class="p-leyenda"><span class="p-label"><b>A dónde va el dinero</b></span>${leyenda}</div></div>`;
}

module.exports = {
  TIPOS, MESES, MESES_CORTO, esc, fechaTexto, dinero, leerMovimientos, claveMes, mesMas, nombreMes, etiquetaMes,
  sumar, resumen, ultimosMeses, kpisHtml, anilloHtml, SIN_DATOS,
};
