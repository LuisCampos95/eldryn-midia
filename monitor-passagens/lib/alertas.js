// Regras de alerta.
//
// Teto fixo sozinho e ruim: ou nunca dispara, ou dispara toda hora quando o
// mercado sobe. As outras duas regras comparam o preco com a historia da
// propria rota, entao se calibram sozinhas.

const { percentil, mediana, brl } = require('./util');

function janela(historico, rotaId, dias) {
  const limite = Date.now() - dias * 86400000;
  return historico.filter((o) => o.rotaId === rotaId &&
                                 typeof o.precoBRL === 'number' &&
                                 Date.parse(o.coletadoEm) >= limite);
}

function avaliar(obs, historico, cfg, rota) {
  const motivos = [];
  const a = cfg.alertas;

  // 1) abaixo do teto que voce definiu pra rota
  if (rota && typeof rota.tetoBRL === 'number' && obs.precoBRL <= rota.tetoBRL) {
    motivos.push({ tipo: 'teto', texto: `abaixo do seu teto de ${brl(rota.tetoBRL)}` });
  }

  // 2) entre os X% mais baratos ja vistos na rota
  const daRota = janela(historico, obs.rotaId, a.janelaHistoricoDias).map((o) => o.precoBRL);
  if (daRota.length >= a.minObservacoesParaPercentil) {
    const p = percentil(daRota, a.percentilAlvo);
    if (obs.precoBRL <= p) {
      motivos.push({
        tipo: 'percentil',
        texto: `entre os ${a.percentilAlvo}% mais baratos dos ultimos ${a.janelaHistoricoDias} dias ` +
               `(p${a.percentilAlvo} = ${brl(Math.round(p))}, base de ${daRota.length} leituras)`
      });
    }
  }

  // 3) queda forte contra a mediana recente da MESMA data de voo
  const mesmaData = janela(historico, obs.rotaId, 7).filter((o) => o.data === obs.data).map((o) => o.precoBRL);
  if (mesmaData.length >= 3) {
    const med = mediana(mesmaData);
    const queda = ((med - obs.precoBRL) / med) * 100;
    if (queda >= a.quedaMinimaPct) {
      motivos.push({
        tipo: 'queda',
        texto: `caiu ${Math.round(queda)}% em 7 dias para esse voo (mediana era ${brl(Math.round(med))})`
      });
    }
  }

  return motivos;
}

// Quantas milhas LATAM Pass valeriam a pena por esse preco, dado o valor que
// voce atribui ao milheiro. Acima disso, pague em dinheiro.
function tetoDeMilhas(precoBRL, cfgMilhas) {
  const liquido = precoBRL - cfgMilhas.taxaEmbarqueEstimadaBRL;
  if (liquido <= 0) return null;
  return Math.round((liquido / cfgMilhas.valorPorMilheiroBRL) * 1000 / 500) * 500;
}

function gerar(observacoes, historico, cfg, rotasPorId) {
  const alertas = [];
  for (const obs of observacoes) {
    if (typeof obs.precoBRL !== 'number') continue;
    const motivos = avaliar(obs, historico, cfg, rotasPorId[obs.rotaId]);
    if (!motivos.length) continue;
    alertas.push({
      chave: `${obs.rotaId}|${obs.data}|${Math.round(obs.precoBRL / 25) * 25}`,
      obs,
      motivos,
      forca: motivos.length,
      milhasMax: tetoDeMilhas(obs.precoBRL, cfg.milhas)
    });
  }
  alertas.sort((a, b) => (b.forca - a.forca) || (a.obs.precoBRL - b.obs.precoBRL));
  return alertas;
}

function gerarDeFeeds(achados) {
  return achados.map((f) => ({
    chave: `feed|${f.link}`,
    feed: f,
    motivos: [{ tipo: 'feed', texto: f.ehMilhas ? 'promocao de milhas/pontos' : 'promocao publicada' }],
    forca: f.ehMilhas ? 2 : 1
  }));
}

// Nao repetir o mesmo alerta a cada 6 horas.
function filtrarNovos(alertas, estado, cooldownHoras) {
  const agora = Date.now();
  const limite = cooldownHoras * 3600 * 1000;
  const novos = [];
  for (const al of alertas) {
    const visto = estado.alertas[al.chave];
    if (visto && (agora - visto) < limite) continue;
    estado.alertas[al.chave] = agora;
    novos.push(al);
  }
  // limpeza: nao deixa o estado crescer pra sempre
  for (const [k, v] of Object.entries(estado.alertas)) {
    if (agora - v > 30 * 86400000) delete estado.alertas[k];
  }
  return novos;
}

module.exports = { gerar, gerarDeFeeds, filtrarNovos, avaliar, tetoDeMilhas };
