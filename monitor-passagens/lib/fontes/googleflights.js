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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CIAS = [
  'LATAM', 'Gol', 'Azul', 'Aerolineas Argentinas', 'Aerolíneas Argentinas',
  'JetSMART', 'Flybondi', 'Sky Airline', 'Copa', 'Paranair', 'Avianca', 'Iberia',
  'Air Europa', 'American', 'United', 'Delta', 'TAP'
];

// --- montagem do tfs -------------------------------------------------------

function aeroporto(codigo) {
  // message Airport { string codigo = 2; }
  return campoMensagem(1, campoString(2, codigo));
}

function trecho(data, origens, destinos, maxParadas) {
  // message FlightData { string data = 2; int max_paradas = 5;
  //                      repeated Airport de = 13; repeated Airport para = 14; }
  const partes = [campoString(2, data)];
  if (typeof maxParadas === 'number') partes.push(campoInt(5, maxParadas));
  for (const o of origens) partes.push(campoMensagem(13, aeroporto(o)));
  for (const d of destinos) partes.push(campoMensagem(14, aeroporto(d)));
  return Buffer.concat(partes);
}

function montarTfs({ data, origens, destinos, maxParadas }) {
  // message Info { repeated FlightData trechos = 3; repeated int pax = 8;
  //                int cabine = 9; int tipo = 19; }
  const info = Buffer.concat([
    campoMensagem(3, trecho(data, origens, destinos, maxParadas)),
    campoInt(8, 1),   // 1 adulto
    campoInt(9, 1),   // economica
    campoInt(19, 2)   // so ida
  ]);
  return base64url(info);
}

function urlTfs({ data, origens, destinos, maxParadas }) {
  const tfs = montarTfs({ data, origens, destinos, maxParadas });
  return 'https://www.google.com/travel/flights?tfs=' + encodeURIComponent(tfs) +
         '&tfu=EgQIABABIgA&hl=pt-BR&gl=BR&curr=BRL';
}

function urlQuery({ data, cidadeOrigem, cidadeDestino, origens, destinos }) {
  const de = cidadeOrigem || origens[0];
  const para = cidadeDestino || destinos[0];
  const q = `flights from ${de} to ${para} on ${data} one way`;
  return 'https://www.google.com/travel/flights?q=' + encodeURIComponent(q) +
         '&hl=pt-BR&gl=BR&curr=BRL';
}

// --- leitura da pagina -----------------------------------------------------

// A pagina vem com precos em pt-BR: "R$ 1.234" ou "R$&nbsp;1.234,00".
// Pegamos todos e ficamos com o menor: o alerta e por percentil sobre a nossa
// propria serie historica, entao consistencia vale mais que exatidao absoluta.
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

function extrairCias(html) {
  const achadas = new Set();
  for (const cia of CIAS) {
    if (html.includes(cia)) achadas.add(semAcento(cia));
  }
  return [...achadas];
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
async function consultar(consulta, opcoes = {}) {
  const timeoutMs = opcoes.timeoutMs || 25000;
  const estrategias = opcoes.estrategia === 'q'
    ? ['q']
    : opcoes.estrategia === 'tfs' ? ['tfs'] : ['tfs', 'q'];

  let ultimoErro = null;
  for (const estrategia of estrategias) {
    const url = estrategia === 'tfs' ? urlTfs(consulta) : urlQuery(consulta);
    try {
      const { status, html } = await buscarUrl(url, timeoutMs);
      if (status !== 200) { ultimoErro = `HTTP ${status} (${estrategia})`; continue; }

      const bloqueio = pareceBloqueio(html);
      if (bloqueio) { ultimoErro = `${bloqueio} (${estrategia})`; continue; }

      const precos = extrairPrecos(html);
      if (precos.length === 0) { ultimoErro = `nenhum preco na pagina (${estrategia}, ${html.length} bytes)`; continue; }

      return {
        ok: true,
        estrategia,
        preco: Math.min(...precos),
        precos: precos.slice(0, 40),
        amostras: precos.length,
        cias: extrairCias(html),
        url
      };
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
async function coletar(consultas, cfg, opcoes = {}) {
  const observacoes = [];
  const falhas = [];
  let i = 0;

  for (const c of consultas) {
    i++;
    const r = await consultar(c, { timeoutMs: cfg.timeoutMs, estrategia: opcoes.estrategia });
    if (r.ok) {
      observacoes.push({
        fonte: 'google-flights',
        estrategia: r.estrategia,
        rotaId: c.rotaId,
        de: c.origens.join('/'),
        para: c.destinos.join('/'),
        data: c.data,
        precoBRL: r.preco,
        moeda: 'BRL',
        cias: r.cias,
        amostrasNaPagina: r.amostras,
        link: r.url,
        coletadoEm: new Date().toISOString()
      });
      log(`  [${i}/${consultas.length}] ${c.rotaId} ${c.data} -> R$ ${r.preco} (${r.estrategia}, ${r.amostras} precos)`);
    } else {
      falhas.push({ rotaId: c.rotaId, data: c.data, erro: r.erro });
      log(`  [${i}/${consultas.length}] ${c.rotaId} ${c.data} -> FALHOU: ${r.erro}`);
    }
    if (i < consultas.length) await pausa(cfg.pausaMs || 2200);
  }

  return { observacoes, falhas };
}

module.exports = { coletar, consultar, montarTfs, urlTfs, urlQuery, extrairPrecos };
