// Varre nicks de 3 caracteres do Hytale e grava em nicks/ os que estao
// livres pra registrar.
//
// Historico: a v1 (so PlayerDB) deu falso-livre - kkk, bob e outros
// apareceram livres estando reservados, porque o PlayerDB so enxerga
// conta criada. A v2 qualificava fontes mas so lia corpo JSON. A sonda
// da v2 achou no codigo-fonte do proprio hytale.tools (repo publico
// hytale-tools/api, src/index.ts) a fonte da verdade:
//
//   fetch('https://accounts.hytale.com/api/account/username-reservations/'
//     + 'availability?username=...')  ->  disponivel = resposta 200
//
// ou seja, semantica por STATUS HTTP, sem corpo. So que a chamada direta
// do runner recebeu o HTML do SPA (200 pra tudo) - depende de cabecalho/
// roteamento. Entao a v3 qualifica uma MATRIZ: caminhos oficiais (host do
// site e host backend.accounts descoberto) x jogos de cabecalho, alem das
// candidatas JSON da comunidade. Controles continuam mandando: kkk e bob
// (Luis conferiu que estao indisponiveis em 01/09/2026), kry e
// cherryjimbo precisam sair ocupados, e a amostra aleatoria precisa ter
// algum livre. Sem fonte qualificada -> grava nicks/diagnostico.md e
// falha sem lista errada.

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const SAIDA = path.join(RAIZ, 'nicks');
const UA_NAVEGADOR = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CHARSET = (process.env.CHARSET || 'letras+numeros').toLowerCase().trim();
const MAX_RPS = Math.max(1, Math.min(15, Number(process.env.MAX_RPS) || 8));
const TRABALHADORES = Math.max(2, Math.min(12, Math.round(MAX_RPS)));

const LETRAS = 'abcdefghijklmnopqrstuvwxyz';
const NUMEROS = '0123456789';

// Nicks que com certeza NAO estao livres (fonte que discordar esta errada).
const CONTROLES_OCUPADOS = ['kkk', 'bob', 'kry', 'cherryjimbo'];

// Caminhos oficiais (semantica por status: 200 = livre), como no codigo do
// hytale.tools. O segundo/terceiro usam o host backend.accounts.hytale.com
// que a sonda achou (e um Ory Kratos; o SPA fica no accounts.hytale.com).
const CAMINHOS_STATUS = [
  'https://accounts.hytale.com/api/account/username-reservations/availability?username={n}',
  'https://backend.accounts.hytale.com/api/account/username-reservations/availability?username={n}',
  'https://backend.accounts.hytale.com/account/username-reservations/availability?username={n}',
];
const JOGOS_CABECALHO = [
  ['servidor', { 'User-Agent': 'Bun/1.2 eldryn-midia-verifica-nicks', Accept: '*/*' }],
  ['cru', {}],
  ['xhr', { 'User-Agent': UA_NAVEGADOR, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://accounts.hytale.com/' }],
];

// Candidatas JSON da comunidade (o /check/:username existe no repo do site).
const CANDIDATAS_JSON_FIXAS = [
  'https://hytale.tools/check/{n}',
  'https://api.hytale.tools/check/{n}',
  'https://hytale.tools/api/check/{n}',
  'https://hytl.tools/api/player/{n}',
  'https://playerdb.co/api/player/hytale/{n}', // baseline v1: deve reprovar
];

const HOSTS_IGNORADOS = /github\.com|localhost|bun\.com|facebook\.github|cdn\.hytale\.com|^https:\/\/hytale\.com/i;

function montarCandidatas() {
  const lista = [];
  for (const caminho of CAMINHOS_STATUS) {
    for (const [nomeJogo, cabecalhos] of JOGOS_CABECALHO) {
      lista.push({ molde: caminho, cabecalhos, modo: 'status', nome: caminho + ' [' + nomeJogo + ']' });
    }
  }
  const vistos = new Set();
  const addJson = (molde) => {
    if (vistos.has(molde)) return;
    vistos.add(molde);
    lista.push({ molde, cabecalhos: { 'User-Agent': UA_NAVEGADOR, Accept: 'application/json' }, modo: 'json', nome: molde + ' [json]' });
  };
  // da sonda (sonda_urls.txt), filtrando lixo
  const arq = path.join(RAIZ, 'sonda_urls.txt');
  if (fs.existsSync(arq)) {
    for (let u of fs.readFileSync(arq, 'utf8').split('\n')) {
      u = u.trim().replace(/["',;)\]]+$/, '').replace(/\.$/, '');
      if (!/^https:\/\//.test(u) || HOSTS_IGNORADOS.test(u)) continue;
      if (!/api|avail|check|username|player|search|account|name/i.test(u)) continue;
      if (/\.(js|css|png|jpe?g|svg|woff2?|ico|map|webp)(\?|$)/i.test(u)) continue;
      if (/self-service|\/login/.test(u)) continue; // fluxo de login do kratos, nao e busca
      if (u.includes('{n}')) { addJson(u); continue; }
      if (/kkk|kry/i.test(u)) { addJson(u.replace(/kkk|kry/gi, '{n}')); continue; }
      const base = u.replace(/\/+$/, '');
      addJson(base + '/{n}');
      addJson(base + '?username={n}');
    }
  }
  for (const m of CANDIDATAS_JSON_FIXAS) addJson(m);
  return lista.slice(0, 45);
}

function gerarNicks() {
  const tudo = [];
  const triplas = (alfabeto) => {
    for (const a of alfabeto) for (const b of alfabeto) for (const c of alfabeto) {
      tudo.push(a + b + c);
    }
  };
  if (CHARSET === 'letras') triplas(LETRAS);
  else if (CHARSET === 'numeros') triplas(NUMEROS);
  else if (CHARSET === 'tudo') triplas(LETRAS + NUMEROS);
  else { triplas(LETRAS); triplas(NUMEROS); } // letras+numeros (padrao)
  return tudo;
}

// amostra deterministica (LCG) pra etapa 2 da qualificacao
function amostraAleatoria(qtd) {
  let s = 987654321;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const v = [];
  for (let i = 0; i < qtd; i++) {
    v.push(LETRAS[Math.floor(rnd() * 26)] + LETRAS[Math.floor(rnd() * 26)] + LETRAS[Math.floor(rnd() * 26)]);
  }
  return v;
}

function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

let vaga = Date.now();
let pausadoAte = 0;
async function minhaVez() {
  for (;;) {
    const agora = Date.now();
    if (pausadoAte > agora) { await esperar(pausadoAte - agora); continue; }
    const alvo = Math.max(vaga, agora);
    vaga = alvo + 1000 / MAX_RPS;
    if (alvo > agora) await esperar(alvo - agora);
    return;
  }
}

function interpretarJson(status, texto) {
  let json = null;
  try { json = JSON.parse(texto); } catch { /* sem JSON */ }
  if (json !== null && typeof json === 'object') {
    let disp = null;
    let estado = '';
    const anda = (o) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'boolean' && disp === null) {
          if (/avail|dispon|free|livre/i.test(k)) disp = v;
          else if (/taken|exist|registered|reserved|ocupad|in_?use/i.test(k)) disp = !v;
        } else if (typeof v === 'string' && !estado && /^(status|state|result|availability)$/i.test(k)) {
          if (/^(available|free|livre)$/i.test(v)) { estado = v.toLowerCase(); if (disp === null) disp = true; }
          else if (/taken|reserved|unavailable|blocked|registered|ocupado/i.test(v)) { estado = v.toLowerCase(); if (disp === null) disp = false; }
        } else if (v && typeof v === 'object') anda(v);
      }
    };
    anda(json);
    if (disp === null) {
      if (json.success === true && json.data && json.data.player) { disp = false; estado = 'player.found'; }
      else if (/not.?found/i.test(String(json.code || ''))) { disp = true; estado = String(json.code); }
    }
    return { disp, rotulo: estado || ('bool=' + disp) };
  }
  if (status === 404) return { disp: true, rotulo: '404-sem-json' };
  return { disp: null, rotulo: 'sem-json:' + status };
}

// Semantica do endpoint oficial (copiada do hytale.tools): 200 = livre.
// Recusas claras de negocio (404/409/410/422/400) = ocupado/reservado.
// 401/403/5xx/HTML no 200 = nao da pra afirmar (WAF, auth, queda).
function interpretarStatus(status, texto) {
  if (status === 200) {
    if (/<!doctype|<html/i.test(texto.slice(0, 200))) return { disp: null, rotulo: '200-html-spa' };
    return { disp: true, rotulo: '200' };
  }
  if ([400, 404, 409, 410, 422, 451].includes(status)) return { disp: false, rotulo: 'st' + status };
  return { disp: null, rotulo: 'st' + status };
}

let total429 = 0;
async function consultar(cand, nick, tentativa = 0, vezes429 = 0) {
  await minhaVez();
  const url = cand.molde.replace('{n}', encodeURIComponent(nick));
  let resp;
  let corpo = '';
  try {
    resp = await fetch(url, { headers: cand.cabecalhos, redirect: 'follow' });
    corpo = await resp.text();
  } catch (e) {
    if (tentativa < 3) { await esperar(1000 * 2 ** tentativa); return consultar(cand, nick, tentativa + 1, vezes429); }
    return { disp: null, rotulo: 'rede:' + e.message.slice(0, 60), status: 0, trecho: '' };
  }
  if (resp.status === 429) {
    total429 += 1;
    if (vezes429 >= 20) return { disp: null, rotulo: '429 insistente', status: 429, trecho: '' };
    const apos = Number(resp.headers.get('retry-after')) || 5;
    pausadoAte = Math.max(pausadoAte, Date.now() + apos * 1000);
    return consultar(cand, nick, tentativa, vezes429 + 1);
  }
  if (resp.status >= 500 && tentativa < 3) {
    await esperar(1000 * 2 ** tentativa);
    return consultar(cand, nick, tentativa + 1, vezes429);
  }
  const lido = cand.modo === 'status' ? interpretarStatus(resp.status, corpo) : interpretarJson(resp.status, corpo);
  return { disp: lido.disp, rotulo: lido.rotulo, status: resp.status, trecho: corpo.replace(/\s+/g, ' ').slice(0, 160) };
}

const diario = [];
function anota(linha) { console.log(linha); diario.push(linha); }
function gravarDiagnostico(extra) {
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA, 'diagnostico.md'),
    '# Diagnostico da qualificacao de fontes\n\n```\n' + diario.join('\n') + '\n```\n' + (extra || '') + '\n');
}

async function qualificar() {
  const candidatas = montarCandidatas();
  anota('candidatas: ' + candidatas.length);
  const amostra = amostraAleatoria(30);
  for (const cand of candidatas) {
    anota('--- ' + cand.nome);
    let passou = true;
    for (const nick of CONTROLES_OCUPADOS) {
      const r = await consultar(cand, nick);
      anota('    ' + nick + ' -> disp=' + r.disp + ' [' + r.status + ' ' + r.rotulo + '] ' + r.trecho.slice(0, 100));
      if (r.disp !== false) { passou = false; break; }
    }
    if (!passou) continue;
    let livresAmostra = 0;
    let nulos = 0;
    const exemplos = [];
    for (const nick of amostra) {
      const r = await consultar(cand, nick);
      if (r.disp === true) { livresAmostra += 1; if (exemplos.length < 5) exemplos.push(nick); }
      else if (r.disp === null) nulos += 1;
    }
    anota('    amostra de 30 aleatorios: livres=' + livresAmostra + ' nulos=' + nulos + ' ex-livres=' + exemplos.join(','));
    if (livresAmostra >= 2 && nulos <= 5) { anota('    QUALIFICADA'); return cand; }
    anota('    reprovada na amostra');
  }
  return null;
}

function gravar(resultado) {
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA, 'nicks_livres.json'), JSON.stringify(resultado, null, 2) + '\n');
  fs.writeFileSync(path.join(SAIDA, 'nicks_livres.txt'), resultado.livres.join('\n') + '\n');
  const md = [
    '# Nicks de 3 caracteres livres no Hytale',
    '',
    'Verificado em ' + resultado.verificado_em + ' - fonte qualificada: `' + resultado.fonte + '`',
    'Controles conferidos como indisponiveis antes da varredura: ' + CONTROLES_OCUPADOS.join(', ') + '.',
    '',
    '- Livres: **' + resultado.livres.length + '** (nicks_livres.txt tem so os nomes, um por linha)',
    '- Indisponiveis: ' + resultado.ocupados.length,
    '- Sem resposta clara: ' + resultado.desconhecidos.length,
    '',
  ];
  fs.writeFileSync(path.join(SAIDA, 'RESULTADO.md'), md.join('\n'));
}

async function principal() {
  anota('charset=' + CHARSET + ' max_rps=' + MAX_RPS + ' trabalhadores=' + TRABALHADORES);
  const fonte = await qualificar();
  gravarDiagnostico(fonte ? 'Fonte escolhida: ' + fonte.nome : 'NENHUMA fonte qualificada.');
  if (!fonte) {
    console.error('nenhuma fonte passou nos controles; nao vou gravar lista. Veja nicks/diagnostico.md');
    process.exit(1);
  }

  const nicks = gerarNicks();
  console.log(nicks.length + ' nicks pra varrer em ' + fonte.nome + ' (~' + Math.round(nicks.length / MAX_RPS / 60) + ' min)');

  const livres = [];
  const ocupados = [];
  const desconhecidos = [];
  let feitos = 0;
  let indice = 0;

  const montar = () => ({
    verificado_em: new Date().toISOString(),
    fonte: fonte.nome,
    charset: CHARSET,
    total_verificados: feitos,
    livres: [...livres].sort(),
    ocupados: [...ocupados].sort(),
    desconhecidos: [...desconhecidos].sort(),
  });

  const classificar = (nick, r) => {
    if (r.disp === true) livres.push(nick);
    else if (r.disp === false) ocupados.push(nick);
    else desconhecidos.push(nick);
  };

  const trabalhador = async () => {
    for (;;) {
      const i = indice++;
      if (i >= nicks.length) return;
      const nick = nicks[i];
      classificar(nick, await consultar(fonte, nick));
      feitos += 1;
      if (feitos % 500 === 0) {
        console.log(feitos + '/' + nicks.length + ' - livres ate agora: ' + livres.length + ' (429s: ' + total429 + ')');
        gravar(montar()); // parcial, pro caso do job morrer no meio
      }
    }
  };
  await Promise.all(Array.from({ length: TRABALHADORES }, trabalhador));

  // segunda chance pros sem resposta clara
  for (const nick of desconhecidos.splice(0)) {
    classificar(nick, await consultar(fonte, nick));
  }

  // trava final: os controles de 3 letras precisam ter saido indisponiveis
  // na varredura completa tambem, senao melhor nao gravar nada
  for (const c of ['kkk', 'bob', 'kry']) {
    if (livres.includes(c)) {
      gravarDiagnostico('ABORTADO: ' + c + ' saiu como livre na varredura completa.');
      console.error('trava final: ' + c + ' saiu livre; lista descartada.');
      process.exit(1);
    }
  }

  gravar(montar());
  console.log('fim: ' + livres.length + ' livres, ' + ocupados.length + ' indisponiveis, ' +
    desconhecidos.length + ' sem resposta (429s: ' + total429 + ')');
}

principal().catch((e) => { console.error(e); gravarDiagnostico('ERRO: ' + e.stack); process.exit(1); });
