#!/usr/bin/env node
// Monitor de passagens - Montevideu / Buenos Aires / Sao Paulo.
//
//   node monitor.js                 rodada normal (coleta, grava, alerta)
//   node monitor.js --diagnostico   testa cada fonte e sai (nao grava nada)
//   node monitor.js --limite=10     limita quantas consultas de preco faz
//   node monitor.js --rota=MVD-SAO  so uma rota
//   node monitor.js --sem-alerta    coleta e grava, mas nao notifica
//   node monitor.js --estrategia=q  forca a estrategia do Google Flights
//
// Nao tem dependencia de npm de proposito: roda com o Node puro do runner.

const fs = require('fs');
const path = require('path');

const { log, brl, pausa } = require('./lib/util');
const catalogo = require('./lib/catalogo');
const painel = require('./lib/painel');
const historico = require('./lib/historico');
const alertas = require('./lib/alertas');
const notifica = require('./lib/notifica');
const cambio = require('./lib/cambio');
const googleflights = require('./lib/fontes/googleflights');
const feeds = require('./lib/fontes/feeds');
const travelpayouts = require('./lib/fontes/travelpayouts');

const RAIZ = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const CATALOGO = catalogo.carregar();
const ARQ_ESTADO = path.join(RAIZ, 'estado.json');
const ARQ_ULTIMO = path.join(RAIZ, 'ultimo.json');
const ARQ_PAINEL = path.join(RAIZ, 'RANKING.md');

function args() {
  const a = { limite: Infinity, rota: null, diagnostico: false, semAlerta: false, estrategia: null };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--diagnostico') a.diagnostico = true;
    else if (arg === '--sem-alerta') a.semAlerta = true;
    else if (arg.startsWith('--limite=')) a.limite = Number(arg.split('=')[1]);
    else if (arg.startsWith('--rota=')) a.rota = arg.split('=')[1];
    else if (arg.startsWith('--estrategia=')) a.estrategia = arg.split('=')[1];
  }
  return a;
}

function lerEstado() {
  try { return JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8')); }
  catch (_) { return { alertas: {}, feedsVistos: [], rodadas: 0, cursorRodizio: 0 }; }
}

async function diagnostico(cfg, opts) {
  log('=== DIAGNOSTICO ===\n');
  const linhas = [];

  log('1) Google Flights');
  const teste = catalogo.montarFila(CATALOGO, cfg, { rodadas: 0, cursorRodizio: 0 }, 'MVD-SAO').consultas[0];
  for (const estrategia of ['q', 'tfs', 'tfs-aninhado']) {
    const r = await googleflights.consultar(teste, { timeoutMs: cfg.googleFlights.timeoutMs, estrategia });
    if (r.ok) {
      log(`   ${estrategia}: OK  menor preco ${brl(r.preco)}  (${r.amostras} precos na pagina)  cias: ${r.cias.join(', ') || '-'}`);
      linhas.push(`google/${estrategia}: OK (${brl(r.preco)})`);
    } else {
      log(`   ${estrategia}: FALHOU -> ${r.erro}`);
      linhas.push(`google/${estrategia}: FALHOU (${r.erro})`);
    }
  }

  // O minimo da pagina se mostrou nao confiavel em rota longa (Montevideu-Miami
  // saiu a R$ 302). Pra consertar com evidencia e nao com chute, o diagnostico
  // despeja a distribuicao de precos de uma rota curta e uma longa.
  // A primeira rodada de ida e volta falhou em 74 de 74 leituras porque o
  // Google nao entende a frase que eu montei. Aqui a gente mede qual frase
  // funciona em vez de adivinhar de novo.
  log('\n1a) Frases de ida e volta (qual delas o Google entende)');
  {
    const c = catalogo.montarFila(CATALOGO, cfg, { rodadas: 0, cursorRodizio: 0 }, 'MVD-SAO').consultas[0];
    if (!c.dataVolta) {
      log('   varredura esta em so-ida, nada a testar');
    } else {
      for (let i = 0; i < googleflights.FRASES_IDA_VOLTA.length; i++) {
        const r = await googleflights.consultar(c, {
          timeoutMs: cfg.googleFlights.timeoutMs, estrategia: 'q', varianteFrase: i
        });
        const f = googleflights.frase(c, i).replace(/^flights from |^round trip flights from /, '… ');
        log(`   [${i}] ${r.ok ? 'OK   R$ ' + r.preco + ' (' + r.amostras + ' precos)' : 'FALHOU: ' + r.erro}`);
        log(`       ${f}`);
        await pausa(1800);
      }
      const rIda = await googleflights.consultar(c, { timeoutMs: cfg.googleFlights.timeoutMs, estrategia: 'q-ida' });
      log(`   [rede] so ida: ${rIda.ok ? 'OK   R$ ' + rIda.preco : 'FALHOU: ' + rIda.erro}`);
    }
  }

  log('\n1b) Distribuicao de precos na pagina (pra calibrar o filtro de outlier)');
  for (const rotaId of ['MVD-SAO', 'MVD-MIA', 'MVD-OPO']) {
    const c = catalogo.montarFila(CATALOGO, cfg, { rodadas: 0, cursorRodizio: 0 }, rotaId).consultas[0];
    if (!c) continue;
    const r = await googleflights.consultar(c, { timeoutMs: cfg.googleFlights.timeoutMs, estrategia: 'q' });
    if (!r.ok) { log(`   ${rotaId}: FALHOU -> ${r.erro}`); continue; }
    const ord = r.precos.slice().sort((a, b) => a - b);
    const q = (p) => ord[Math.floor((p / 100) * (ord.length - 1))];
    log(`   ${rotaId} (${c.distanciaKm} km, ${r.amostras} precos na pagina)`);
    log(`     12 menores: ${ord.slice(0, 12).join(', ')}`);
    log(`     min ${ord[0]} · p10 ${q(10)} · p25 ${q(25)} · mediana ${q(50)} · max ${ord[ord.length - 1]}`);
    log(`     min/mediana = ${(ord[0] / q(50)).toFixed(2)}`);
    await pausa(1500);
  }

  // O filtro estatistico e remendo. Pra consertar na raiz precisamos ver em que
  // elemento o preco do itinerario mora - dai o dump do HTML em volta dele.
  log('\n1c) Contexto do preco na pagina (pra ancorar a leitura na estrutura)');
  try {
    const c = catalogo.montarFila(CATALOGO, cfg, { rodadas: 0, cursorRodizio: 0 }, 'MVD-SAO').consultas[0];
    const { html } = await googleflights.buscarUrl(googleflights.urlQuery(c), cfg.googleFlights.timeoutMs);
    const precos = googleflights.extrairPrecos(html);
    const leitura = googleflights.precoConfiavel(precos);
    const menor = precos.slice().sort((a, b) => a - b)[0];
    for (const [rotulo, valor] of [['escolhido', leitura.preco], ['menor bruto', menor]]) {
      if (!valor) continue;
      log(`   ${rotulo} R$ ${valor}:`);
      log(`     ${(googleflights.contexto(html, valor) || '(nao encontrado)').slice(0, 260)}`);
    }
  } catch (e) {
    log(`   falhou: ${e.message}`);
  }

  log('\n2) Feeds de promocao');
  const f = await feeds.coletar(cfg.feeds);
  log(`   ${f.achados.length} itens relevantes, ${f.falhas.length} feeds com problema`);
  for (const fa of f.falhas) log(`   - ${fa.url}: ${fa.erro}`);
  for (const a of f.achados.slice(0, 5)) log(`   + ${a.titulo}`);
  linhas.push(`feeds: ${f.achados.length} relevantes, ${f.falhas.length} falhas`);

  log('\n3) Cambio');
  const t = await cambio.taxas();
  log(`   BRL->UYU ${t.UYU} · BRL->USD ${t.USD}${t.erro ? ' (erro: ' + t.erro + ')' : ''}`);
  linhas.push(`cambio: ${t.UYU ? 'OK' : 'FALHOU'}`);

  log('\n4) Travelpayouts (opcional)');
  log(process.env.TRAVELPAYOUTS_TOKEN ? '   token presente' : '   sem token - fonte desligada (normal)');

  notifica.resumoDoActions('## Diagnostico\n\n' + linhas.map((l) => `- ${l}`).join('\n'));
  log('\n=== FIM ===');
}

async function main() {
  const opts = args();
  if (opts.diagnostico) return diagnostico(CONFIG, opts);

  const estado = lerEstado();
  const taxas = await cambio.taxas();

  // --- coleta de precos ---
  const fila = catalogo.montarFila(CATALOGO, CONFIG, estado, opts.rota);
  let consultas = fila.consultas;
  if (Number.isFinite(opts.limite)) consultas = consultas.slice(0, opts.limite);
  log(`Rodada ${estado.rodadas + 1}: ${consultas.length} consultas ` +
      `(catalogo tem ${fila.total}; volta inteira a cada ~${fila.cobertura} rodadas).`);

  let obs = [];
  let falhas = [];
  if (CONFIG.googleFlights.ativo) {
    const r = await googleflights.coletar(consultas, CONFIG.googleFlights, { estrategia: opts.estrategia });
    obs = obs.concat(r.observacoes);
    falhas = falhas.concat(r.falhas);
  }
  if (CONFIG.travelpayouts.ativo && process.env.TRAVELPAYOUTS_TOKEN) {
    const rotas = opts.rota ? CONFIG.rotas.filter((r) => r.id === opts.rota) : CONFIG.rotas.filter((r) => r.prioridade === 1);
    const r = await travelpayouts.coletar(rotas, CONFIG.grupos, CONFIG.horizonte, process.env.TRAVELPAYOUTS_TOKEN);
    obs = obs.concat(r.observacoes);
    falhas = falhas.concat(r.falhas);
  }

  // --- feeds ---
  let itensFeed = [];
  if (CONFIG.feeds.ativo) {
    const r = await feeds.coletar(CONFIG.feeds);
    const vistos = new Set(estado.feedsVistos || []);
    itensFeed = r.achados.filter((a) => !vistos.has(a.link));
    estado.feedsVistos = [...new Set([...(estado.feedsVistos || []), ...r.achados.map((a) => a.link)])].slice(-500);
  }

  log(`\nColetadas ${obs.length} leituras de preco (${falhas.length} falhas) e ${itensFeed.length} promocoes novas.`);

  // --- historico e alertas ---
  const hist = historico.carregar(CONFIG.alertas.janelaHistoricoDias);

  const candidatos = [
    ...alertas.gerar(obs, hist, CONFIG),
    ...alertas.gerarDeFeeds(itensFeed)
  ];
  const novos = alertas.filtrarNovos(candidatos, estado, CONFIG.alertas.cooldownHoras,
                                     CONFIG.alertas.maxAlertasPorRodada);

  historico.gravar(obs);
  estado.rodadas = (estado.rodadas || 0) + 1;
  estado.cursorRodizio = fila.cursor;
  estado.ultimaRodadaEm = new Date().toISOString();
  fs.writeFileSync(ARQ_ESTADO, JSON.stringify(estado, null, 2) + '\n');

  // snapshot legivel do estado atual do mercado
  const melhorPorRota = {};
  for (const o of obs) {
    if (o.precisao === 'baixa') continue;
    if (!melhorPorRota[o.rotaId] || o.precoBRL < melhorPorRota[o.rotaId].precoBRL) {
      melhorPorRota[o.rotaId] = {
        precoBRL: o.precoBRL, data: o.data, dataVolta: o.dataVolta, noites: o.noites,
        tipoTarifa: o.tipoTarifa,
        distanciaKm: o.distanciaKm, precoPorKm: o.precoPorKm, regiao: o.regiao,
        ciasNaPagina: o.ciasNaPagina, link: o.link
      };
    }
  }
  // ranking por preco por km: e ele que responde "pra onde vale a pena ir agora"
  const ranking = Object.entries(melhorPorRota)
    .filter(([, m]) => m.precoPorKm)
    .sort((a, b) => a[1].precoPorKm - b[1].precoPorKm)
    .slice(0, 20);
  // melhor de cada origem, pro painel: e a pergunta real ("saindo de onde eu
  // estou, pra onde vale a pena ir agora")
  const porOrigem = {};
  for (const [id, m] of Object.entries(melhorPorRota)) {
    const origem = id.split('-')[0];
    (porOrigem[origem] = porOrigem[origem] || []).push({ rota: id, ...m });
  }
  for (const lista of Object.values(porOrigem)) {
    lista.sort((a, b) => (a.precoPorKm || 9e9) - (b.precoPorKm || 9e9));
  }

  const cidadePorId = Object.fromEntries(
    CATALOGO.destinos.map((d) => [d.id, d.cidade || d.id]));

  const md = painel.gerar({
    ranking: ranking.map(([rota, m]) => ({ rota, ...m })),
    porOrigem,
    resumo: {
      quando: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      leituras: obs.length,
      paresNoCatalogo: fila.total,
      voltaEm: fila.cobertura
    },
    taxas,
    cambio: cambio.converter,
    cidadePorId
  });
  fs.writeFileSync(ARQ_PAINEL, md + '\n');
  log(`\nPainel escrito em RANKING.md (${ranking.length} rotas no ranking).`);

  fs.writeFileSync(ARQ_ULTIMO, JSON.stringify({
    atualizadoEm: new Date().toISOString(),
    leituras: obs.length,
    falhas: falhas.length,
    cambio: taxas,
    cursorRodizio: fila.cursor,
    catalogo: { pares: fila.total, voltaEmRodadas: fila.cobertura },
    ranking: ranking.map(([id, m]) => ({ rota: id, ...m })),
    melhorPorRota
  }, null, 2) + '\n');

  // --- notificacao ---
  const baixaPrecisao = obs.filter((o) => o.precisao === 'baixa').length;
  const alertaDeSaude = obs.length && (baixaPrecisao / obs.length) > 0.3
    ? `\n> A estrategia principal do Google falhou em ${baixaPrecisao} de ${obs.length} leituras. ` +
      'Essas nao geram alerta. Rode o diagnostico: pode ser hora de ajustar o scraping.\n'
    : '';
  if (alertaDeSaude) log(alertaDeSaude.trim());

  const tabela = ranking
    .map(([id, m]) => `| ${id} | ${m.regiao || '-'} | ${m.data} | ${brl(m.precoBRL)} | ` +
                      `${m.distanciaKm.toLocaleString('pt-BR')} km | ${m.precoPorKm.toFixed(2)} |`).join('\n');
  notifica.resumoDoActions(
    `## Rodada\n\n${obs.length} leituras, ${falhas.length} falhas, ${novos.length} alertas novos.\n` +
    alertaDeSaude + '\n' +
    (tabela
      ? `### Melhores por preco/km nesta rodada\n\n` +
        `| rota | regiao | data | preco | distancia | R$/km |\n|---|---|---|---|---|---|\n${tabela}\n`
      : '_sem leitura de preco nesta rodada_\n')
  );

  if (!novos.length) { log('Nenhum alerta novo.'); return; }
  if (opts.semAlerta) { log(`${novos.length} alertas (notificacao desligada por --sem-alerta).`); return; }

  const corpo = notifica.montarCorpo(novos, taxas, cambio.converter, { observacoes: obs.length, falhas: falhas.length });
  const tit = notifica.titulo(novos);
  const issue = await notifica.abrirIssue(corpo, tit);
  log(issue.ok ? `Issue aberta: ${issue.url}` : `Falha ao abrir issue: ${issue.erro}`);
  const tg = await notifica.telegram(corpo, tit);
  if (tg.ok) log('Telegram enviado.');
}

main().catch((e) => { console.error('ERRO FATAL:', e); process.exit(1); });
