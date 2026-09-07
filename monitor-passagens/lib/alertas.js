// Regras de alerta.
//
// Com destino aberto o problema muda: "barato" pra Buenos Aires (229 km) nao
// tem nada a ver com "barato" pra Londres (11.018 km), e uma rota nova nao
// tem historico nenhum pra comparar. Dai as quatro regras abaixo, que cobrem
// desde o primeiro dia ate quando ja existe serie.

const { percentil, mediana, brl } = require('./util');
const { tetoPorDistancia } = require('./catalogo');

function janela(historico, filtro, dias) {
  const limite = Date.now() - dias * 86400000;
  return historico.filter((o) => typeof o.precoBRL === 'number' &&
                                 o.precisao !== 'baixa' &&
                                 Date.parse(o.coletadoEm) >= limite &&
                                 filtro(o));
}

function avaliar(obs, historico, cfg) {
  const motivos = [];
  const a = cfg.alertas;

  // 1) Teto por faixa de distancia. Vale desde a primeira rodada, sem
  //    depender de historico nenhum.
  if (typeof obs.distanciaKm === 'number') {
    const teto = tetoPorDistancia(obs.distanciaKm, cfg.tetosPorDistancia);
    if (obs.precoBRL <= teto) {
      motivos.push({
        tipo: 'teto',
        texto: `abaixo do teto de ${brl(teto)} pra ${obs.distanciaKm.toLocaleString('pt-BR')} km`
      });
    }
  }

  // 2) Entre os X% mais baratos ja vistos NESSA rota. A regra mais precisa,
  //    mas so acorda depois de ~25 leituras daquela rota.
  const daRota = janela(historico, (o) => o.rotaId === obs.rotaId, a.janelaHistoricoDias)
    .map((o) => o.precoBRL);
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

  // 3) Barato PRA REGIAO. Resolve a partida a frio do destino aberto: uma rota
  //    nova nao tem historico proprio, mas "Europa" ja junta dezenas de
  //    leituras em poucos dias, entao da pra comparar com os vizinhos.
  const daRegiao = janela(historico,
    (o) => o.regiao === obs.regiao && o.origem === obs.origem, a.janelaRegiaoDias)
    .map((o) => o.precoBRL);
  if (obs.regiao && daRegiao.length >= a.minObservacoesRegiao) {
    const med = mediana(daRegiao);
    if (obs.precoBRL <= med * a.regiaoFracaoDaMediana) {
      motivos.push({
        tipo: 'regiao',
        texto: `${Math.round((1 - obs.precoBRL / med) * 100)}% abaixo da mediana de ` +
               `${obs.regiao} saindo de ${obs.origem} (${brl(Math.round(med))}, ${daRegiao.length} leituras)`
      });
    }
  }

  // 4) Queda forte no mesmo voo.
  const mesmaData = janela(historico,
    (o) => o.rotaId === obs.rotaId && o.data === obs.data, 7).map((o) => o.precoBRL);
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

function gerar(observacoes, historico, cfg) {
  const alertas = [];
  for (const obs of observacoes) {
    if (typeof obs.precoBRL !== 'number') continue;
    // leitura da estrategia reserva mistura datas: fica guardada no historico
    // pra nao perder cobertura, mas nao dispara alerta
    if (obs.precisao === 'baixa') continue;
    const motivos = avaliar(obs, historico, cfg);
    if (!motivos.length) continue;
    alertas.push({
      chave: `${obs.rotaId}|${obs.data}|${Math.round(obs.precoBRL / 25) * 25}`,
      obs,
      motivos,
      forca: motivos.length,
      milhasMax: tetoDeMilhas(obs.precoBRL, cfg.milhas)
    });
  }
  // mais motivos primeiro; empate desempata pelo preco por km, que e o jeito
  // de comparar uma pechincha pra Recife com uma pechincha pra Madri
  alertas.sort((a, b) => (b.forca - a.forca) ||
                         ((a.obs.precoPorKm || 9e9) - (b.obs.precoPorKm || 9e9)));
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

// Nao repetir o mesmo alerta a cada rodada.
function filtrarNovos(alertas, estado, cooldownHoras, maxPorRodada = Infinity) {
  const agora = Date.now();
  const limite = cooldownHoras * 3600 * 1000;
  const novos = [];
  for (const al of alertas) {
    // para de marcar ao atingir o teto da rodada: o que sobrar tem que poder
    // disparar na proxima, nao ficar 48h em silencio por causa do corte
    if (novos.length >= maxPorRodada) break;
    const visto = estado.alertas[al.chave];
    if (visto && (agora - visto) < limite) continue;
    estado.alertas[al.chave] = agora;
    novos.push(al);
  }
  for (const [k, v] of Object.entries(estado.alertas)) {
    if (agora - v > 30 * 86400000) delete estado.alertas[k];
  }
  return novos;
}

module.exports = { gerar, gerarDeFeeds, filtrarNovos, avaliar, tetoDeMilhas };
