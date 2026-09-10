// Fonte: Google Flights (gratuito, sem chave, sem cadastro).
//
// Duas estrategias, porque nenhuma das duas e API oficial e qualquer uma pode
// quebrar sozinha:
//   `tfs` -> parametro protobuf/base64 que o proprio Google usa. Preciso:
//            aceita varios aeroportos de origem e destino numa consulta so.
//   `q`   -> busca em linguagem natural ("flights from MVD to Sao Paulo on ...").
//            Menos preciso, mas sobrevive a mudanca de schema do protobuf.
//
// O modo diagnostico testa as duas e diz qual esta respondendo hoje.

const { campoInt, campoString, campoMensagem, base64url } = require('../protobuf');
const { pausa, log, semAcento } = require('../util');
const itinerario = require('./itinerario');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CIAS = [
  'LATAM', 'Gol', 'Azul', 'Aerolineas Argentinas', 'Aerolíneas Argentinas',
  'JetSMART', 'Flybondi', 'Sky Airline', 'Copa', 'Paranair', 'Avianca', 'Iberia',
  'Air Europa', 'American', 'United', 'Delta', 'TAP'
];

// --- montagem do tfs -------------------------------------------------------

// O schema do Google nao e publico. Testamos as duas formas plausiveis no
// runner: a plana funciona, a aninhada num wrapper (campo 1) cai na home sem
// preco nenhum. Fica a plana; a outra sobra so pro diagnostico, pra flagrar
// se um dia o Google trocar.
function aeroporto(codigo, aninhado) {
  const dentro = campoString(2, codigo);
  return aninhado ? campoMensagem(1, dentro) : dentro;
}

function trecho(data, origens, destinos, maxParadas, aninhado) {
  // message FlightData { string data = 2; int max_paradas = 5;
  //                      repeated Airport de = 13; repeated Airport para = 14; }
  const partes = [campoString(2, data)];
  if (typeof maxParadas === 'number') partes.push(campoInt(5, maxParadas));
  for (const o of origens) partes.push(campoMensagem(13, aeroporto(o, aninhado)));
  for (const d of destinos) partes.push(campoMensagem(14, aeroporto(d, aninhado)));
  return Buffer.concat(partes);
}

function montarTfs({ data, dataVolta, origens, destinos, maxParadas }, aninhado = false) {
  // message Info { repeated FlightData trechos = 3; repeated int pax = 8;
  //                int cabine = 9; int tipo = 19; }
  // tipo: 1 = ida e volta (dois trechos), 2 = so ida
  const trechos = [campoMensagem(3, trecho(data, origens, destinos, maxParadas, aninhado))];
  if (dataVolta) {
    trechos.push(campoMensagem(3, trecho(dataVolta, destinos, origens, maxParadas, aninhado)));
  }
  const info = Buffer.concat([
    ...trechos,
    campoInt(8, 1),                    // 1 adulto
    campoInt(9, 1),                    // economica
    campoInt(19, dataVolta ? 1 : 2)
  ]);
  return base64url(info);
}

function urlTfs({ data, dataVolta, origens, destinos, maxParadas }, aninhado = false) {
  const tfs = montarTfs({ data, dataVolta, origens, destinos, maxParadas }, aninhado);
  // O `tfu` nao e enfeite: sem ele o Google devolve a pagina montada mas nao
  // executa a busca, e nao vem preco nenhum (testado no runner, 1.8MB e zero
  // R$). Com ele a busca roda - mas a pagina vem com a grade de datas
  // vizinhas junto (~750 precos em vez de ~60), entao o menor preco da pagina
  // pode ser de outro dia. Por isso leitura via tfs entra como precisao baixa.
  return 'https://www.google.com/travel/flights?tfs=' + encodeURIComponent(tfs) +
         '&tfu=EgQIABABIgA&hl=pt-BR&gl=BR&curr=BRL';
}

// A frase importa. 'on D1 returning D2' o Google nao entende: na primeira
// rodada de ida e volta as 74 leituras cairam todas na estrategia reserva e o
// painel saiu vazio. Entao ha varias formas, testadas em ordem, e o
// diagnostico mede qual delas devolve preco.
const FRASES_IDA_VOLTA = [
  (de, para, d1, d2) => `flights from ${de} to ${para} ${d1} through ${d2}`,
  (de, para, d1, d2) => `round trip flights from ${de} to ${para} departing ${d1} returning ${d2}`,
  (de, para, d1, d2) => `flights from ${de} to ${para} on ${d1} through ${d2}`,
  (de, para, d1, d2) => `${de} to ${para} ${d1} to ${d2}`,
  (de, para, d1, d2) => `flights from ${de} to ${para} on ${d1} returning ${d2}`
];

function frase({ data, dataVolta, cidadeOrigem, cidadeDestino, origens, destinos }, variante = 0) {
  const de = cidadeOrigem || origens[0];
  const para = cidadeDestino || destinos[0];
  if (!dataVolta) return `flights from ${de} to ${para} on ${data} one way`;
  const f = FRASES_IDA_VOLTA[variante % FRASES_IDA_VOLTA.length];
  return f(de, para, data, dataVolta);
}

function urlQuery(consulta, variante = 0) {
  return 'https://www.google.com/travel/flights?q=' + encodeURIComponent(frase(consulta, variante)) +
         '&hl=pt-BR&gl=BR&curr=BRL';
}

// Consulta so de ida da mesma rota - rede de seguranca pra quando nenhuma
// frase de ida e volta funcionar: melhor um preco de ida rotulado como ida
// do que painel vazio.
function soIda(consulta) {
  return { ...consulta, dataVolta: null, noites: null };
}

// --- leitura da pagina -----------------------------------------------------

// A pagina mistura espaco comum, nbsp como caractere (\u00a0), espaco fino
// (\u202f) e a entidade &nbsp;. Uniformizar antes de qualquer casamento por
// texto, senao busca literal falha onde a regex com \s passaria.
function normalizarEspacos(html) {
  return html.replace(/&nbsp;|&#160;|[\u00a0\u202f\u2009]/g, ' ');
}

// A pagina vem com precos em pt-BR: "R$ 1.234" ou "R$ 1.234,00".
function extrairPrecos(html) {
  const limpo = html.replace(/&nbsp;| | /g, ' ');
  const achados = [];
  const re = /R\$\s?([\d]{1,3}(?:\.\d{3})*(?:,\d{2})?)\b/g;
  let m;
  while ((m = re.exec(limpo)) !== null) {
    const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n) && n >= 60 && n <= 60000) achados.push(n);
  }
  return achados;
}

// Pegar o menor "R$ N" da pagina estava dando preco que nao existe
// (Montevideu-Miami por R$ 302). A distribuicao real, medida no runner,
// mostrou dois defeitos distintos:
//
//   MVD-MIA  1838 x1, depois 3232 x6   -> o minimo era um numero perdido
//   MVD-OPO   374 x6, mediana 709      -> a pagina inteira nao tinha resultado
//                                          (30 precos, contra 66 das que funcionam;
//                                           e o mesmo 374 aparecia em outra rota)
//
// Dai duas regras, cada uma atacando um dos defeitos.

// 1) Preco de itinerario real se REPETE: o Google renderiza o mesmo valor em
//    "melhores voos" e em "todos os voos". Numero perdido aparece uma vez so.
//    Entao o menor preco que aparece pelo menos duas vezes.
const MIN_REPETICOES = 2;

// 2) Pagina que devolve poucos precos nao trouxe resultado de verdade: ela cai
//    num modulo de sugestoes, cujos numeros nao sao da rota buscada. As rotas
//    que funcionam vem com 54-67; as quebradas, com 30.
const MIN_PRECOS_NA_PAGINA = 40;

function precoConfiavel(precos) {
  if (precos.length < MIN_PRECOS_NA_PAGINA) {
    return { erro: `pagina com so ${precos.length} precos (minimo ${MIN_PRECOS_NA_PAGINA}): ` +
                   'provavelmente sem resultado real pra essa rota' };
  }
  const vezes = new Map();
  for (const p of precos) vezes.set(p, (vezes.get(p) || 0) + 1);

  const repetidos = [...vezes.entries()]
    .filter(([, n]) => n >= MIN_REPETICOES)
    .map(([p]) => p)
    .sort((a, b) => a - b);

  if (!repetidos.length) {
    return { erro: 'nenhum preco se repete na pagina: nada confiavel pra ler' };
  }
  const ordenados = precos.slice().sort((a, b) => a - b);
  return {
    preco: repetidos[0],
    descartadosAbaixo: ordenados.filter((p) => p < repetidos[0]).length,
    mediana: ordenados[Math.floor(ordenados.length / 2)]
  };
}

function extrairCias(html) {
  const achadas = new Set();
  for (const cia of CIAS) {
    if (html.includes(cia)) achadas.add(semAcento(cia));
  }
  return [...achadas];
}

// Filtro estatistico e remendo: ele adivinha qual numero e passagem em vez de
// saber. Pra consertar na raiz precisamos ancorar a leitura no elemento que
// carrega o preco do itinerario - e pra isso precisamos ver esse elemento.
// Devolve o trecho de HTML em volta de um preco, pra achar o ancoradouro.
function contexto(html, preco, largura = 260) {
  const limpo = normalizarEspacos(html);
  // indexOf com espaco ASCII nao acha "R$<nbsp>1.380" - por isso a primeira
  // versao deste diagnostico voltou '(nao encontrado)' enquanto extrairPrecos
  // funcionava: la o \s da regex ja casava com o nbsp.
  const num = preco.toLocaleString('pt-BR').replace(/\./g, '\\.');
  const m = new RegExp('R\\$\\s?' + num + '(?![\\d.,])').exec(limpo);
  if (!m) return null;
  const i = m.index;
  return limpo.slice(Math.max(0, i - largura), i + 80).replace(/\s+/g, ' ');
}

function pareceBloqueio(html) {
  if (!html || html.length < 8000) return 'pagina curta demais (' + (html ? html.length : 0) + ' bytes)';
  if (/consent\.google\.com|Antes de continuar|Before you continue/i.test(html)) return 'muro de consentimento';
  if (/unusual traffic|trafego incomum|nossos sistemas detectaram/i.test(html)) return 'bloqueio por trafego incomum';
  if (/captcha/i.test(html) && html.length < 60000) return 'captcha';
  return null;
}

async function buscarUrl(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        // sem esse cookie o Google europeu/latam devolve o muro de consentimento
        'Cookie': 'CONSENT=YES+cb.20240101-00-p0.pt+FX+111; SOCS=CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAnB0IAEaBgiA_LyuBg'
      }
    });
    const html = await r.text();
    return { status: r.status, html };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Consulta uma data para uma rota. Devolve { ok, preco, precos, cias, url, erro }.
 */
/**
 * Le UMA pagina ja baixada e devolve a leitura, ou { erro }.
 *
 * Funcao pura de proposito: e aqui que mora toda a decisao (estrutural x
 * estatistica, preco, cia, voos), e sem rede da pra testar cada caminho.
 * Quando isso vivia dentro do consultar(), um `precos` fora de escopo passou
 * pelo `node --check` e so apareceu em producao, zerando a coleta inteira.
 */
function lerPagina(html, estrategia, consulta) {
  const bloqueio = pareceBloqueio(html);
  if (bloqueio) return { erro: bloqueio };

  // 1) Leitura estrutural: ancora no aria-label do itinerario. Precisa por
  //    construcao - so itinerario tem esse rotulo - e traz voo e companhia
  //    junto. E o caminho bom.
  const itens = itinerario.extrair(html);
  const melhor = itinerario.maisBarato(itens);

  // 2) So se a estrutura mudar e a leitura estrutural nao achar nada, cai pro
  //    caminho antigo, que adivinha por estatistica qual numero da pagina e
  //    passagem. Rede, nao padrao.
  let leitura;
  let precos = [];
  let semVoo = false;
  const viaEstrutura = Boolean(melhor);

  if (viaEstrutura) {
    const ordenados = itens.map((i) => i.precoBRL).sort((a, b) => a - b);
    leitura = { preco: melhor.precoBRL, descartadosAbaixo: 0,
                mediana: ordenados[Math.floor(ordenados.length / 2)] };
    // Nenhum item da pagina tinha voo: o preco existe, mas nao da pra dizer
    // que e um itinerario de ida e volta. Fica no historico, fora do ranking.
    if (!melhor.voos.length) semVoo = true;
  } else {
    precos = extrairPrecos(html);
    if (precos.length === 0) return { erro: `nenhum preco na pagina (${html.length} bytes)` };
    leitura = precoConfiavel(precos);
    if (leitura.erro) return leitura;
  }

  return {
    ok: true,
    estrategia,
    tipoTarifa: (estrategia === 'q-ida' || !consulta.dataVolta) ? 'ida' : 'ida-e-volta',
    precisao: (estrategia === 'q' && !semVoo) ? 'alta' : 'baixa',
    leitura: viaEstrutura ? 'estrutural' : 'estatistica',
    preco: leitura.preco,
    precoMediana: leitura.mediana,
    descartadosAbaixo: leitura.descartadosAbaixo,
    // cia da TARIFA, do data-gs do itinerario. Vazio quando a leitura caiu na
    // rede estatistica - melhor vazio que a lista de nomes citados na pagina.
    cias: viaEstrutura ? melhor.cias : [],
    voos: viaEstrutura ? melhor.voos : [],
    trechos: viaEstrutura ? melhor.trechos : null,
    itinerarios: itens.length,
    precos: precos.slice(0, 60),
    amostras: viaEstrutura ? itens.length : precos.length
  };
}

async function consultar(consulta, opcoes = {}) {
  const timeoutMs = opcoes.timeoutMs || 25000;
  // ordem: as frases de ida e volta, depois o tfs, e por ultimo a ida como
  // rede de seguranca. Uma leitura de ida rotulada honestamente vale mais
  // que painel vazio.
  const estrategias = opcoes.estrategia
    ? [opcoes.estrategia]
    : consulta.dataVolta ? ['q', 'q2', 'q3', 'tfs', 'q-ida'] : ['q', 'tfs'];

  let ultimoErro = null;
  for (const estrategia of estrategias) {
    const variante = estrategia === 'q2' ? 1 : estrategia === 'q3' ? 2 : (opcoes.varianteFrase || 0);
    const url = estrategia === 'tfs' ? urlTfs(consulta, false)
              : estrategia === 'tfs-aninhado' ? urlTfs(consulta, true)
              : estrategia === 'q-ida' ? urlQuery(soIda(consulta))
              : urlQuery(consulta, variante);
    try {
      const { status, html } = await buscarUrl(url, timeoutMs);
      if (status !== 200) { ultimoErro = `HTTP ${status} (${estrategia})`; continue; }

      const lido = lerPagina(html, estrategia, consulta);
      if (lido.erro) { ultimoErro = `${lido.erro} (${estrategia})`; continue; }
      return { ...lido, url };
    } catch (e) {
      ultimoErro = `${e.name === 'AbortError' ? 'timeout' : e.message} (${estrategia})`;
    }
    await pausa(800);
  }
  return { ok: false, erro: ultimoErro || 'falha desconhecida' };
}

/**
 * Varre todas as consultas de uma rodada. `consultas` vem do planejador.
 */
/**
 * Monta a observacao a partir da consulta e da leitura.
 *
 * Pura, e por um motivo aprendido do jeito ruim: quando isto vivia solto
 * dentro do coletor, uma edicao minha mirou num texto que eu ja tinha
 * reescrito, virou no-op silencioso, e os campos de companhia e voos
 * simplesmente nunca chegaram na observacao. O painel saiu com a coluna
 * vazia e nada acusou. Agora ha teste conferindo o objeto inteiro.
 */
function montarObservacao(c, r) {
  const idaEVolta = Boolean(c.dataVolta);
  const voado = c.distanciaKm ? c.distanciaKm * (idaEVolta ? 2 : 1) : null;
  return {
    fonte: 'google-flights',
    estrategia: r.estrategia,
    leitura: r.leitura,
    rotaId: c.rotaId,
    origem: c.rotaId.split('-')[0],
    regiao: c.regiao,
    distanciaKm: c.distanciaKm,
    // Distancia VOADA: ida e volta percorre o dobro. Sem isso um preco de ida
    // e volta pareceria o dobro de caro por km que um de so ida, e as duas
    // leituras nao poderiam dividir a mesma lista - que e exatamente o que a
    // rede de seguranca produz quando cai pra so ida.
    distanciaVoadaKm: voado,
    precoPorKm: voado ? Number((r.preco / voado).toFixed(3)) : null,
    de: c.origens.join('/'),
    para: c.destinos.join('/'),
    data: c.data,
    dataVolta: c.dataVolta || null,
    noites: c.noites || null,
    precoBRL: r.preco,
    precoMedianaBRL: r.precoMediana,
    precisao: r.precisao,
    tipoTarifa: r.tipoTarifa,
    // companhia e voos da TARIFA, quando a leitura foi estrutural
    cias: r.cias || [],
    voos: r.voos || [],
    trechos: r.trechos != null ? r.trechos : null,
    moeda: 'BRL',
    amostrasNaPagina: r.amostras,
    link: r.url,
    coletadoEm: new Date().toISOString()
  };
}

async function coletar(consultas, cfg, opcoes = {}) {
  const observacoes = [];
  const falhas = [];
  let i = 0;

  for (const c of consultas) {
    i++;
    const r = await consultar(c, { timeoutMs: cfg.timeoutMs, estrategia: opcoes.estrategia });
    if (r.ok) {
      observacoes.push(montarObservacao(c, r));
      log(`  [${i}/${consultas.length}] ${c.rotaId} ${c.data}${c.dataVolta ? `/${c.dataVolta.slice(5)}` : ''} -> R$ ${r.preco}` +
          (c.distanciaKm ? ` (${(r.preco / c.distanciaKm).toFixed(2)}/km)` : '') +
          (r.cias && r.cias.length ? ` ${r.cias.join('+')}` : '') +
          (r.voos && r.voos.length ? ` ${r.voos.join('/')}` : '') +
          ` [${r.estrategia}/${r.tipoTarifa}/${r.leitura}` +
          `${r.precisao === 'baixa' ? ', precisao baixa' : ''}` +
          `${r.descartadosAbaixo ? `, ${r.descartadosAbaixo} outlier(s)` : ''}]`);
    } else {
      falhas.push({ rotaId: c.rotaId, data: c.data, erro: r.erro });
      log(`  [${i}/${consultas.length}] ${c.rotaId} ${c.data} -> FALHOU: ${r.erro}`);
    }
    if (i < consultas.length) await pausa(cfg.pausaMs || 2200);
  }

  return { observacoes, falhas };
}

module.exports = { coletar, consultar, montarTfs, urlTfs, urlQuery, extrairPrecos, precoConfiavel, contexto, buscarUrl, urlQuery, frase, FRASES_IDA_VOLTA, lerPagina, montarObservacao };
