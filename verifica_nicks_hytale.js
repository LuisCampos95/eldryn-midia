// Varre nicks de 3 caracteres do Hytale e grava em nicks/ os que estao
// livres pra registrar.
//
// v2: a v1 usava so o PlayerDB e deu falso-livre (kkk, bob e outros
// apareceram livres mas estao indisponiveis) - o PlayerDB so enxerga
// conta criada, nao a lista de nomes reservados do Hytale. Agora o
// script QUALIFICA a fonte antes de varrer: testa cada candidata
// (inclusive as que a sonda achou no proprio hytale.tools) contra nicks
// confirmados indisponiveis - kkk e bob (conferidos pelo Luis em
// 01/09/2026), kry e cherryjimbo - e uma amostra aleatoria. So varre com
// fonte que acerta todos os controles. Se nenhuma qualificar, grava
// nicks/diagnostico.md com tudo que tentou e falha, sem lista errada.
//
// Roda no GitHub Actions (verifica_nicks.yml). Educacao: ritmo global
// MAX_RPS e pausa respeitando Retry-After em 429.

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const SAIDA = path.join(RAIZ, 'nicks');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 eldryn-midia/verifica-nicks';

const CHARSET = (process.env.CHARSET || 'letras+numeros').toLowerCase().trim();
const MAX_RPS = Math.max(1, Math.min(15, Number(process.env.MAX_RPS) || 8));
const TRABALHADORES = Math.max(2, Math.min(12, Math.round(MAX_RPS)));

const LETRAS = 'abcdefghijklmnopqrstuvwxyz';
const NUMEROS = '0123456789';

// Nicks que com certeza NAO estao livres. kkk e bob: o Luis conferiu que
// constam como indisponiveis/reservados. kry: registrado. cherryjimbo:
// conta real. Fonte que der "livre" pra qualquer um deles esta errada.
const CONTROLES_OCUPADOS = ['kkk', 'bob', 'kry', 'cherryjimbo'];

const CANDIDATAS_FIXAS = [
  'https://hytale.tools/api/search/{n}',
  'https://hytale.tools/api/username/{n}',
  'https://hytale.tools/api/check/{n}',
  'https://api.hytale.tools/search/{n}',
  'https://api.hytale.tools/username/{n}',
  'https://api.hytale.tools/check/{n}',
  'https://hytl.tools/api/player/{n}',
  'https://api.hytl.tools/player/{n}',
  'https://accounts.hytale.com/api/username/available?username={n}',
  'https://api.hytale.com/username/available?username={n}',
  'https://account-data.hytale.com/username/{n}',
  // baseline da v1: deve REPROVAR nos controles; fica aqui de sanidade
  'https://playerdb.co/api/player/hytale/{n}',
];

function candidatasDaSonda() {
  const arq = path.join(RAIZ, 'sonda_urls.txt');
  if (!fs.existsSync(arq)) return [];
  const out = new Set();
  for (let u of fs.readFileSync(arq, 'utf8').split('\n')) {
    u = u.trim().replace(/["',;)\]]+$/, '');
    if (!/^https:\/\//.test(u)) continue;
    if (!/api|avail|check|username|player|search|account|name/i.test(u)) continue;
    if (/\.(js|css|png|jpe?g|svg|woff2?|ico|map|webp)(\?|$)/i.test(u)) continue;
    if (u.includes('{n}')) { out.add(u); continue; }
    // a sonda busca por kkk e kry; se a URL ja veio com o nick, vira molde
    if (/kkk|kry/i.test(u)) { out.add(u.replace(/kkk|kry/gi, '{n}')); continue; }
    const base = u.replace(/\/+$/, '');
    out.add(base + '/{n}');
    out.add(base + '?username={n}');
  }
  return [...out].slice(0, 30);
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

// Le a resposta e tenta dizer se o nick esta disponivel (true), ocupado
// (false) ou indecifravel (null). Heuristica proposital: os controles da
// qualificacao e que dizem se a leitura presta.
function interpretarResposta(status, texto) {
  let json = null;
  try { json = JSON.parse(texto); } catch { /* sem JSON */ }
  if (json !== null && typeof json === 'object') {
    let disp = null; // primeiro veredito booleano encontrado
    let estado = ''; // primeiro rotulo textual (available/taken/reserved...)
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

let total429 = 0;
async function consultar(url, tentativa = 0, vezes429 = 0) {
  await minhaVez();
  let resp;
  let corpo = '';
  try {
    resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    corpo = await resp.text();
  } catch (e) {
    if (tentativa < 3) { await esperar(1000 * 2 ** tentativa); return consultar(url, tentativa + 1, vezes429); }
    return { disp: null, rotulo: 'rede:' + e.message.slice(0, 60), status: 0, trecho: '' };
  }
  if (resp.status === 429) {
    total429 += 1;
    if (vezes429 >= 20) return { disp: null, rotulo: '429 insistente', status: 429, trecho: '' };
    const apos = Number(resp.headers.get('retry-after')) || 5;
    pausadoAte = Math.max(pausadoAte, Date.now() + apos * 1000);
    return consultar(url, tentativa, vezes429 + 1);
  }
  if (resp.status >= 500 && tentativa < 3) {
    await esperar(1000 * 2 ** tentativa);
    return consultar(url, tentativa + 1, vezes429);
  }
  const lido = interpretarResposta(resp.status, corpo);
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
  const candidatas = [...candidatasDaSonda(), ...CANDIDATAS_FIXAS];
  anota('candidatas: ' + candidatas.length + ' (sonda: ' + candidatasDaSonda().length + ')');
  const amostra = amostraAleatoria(30);
  for (const cand of candidatas) {
    anota('--- ' + cand);
    let passou = true;
    for (const nick of CONTROLES_OCUPADOS) {
      const r = await consultar(cand.replace('{n}', nick));
      anota('    ' + nick + ' -> disp=' + r.disp + ' [' + r.status + ' ' + r.rotulo + '] ' + r.trecho.slice(0, 100));
      if (r.disp !== false) { passou = false; break; }
    }
    if (!passou) continue;
    let livresAmostra = 0;
    let nulos = 0;
    const exemplos = [];
    for (const nick of amostra) {
      const r = await consultar(cand.replace('{n}', nick));
      if (r.disp === true) { livresAmostra += 1; if (exemplos.length < 5) exemplos.push(nick); }
      else if (r.disp === null) nulos += 1;
    }
    anota('    amostra de 30 aleatorios: livres=' + livresAmostra + ' nulos=' + nulos + ' ex-livres=' + exemplos.join(','));
    // fonte que acerta os 4 controles, entende quase tudo e ainda mostra
    // algum nome livre entre aleatorios e coerente com "da pra registrar"
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
    '- Indisponiveis: ' + resultado.ocupados.length + (resultado.reservados.length ? ' (dos quais marcados reservados: ' + resultado.reservados.length + ')' : ''),
    '- Sem resposta clara: ' + resultado.desconhecidos.length,
    '',
  ];
  fs.writeFileSync(path.join(SAIDA, 'RESULTADO.md'), md.join('\n'));
}

async function principal() {
  anota('charset=' + CHARSET + ' max_rps=' + MAX_RPS + ' trabalhadores=' + TRABALHADORES);
  const fonte = await qualificar();
  gravarDiagnostico(fonte ? 'Fonte escolhida: ' + fonte : 'NENHUMA fonte qualificada.');
  if (!fonte) {
    console.error('nenhuma fonte passou nos controles; nao vou gravar lista. Veja nicks/diagnostico.md');
    process.exit(1);
  }

  const nicks = gerarNicks();
  console.log(nicks.length + ' nicks pra varrer em ' + fonte + ' (~' + Math.round(nicks.length / MAX_RPS / 60) + ' min)');

  const livres = [];
  const ocupados = [];
  const reservados = [];
  const desconhecidos = [];
  let feitos = 0;
  let indice = 0;

  const montar = () => ({
    verificado_em: new Date().toISOString(),
    fonte,
    charset: CHARSET,
    total_verificados: feitos,
    livres: [...livres].sort(),
    ocupados: [...ocupados].sort(),
    reservados: [...reservados].sort(),
    desconhecidos: [...desconhecidos].sort(),
  });

  const classificar = (nick, r) => {
    if (r.disp === true) livres.push(nick);
    else if (r.disp === false) {
      ocupados.push(nick);
      if (/reserv/i.test(r.rotulo)) reservados.push(nick);
    } else desconhecidos.push(nick);
  };

  const trabalhador = async () => {
    for (;;) {
      const i = indice++;
      if (i >= nicks.length) return;
      const nick = nicks[i];
      classificar(nick, await consultar(fonte.replace('{n}', nick)));
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
    classificar(nick, await consultar(fonte.replace('{n}', nick)));
  }

  // trava final: os controles de 3 letras precisam ter saido indisponiveis
  // na varredura tambem, senao tem coisa errada e melhor nao gravar
  for (const c of ['kkk', 'bob', 'kry']) {
    if (livres.includes(c)) {
      gravarDiagnostico('ABORTADO: ' + c + ' saiu como livre na varredura completa.');
      console.error('trava final: ' + c + ' saiu livre; lista descartada.');
      process.exit(1);
    }
  }

  gravar(montar());
  console.log('fim: ' + livres.length + ' livres, ' + ocupados.length + ' indisponiveis (' +
    reservados.length + ' reservados), ' + desconhecidos.length + ' sem resposta (429s: ' + total429 + ')');
}

principal().catch((e) => { console.error(e); gravarDiagnostico('ERRO: ' + e.stack); process.exit(1); });
