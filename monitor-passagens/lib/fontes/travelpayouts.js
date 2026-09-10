// Fonte OPCIONAL: Travelpayouts / Aviasales Data API.
// Cadastro gratuito (travelpayouts.com), sem cartao. So roda se o secret
// TRAVELPAYOUTS_TOKEN existir - sem ele o monitor ignora esta fonte em
// silencio e segue com Google Flights + feeds.
//
// Vantagem: JSON limpo, sem scraping, e devolve o dia mais barato de cada mes.

const { pausa, log } = require('../util');

const BASE = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

async function porMes(origem, destino, mes, token) {
  const url = `${BASE}?origin=${origem}&destination=${destino}&currency=brl` +
              `&departure_at=${mes}&one_way=true&sorting=price&limit=5&market=br`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'X-Access-Token': token, Accept: 'application/json' } });
    if (!r.ok) return { ok: false, erro: `HTTP ${r.status}` };
    const j = await r.json();
    if (!j || !Array.isArray(j.data)) return { ok: false, erro: 'resposta sem data[]' };
    return { ok: true, voos: j.data };
  } catch (e) {
    return { ok: false, erro: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}

// Meses YYYY-MM cobrindo o horizonte configurado.
function meses(diasMin, diasMax) {
  const out = new Set();
  for (let d = diasMin; d <= diasMax; d += 15) {
    const dt = new Date(Date.now() + d * 86400000);
    out.add(dt.toISOString().slice(0, 7));
  }
  return [...out];
}

async function coletar(rotas, grupos, cfgHorizonte, token) {
  const observacoes = [];
  const falhas = [];
  if (!token) return { observacoes, falhas, pulado: 'sem TRAVELPAYOUTS_TOKEN' };

  for (const rota of rotas) {
    const h = cfgHorizonte[String(rota.prioridade)] || cfgHorizonte['1'];
    const origens = grupos[rota.de];
    const destinos = grupos[rota.para];
    for (const o of origens) {
      for (const d of destinos) {
        for (const mes of meses(h.diasMin, h.diasMax)) {
          const r = await porMes(o, d, mes, token);
          if (!r.ok) { falhas.push({ rota: rota.id, par: `${o}-${d}`, mes, erro: r.erro }); await pausa(400); continue; }
          for (const v of r.voos) {
            observacoes.push({
              fonte: 'travelpayouts',
              rotaId: rota.id,
              de: v.origin || o,
              para: v.destination || d,
              data: (v.departure_at || '').slice(0, 10),
              precoBRL: Number(v.price),
              moeda: 'BRL',
              cias: v.airline ? [v.airline] : [],
              paradas: v.transfers,
              link: v.link ? `https://www.aviasales.com${v.link}` : null,
              coletadoEm: new Date().toISOString()
            });
          }
          await pausa(400);
        }
      }
    }
    log(`  travelpayouts: ${rota.id} ok`);
  }
  return { observacoes, falhas };
}

module.exports = { coletar };
