// Cotacao gratuita e sem chave (open.er-api.com). Serve pra mostrar o preco
// tambem em pesos uruguaios e argentinos - morando em Montevideu, R$ sozinho
// nao diz muito na hora de decidir.
// Se a API cair, usa a ultima cotacao guardada; se nao houver, segue sem converter.

const CACHE = require('path').join(__dirname, '..', 'cambio.json');
const fs = require('fs');

const PADRAO = { UYU: null, ARS: null, USD: null };

async function taxas() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch('https://open.er-api.com/v6/latest/BRL', { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    clearTimeout(t); // so depois de ler o corpo: header rapido + body travado penduraria a rodada
    if (!j || !j.rates) throw new Error('resposta sem rates');
    const out = { UYU: j.rates.UYU, ARS: j.rates.ARS, USD: j.rates.USD, atualizadoEm: new Date().toISOString() };
    fs.writeFileSync(CACHE, JSON.stringify(out, null, 2) + '\n');
    return out;
  } catch (e) {
    if (fs.existsSync(CACHE)) {
      try { return { ...JSON.parse(fs.readFileSync(CACHE, 'utf8')), obsoleto: true, erro: e.message }; } catch (_) { /* ignora */ }
    }
    return { ...PADRAO, erro: e.message };
  }
}

function converter(valorBRL, t) {
  const partes = [];
  if (t && t.UYU) partes.push(`$U ${Math.round(valorBRL * t.UYU).toLocaleString('pt-BR')}`);
  if (t && t.USD) partes.push(`US$ ${Math.round(valorBRL * t.USD).toLocaleString('pt-BR')}`);
  return partes.join(' / ');
}

module.exports = { taxas, converter };
