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

const { log, iso, somarDias, brl } = require('./lib/util');
const historico = require('./lib/historico');
const alertas = require('./lib/alertas');
const notifica = require('./lib/notifica');
const cambio = require('./lib/cambio');
const googleflights = require('./lib/fontes/googleflights');
const feeds = require('./lib/fontes/feeds');
const travelpayouts = require('./lib/fontes/travelpayouts');

const RAIZ = __dirname;
const CONFIG = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const ARQ_ESTADO = path.join(RAIZ, 'estado.json');
const ARQ_ULTIMO = path.join(RAIZ, 'ultimo.json');

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
  catch (_) { return { alertas: {}, feedsVistos: [], rodadas: 0 }; }
}

// Distribui as datas ao longo do horizonte, com passo por prioridade.
// Cada rodada desloca o ponto de partida (rodadas % passo) pra que, ao longo
// dos dias, o monitor acabe cobrindo todas as datas em vez de sempre as mesmas.
function planejar(cfg, estado, filtroRota) {
  const consultas = [];
  const deslocamento = (estado.rodadas || 0);
  for (const rota of cfg.rotas) {
    if (filtroRota && rota.id !== filtroRota) continue;
    const h = cfg.horizonte[String(rota.prioridade)] || cfg.horizonte['1'];
    const origens = cfg.grupos[rota.de];
    const destinos = cfg.grupos[rota.para];
    const inicio = h.diasMin + (deslocamento % h.passoDias);
    for (let d = inicio; d <= h.diasMax; d += h.passoDias) {
      consultas.push({
        rotaId: rota.id,
        origens,
        destinos,
        cidadeOrigem: cfg.cidades[rota.de],
        cidadeDestino: cfg.cidades[rota.para],
        data: iso(somarDias(new Date(), d)),
        prioridade: rota.prioridade
      });
    }
  }
  // prioridade 1 primeiro: se a rodada for cortada por --limite, corta o que importa menos
  consultas.sort((a, b) => a.prioridade - b.prioridade);
  return consultas;
}

async function diagnostico(cfg, opts) {
  log('=== DIAGNOSTICO ===\n');
  const linhas = [];

  log('1) Google Flights');
  const teste = planejar(cfg, { rodadas: 0 }, 'MVD-SAO')[0];
  for (const estrategia of ['q', 'tfs', 'tfs-plano']) {
    const r = await googleflights.consultar(teste, { timeoutMs: cfg.googleFlights.timeoutMs, estrategia });
    if (r.ok) {
      log(`   ${estrategia}: OK  menor preco ${brl(r.preco)}  (${r.amostras} precos na pagina)  cias: ${r.cias.join(', ') || '-'}`);
      linhas.push(`google/${estrategia}: OK (${brl(r.preco)})`);
    } else {
      log(`   ${estrategia}: FALHOU -> ${r.erro}`);
      linhas.push(`google/${estrategia}: FALHOU (${r.erro})`);
    }
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
  let consultas = planejar(CONFIG, estado, opts.rota);
  if (Number.isFinite(opts.limite)) consultas = consultas.slice(0, opts.limite);
  log(`Rodada ${estado.rodadas + 1}: ${consultas.length} consultas de preco.`);

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
  const rotasPorId = Object.fromEntries(CONFIG.rotas.map((r) => [r.id, r]));

  const candidatos = [
    ...alertas.gerar(obs, hist, CONFIG, rotasPorId),
    ...alertas.gerarDeFeeds(itensFeed)
  ];
  const novos = alertas.filtrarNovos(candidatos, estado, CONFIG.alertas.cooldownHoras)
    .slice(0, CONFIG.alertas.maxAlertasPorRodada);

  historico.gravar(obs);
  estado.rodadas = (estado.rodadas || 0) + 1;
  estado.ultimaRodadaEm = new Date().toISOString();
  fs.writeFileSync(ARQ_ESTADO, JSON.stringify(estado, null, 2) + '\n');

  // snapshot legivel do estado atual do mercado
  const melhorPorRota = {};
  for (const o of obs) {
    if (!melhorPorRota[o.rotaId] || o.precoBRL < melhorPorRota[o.rotaId].precoBRL) {
      melhorPorRota[o.rotaId] = { precoBRL: o.precoBRL, data: o.data, cias: o.cias, link: o.link };
    }
  }
  fs.writeFileSync(ARQ_ULTIMO, JSON.stringify({
    atualizadoEm: new Date().toISOString(),
    leituras: obs.length,
    falhas: falhas.length,
    cambio: taxas,
    melhorPorRota
  }, null, 2) + '\n');

  // --- notificacao ---
  const tabela = Object.entries(melhorPorRota)
    .map(([id, m]) => `| ${id} | ${m.data} | ${brl(m.precoBRL)} |`).join('\n');
  notifica.resumoDoActions(
    `## Rodada\n\n${obs.length} leituras, ${falhas.length} falhas, ${novos.length} alertas novos.\n\n` +
    (tabela ? `| rota | data | melhor preco |\n|---|---|---|\n${tabela}\n` : '_sem leitura de preco nesta rodada_\n')
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
