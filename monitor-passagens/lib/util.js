const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const log = (...args) => console.log(...args);

function semAcento(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizar(s) {
  return semAcento(s).toLowerCase().trim();
}

function hoje() {
  return new Date();
}

function somarDias(base, dias) {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

function brl(n) {
  return 'R$ ' + Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function percentil(valores, p) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const pos = (p / 100) * (v.length - 1);
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (baixo === alto) return v[baixo];
  return v[baixo] + (v[alto] - v[baixo]) * (pos - baixo);
}

function mediana(valores) {
  return percentil(valores, 50);
}

module.exports = { pausa, log, semAcento, normalizar, hoje, somarDias, iso, brl, percentil, mediana };
