// Origem fixa, destino aberto.
//
// 3 origens x 63 destinos = 186 pares. Varrer tudo a cada rodada levaria uns
// 25 minutos e queimaria a cota do Actions, entao a fila e dividida:
//
//   fixas   -> os destinos marcados `fixo` entram em TODAS as rodadas (o
//              triangulo MVD/SP/Buenos Aires e os vizinhos obvios)
//   rodizio -> o resto entra por fatia, e o cursor avanca a cada rodada ate
//              dar a volta. Em ~6 rodadas o catalogo inteiro foi visitado.

const fs = require('fs');
const path = require('path');
const { iso, somarDias } = require('./util');

function carregar() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'destinos.json'), 'utf8'));
}

// Distancia em linha reta. Serve pra saber se R$ 900 e barato ou caro:
// R$ 900 pra Recife e uma coisa, pra Lisboa e outra.
function distanciaKm(a, b) {
  const R = 6371;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

function tetoPorDistancia(km, faixas) {
  for (const f of faixas) if (km <= f.ateKm) return f.tetoBRL;
  return faixas[faixas.length - 1].tetoBRL;
}

function pares(cat) {
  const out = [];
  for (const o of cat.origens) {
    for (const d of cat.destinos) {
      if (d.id === o.id) continue;                 // nao adianta ir de SP pra SP
      out.push({
        rotaId: `${o.id}-${d.id}`,
        origens: o.aeroportos,
        destinos: d.aeroportos || [d.id],
        cidadeOrigem: o.cidade,
        cidadeDestino: d.cidade,
        regiao: d.regiao,
        fixo: !!d.fixo,
        distanciaKm: distanciaKm(o, d)
      });
    }
  }
  return out;
}

// Datas espalhadas pelo horizonte. O `giro` desloca todas elas a cada rodada,
// entao com o tempo o monitor cobre o calendario todo e nao so os mesmos dias.
function datas(cfg, quantas, giro) {
  const { diasMin, diasMax } = cfg;
  const vao = diasMax - diasMin;
  const passo = vao / quantas;
  const out = [];
  for (let i = 0; i < quantas; i++) {
    const dia = Math.round(diasMin + i * passo + ((giro * 5) % passo));
    out.push(iso(somarDias(new Date(), Math.min(dia, diasMax))));
  }
  return out;
}

/**
 * Monta a fila de consultas da rodada.
 * Devolve { consultas, cursor, total, cobertura }.
 */
function montarFila(cat, cfg, estado, filtroRota) {
  const v = cfg.varredura;
  const giro = estado.rodadas || 0;
  let todos = pares(cat);
  if (filtroRota) todos = todos.filter((p) => p.rotaId === filtroRota);

  const fixos = todos.filter((p) => p.fixo);
  const resto = todos.filter((p) => !p.fixo);

  const expandir = (lista, quantasDatas) => {
    const out = [];
    for (const p of lista) {
      for (const data of datas(v, quantasDatas, giro)) out.push({ ...p, data });
    }
    return out;
  };

  const consultasFixas = expandir(fixos, v.datasPorParFixo);
  const filaResto = expandir(resto, v.datasPorParRodizio);

  const espaco = Math.max(0, v.consultasPorRodada - consultasFixas.length);
  const cursor = (estado.cursorRodizio || 0) % Math.max(1, filaResto.length);

  // fatia circular: quando chega no fim do catalogo, volta pro comeco
  const fatia = [];
  for (let i = 0; i < Math.min(espaco, filaResto.length); i++) {
    fatia.push(filaResto[(cursor + i) % filaResto.length]);
  }

  return {
    consultas: [...consultasFixas, ...fatia],
    cursor: filaResto.length ? (cursor + fatia.length) % filaResto.length : 0,
    total: consultasFixas.length + filaResto.length,
    cobertura: filaResto.length ? Math.ceil(filaResto.length / Math.max(1, espaco)) : 1
  };
}

module.exports = { carregar, distanciaKm, tetoPorDistancia, pares, montarFila };
