#!/usr/bin/env node
// Testes sem rede e sem dependencia: `node teste.js`.
//
// Existem por causa de um bug especifico. A leitura da pagina vivia dentro do
// consultar(), que so roda com rede, entao nunca era exercitada aqui. Um
// `const precos` declarado dentro de um `else` e usado fora dele passou pelo
// `node --check` (e erro de execucao, nao de sintaxe), passou por um teste que
// so conferia a logica, e zerou a coleta inteira em producao: 130 consultas,
// 0 leituras.
//
// A licao virou regra: o que decide alguma coisa tem que ser funcao pura, e
// tem que ser chamada aqui com o objeto de retorno inteiro conferido.

const assert = require('assert');
const gf = require('./lib/fontes/googleflights');
const it = require('./lib/fontes/itinerario');
const alertas = require('./lib/alertas');
const catalogo = require('./lib/catalogo');
const cfg = require('./config.json');

let passou = 0;
const falhas = [];
function teste(nome, fn) {
  try { fn(); passou++; console.log('  ok   ' + nome); }
  catch (e) { falhas.push([nome, e.message]); console.log('  FALHOU ' + nome + '\n         ' + e.message); }
}

// HTML real, colhido pelo diagnostico rodando no Actions
const GS = 'CjRIcUlzU21QN1dOZTBBQU5XQXdCRy0tLS0tLS0tLXZ0dGYyMEFBQUFBR3FlX1A4RksxODBBEg1BUjEzODN8QVIxMjQwGgsIzOUOEAIaA0JSTDgdcLPxAg==';
const HTML_ITIN = '<div class="YMlIz FpEdX jLMuyc"><span data-gs="' + GS +
                  '" aria-label="2424 Reais brasileiros" role="text"></span></div>'.padEnd(9000, ' ');
const HTML_SO_PRECOS = ('<html>' + '<span>R$ 1.234</span>'.repeat(45) +
                        '<span>R$ 980</span>'.repeat(3) + '</html>').padEnd(9000, ' ');
const IDA_VOLTA = { dataVolta: '2026-09-28' };

console.log('\nleitura da pagina');

teste('caminho estrutural devolve preco, cia e voos', () => {
  const r = gf.lerPagina(HTML_ITIN, 'q', IDA_VOLTA);
  assert.strictEqual(r.erro, undefined, 'nao deveria dar erro');
  assert.strictEqual(r.preco, 2424);
  assert.strictEqual(r.leitura, 'estrutural');
  assert.deepStrictEqual(r.cias, ['Aerolineas Argentinas']);
  assert.deepStrictEqual(r.voos, ['AR1383', 'AR1240']);
  assert.strictEqual(r.trechos, 2);
  assert.strictEqual(r.tipoTarifa, 'ida-e-volta');
});

// o bug que zerou a coleta: `precos` fora de escopo no objeto de retorno.
// So aparece se o teste TOCAR o retorno inteiro, nao so o preco.
teste('objeto de retorno e montavel nos dois caminhos (o bug do precos)', () => {
  for (const [nome, html] of [['estrutural', HTML_ITIN], ['estatistica', HTML_SO_PRECOS]]) {
    const r = gf.lerPagina(html, 'q', IDA_VOLTA);
    assert.strictEqual(r.erro, undefined, nome + ': deu erro');
    assert.ok(Array.isArray(r.precos), nome + ': precos nao e array');
    assert.strictEqual(typeof r.amostras, 'number', nome + ': amostras nao e numero');
    JSON.stringify(r); // qualquer campo indefinido/circular estoura aqui
  }
});

teste('sem itinerario cai na estatistica e NAO inventa companhia', () => {
  const r = gf.lerPagina(HTML_SO_PRECOS, 'q', IDA_VOLTA);
  assert.strictEqual(r.leitura, 'estatistica');
  // 980 aparece 3x: e o MENOR que se repete, entao e ele. (Esta assercao ja
  // nasceu errada uma vez dizendo 1234 - o teste corrigiu quem escreveu.)
  assert.strictEqual(r.preco, 980);
  assert.deepStrictEqual(r.cias, [], 'cia tem que ficar vazia, nunca chutada');
});

teste('q-ida e rotulado como so ida mesmo pedindo volta', () => {
  assert.strictEqual(gf.lerPagina(HTML_ITIN, 'q-ida', IDA_VOLTA).tipoTarifa, 'ida');
});

teste('pagina sem preco nenhum devolve erro, nao leitura', () => {
  const r = gf.lerPagina('<html>'.padEnd(9000, ' '), 'q', IDA_VOLTA);
  assert.ok(r.erro, 'deveria ter erro');
  assert.strictEqual(r.ok, undefined);
});

// Este teste existe porque os campos de companhia e voos foram perdidos entre
// a leitura e a observacao: uma edicao mirou em texto ja reescrito e virou
// no-op. A leitura estava certa, o painel saiu vazio, e nada acusou.
teste('a observacao carrega companhia, voos e o tipo de leitura', () => {
  const consulta = { rotaId: 'MVD-SAO', origens: ['MVD'], destinos: ['GRU'], regiao: 'brasil',
                     distanciaKm: 1570, data: '2026-09-21', dataVolta: '2026-09-28', noites: 7 };
  const lido = gf.lerPagina(HTML_ITIN, 'q', consulta);
  const obs = gf.montarObservacao(consulta, { ...lido, url: 'https://x' });

  assert.deepStrictEqual(obs.cias, ['Aerolineas Argentinas'], 'cia sumiu no caminho');
  assert.deepStrictEqual(obs.voos, ['AR1383', 'AR1240'], 'voos sumiram no caminho');
  assert.strictEqual(obs.leitura, 'estrutural');
  assert.strictEqual(obs.trechos, 2);
  assert.strictEqual(obs.precoBRL, 2424);
  // ida e volta voa o dobro: 2424 / (1570*2)
  assert.strictEqual(obs.precoPorKm, 0.772);
  assert.strictEqual(obs.distanciaVoadaKm, 3140);
});

teste('observacao sem leitura estrutural nao inventa companhia', () => {
  const consulta = { rotaId: 'A-B', origens: ['A'], destinos: ['B'], distanciaKm: 1000,
                     data: '2026-09-21', dataVolta: '2026-09-28' };
  const obs = gf.montarObservacao(consulta, { ...gf.lerPagina(HTML_SO_PRECOS, 'q', consulta), url: 'x' });
  assert.deepStrictEqual(obs.cias, []);
  assert.strictEqual(obs.leitura, 'estatistica');
});

console.log('\nitinerario');

teste('decodifica os voos do data-gs', () => {
  assert.deepStrictEqual(it.voosDoDataGs(GS), ['AR1383', 'AR1240']);
});

teste('prefixo IATA vira nome de companhia', () => {
  assert.strictEqual(it.ciaDoVoo('AR1383'), 'Aerolineas Argentinas');
  assert.strictEqual(it.ciaDoVoo('G31234'), 'Gol');
  assert.strictEqual(it.ciaDoVoo('ZZ999'), 'ZZ', 'codigo desconhecido fica cru');
});

teste('numero solto na pagina nao vira itinerario', () => {
  assert.strictEqual(it.extrair('<span>R$ 99</span>').length, 0);
});

console.log('\nregras de alerta');

teste('teto dobra em ida e volta', () => {
  const base = { rotaId: 'MVD-JFK', origem: 'MVD', regiao: 'america-norte', data: '2026-12-10',
                 distanciaKm: 8587, coletadoEm: new Date().toISOString(), precisao: 'alta' };
  const iv = alertas.avaliar({ ...base, precoBRL: 2980, tipoTarifa: 'ida-e-volta' }, [], cfg);
  const ida = alertas.avaliar({ ...base, precoBRL: 2980, tipoTarifa: 'ida' }, [], cfg);
  assert.strictEqual(iv.length, 1, 'ida e volta a R$ 2.980 deveria disparar (teto 4.800)');
  assert.strictEqual(ida.length, 0, 'so ida a R$ 2.980 deveria calar (teto 2.400)');
});

teste('preco que raspa no teto nao acorda ninguem', () => {
  const base = { rotaId: 'MVD-JFK', origem: 'MVD', regiao: 'america-norte', data: '2026-12-10',
                 distanciaKm: 8587, coletadoEm: new Date().toISOString(), precisao: 'alta',
                 tipoTarifa: 'ida-e-volta' };
  // teto 4800 ida e volta; 15% de folga = 4080.
  assert.strictEqual(alertas.avaliar({ ...base, precoBRL: 4790 }, [], cfg).length, 0,
                     'R$ 4.790 cabe no teto mas nao e alerta');
  assert.strictEqual(alertas.avaliar({ ...base, precoBRL: 4000 }, [], cfg).length, 1,
                     'R$ 4.000 tem folga de sobra');
});

teste('leitura de precisao baixa nao gera alerta', () => {
  const obs = [{ rotaId: 'X-Y', origem: 'X', data: '2026-12-10', precoBRL: 1,
                 distanciaKm: 100, precisao: 'baixa', coletadoEm: new Date().toISOString() }];
  assert.strictEqual(alertas.gerar(obs, [], cfg).length, 0);
});

console.log('\npainel');

const painel = require('./lib/painel');
const cambio = require('./lib/cambio');

function linha(rota, precoBRL, distanciaKm) {
  return { rota, precoBRL, distanciaKm, tipoTarifa: 'ida-e-volta', data: '2026-10-21',
           dataVolta: '2026-10-28', noites: 7, precoPorKm: precoBRL / (distanciaKm * 2),
           cias: ['LATAM'], voos: ['LA1'], link: 'https://x' };
}
function painelCom(linhas) {
  return painel.gerar({ ranking: linhas, porOrigem: {}, taxas: { UYU: 7.85, USD: 0.195 },
                        cambio: cambio.converter, cidadePorId: {}, cfg,
                        resumo: { quando: 'agora', leituras: 10, paresNoCatalogo: 558, voltaEm: 7 } });
}

// O painel existe pra mostrar promocao. Mostrar passagem cara bem ordenada e
// o oposto do proposito - foi o que ele fazia, com um rotulo discreto de
// 'acima do teto'. Santiago a R$ 1.991 (teto 1.500) aparecia como sugestao.
teste('passagem acima do teto NAO entra no painel', () => {
  // 2615 km, faixa ate 3000 -> teto 750 de ida, 1500 ida e volta
  const md = painelCom([linha('SAO-SCL', 1991, 2615)]);
  assert.ok(!md.includes('SAO-SCL'), 'rota cara nao pode aparecer');
  assert.ok(md.includes('Nada barato agora'), 'deveria dizer que nao ha nada barato');
});

teste('passagem abaixo do teto entra, com a folga', () => {
  // 866 km, faixa ate 1500 -> teto 550 de ida, 1100 ida e volta
  const md = painelCom([linha('SAO-POA', 899, 866)]);
  assert.ok(md.includes('SAO-POA'), 'rota barata tem que aparecer');
  assert.ok(md.includes('18%'), 'deveria mostrar quanto esta abaixo do teto');
});

teste('mistura mostra so a barata e conta as caras', () => {
  const md = painelCom([linha('SAO-SCL', 1991, 2615), linha('SAO-POA', 899, 866),
                        linha('MVD-SCL', 1357, 1367)]);
  assert.ok(md.includes('SAO-POA'));
  assert.ok(!md.includes('SAO-SCL'), 'Santiago a 1.991 tem que sumir');
  assert.ok(!md.includes('MVD-SCL'), 'Santiago a 1.357 (teto 1.100) tambem');
  assert.ok(md.includes('Outras 2 rotas'), 'deveria dizer quantas ficaram de fora');
});

teste('a maior pechincha vem primeiro, nao a de menor preco/km', () => {
  // POA: 899 de 1100 -> 18% de folga, mas 0.52/km (voo curto custa mais por km)
  // FOR: 2200 de 2600 -> 15% de folga, e 0.28/km
  // Ordenado por folga, POA vem antes. (As duas passam da folga minima; se
  // uma delas nao passasse, o teste mediria o filtro e nao a ordem.)
  const md = painelCom([linha('MVD-FOR', 2200, 3897), linha('SAO-POA', 899, 866)]);
  assert.ok(md.includes('MVD-FOR'), 'as duas tem que estar no painel');
  assert.ok(md.indexOf('SAO-POA') < md.indexOf('MVD-FOR'),
            'a de maior folga tem que vir primeiro');
});

// O teto e o MAXIMO que ele pagaria, nao um bom preco. Sem folga minima, o
// painel listava Frankfurt a R$ 4.788 (teto 4.800) entre as pechinchas - de
// novo o "nao quero passagem cara", so que a 4.788 em vez de 1.991.
teste('raspar no teto nao conta como promocao', () => {
  // 9797 km, faixa ate 10000 -> teto 2400 de ida, 4800 ida e volta.
  const md = painelCom([linha('SAO-FRA', 4788, 9797)]);
  assert.ok(!md.includes('SAO-FRA'), 'R$ 4.788 com teto de 4.800 nao e promocao');
  assert.ok(md.includes('Nada barato agora'));
});

teste('a folga minima e a fronteira, nao o teto', () => {
  // teto 4800: 15% de folga = 4080. 4079 entra, 4081 fica de fora.
  assert.ok(painelCom([linha('SAO-FRA', 4079, 9797)]).includes('SAO-FRA'));
  assert.ok(!painelCom([linha('SAO-FRA', 4081, 9797)]).includes('SAO-FRA'));
});

console.log('\ncatalogo');

teste('distancias batem com a realidade', () => {
  const cat = catalogo.carregar();
  const pares = catalogo.pares(cat);
  const d = (id) => pares.find((p) => p.rotaId === id).distanciaKm;
  assert.ok(Math.abs(d('MVD-BUE') - 229) < 30, 'MVD-BUE ~229 km, veio ' + d('MVD-BUE'));
  assert.ok(Math.abs(d('MVD-SAO') - 1570) < 80, 'MVD-SAO ~1570 km, veio ' + d('MVD-SAO'));
  assert.ok(Math.abs(d('MVD-LHR') - 11018) < 300, 'MVD-LHR ~11018 km, veio ' + d('MVD-LHR'));
});

teste('todo destino tem coordenada, senao nao ha teto nem R$/km', () => {
  const cat = catalogo.carregar();
  const sem = cat.destinos.filter((d) => typeof d.lat !== 'number' || typeof d.lon !== 'number');
  assert.deepStrictEqual(sem.map((d) => d.id), []);
});

teste('a fila cabe no orcamento da rodada', () => {
  const cat = catalogo.carregar();
  const fila = catalogo.montarFila(cat, cfg, { rodadas: 0, cursorRodizio: 0 });
  assert.ok(fila.consultas.length <= cfg.varredura.consultasPorRodada,
            'fila com ' + fila.consultas.length + ', teto ' + cfg.varredura.consultasPorRodada);
  assert.ok(fila.consultas.every((c) => c.dataVolta), 'toda consulta tem que levar a volta');
});

console.log('\n' + passou + ' passaram, ' + falhas.length + ' falharam');
process.exit(falhas.length ? 1 : 0);
