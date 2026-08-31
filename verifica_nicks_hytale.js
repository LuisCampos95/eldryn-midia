// Varre nicks de 3 caracteres do Hytale e grava em nicks/ os que estao
// livres pra registrar. Pedido do Luis: conferir nicks curtos disponiveis
// (estilo hytale.tools/search/KRy).
//
// Fonte: API publica do PlayerDB (playerdb.co, da Nodecraft) - a mesma
// base de dados oficial que os sites de checagem (hytale.tools, hytl.tools
// etc) consultam. "Nao registrado" aqui = livre pra criar a conta; nomes
// reservados/filtrados pela Hypixel Studios so aparecem na hora de criar a
// conta oficial, entao e "quase certeza", nao garantia.
//
// Roda no GitHub Actions (verifica_nicks.yml) porque la o runner tem rede
// aberta. Educacao com a API: ritmo global MAX_RPS (padrao 8/s) e pausa
// respeitando Retry-After quando vier 429.

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const SAIDA = path.join(RAIZ, 'nicks');
const API = 'https://playerdb.co/api/player/hytale/';
const UA = 'eldryn-midia/verifica-nicks (repo publico: github.com/LuisCampos95/eldryn-midia)';

const CHARSET = (process.env.CHARSET || 'letras+numeros').toLowerCase().trim();
const MAX_RPS = Math.max(1, Math.min(15, Number(process.env.MAX_RPS) || 8));
const TRABALHADORES = Math.max(2, Math.min(12, Math.round(MAX_RPS)));

const LETRAS = 'abcdefghijklmnopqrstuvwxyz';
const NUMEROS = '0123456789';

// Palavras de 3 letras que valem destaque se estiverem livres (pt + gamer).
const PALAVRAS = [
  'ace', 'ana', 'asa', 'ave', 'ban', 'bit', 'boi', 'bot', 'box', 'ceu',
  'cor', 'dev', 'dom', 'eco', 'elo', 'era', 'fim', 'fox', 'gel', 'gem',
  'god', 'gol', 'hex', 'ice', 'ira', 'jaz', 'jet', 'joy', 'key', 'lar',
  'lei', 'leo', 'ler', 'lol', 'lua', 'luz', 'mal', 'mar', 'max', 'mel',
  'mil', 'mob', 'mod', 'mvp', 'neo', 'net', 'nix', 'ovo', 'owl', 'pai',
  'pax', 'paz', 'pro', 'ray', 'rei', 'rex', 'rio', 'rip', 'sal', 'sea',
  'ser', 'sky', 'sol', 'som', 'sos', 'sul', 'sun', 'tnt', 'tom', 'top',
  'ufo', 'uva', 'uwu', 'vex', 'vip', 'voz', 'war', 'zap', 'zed', 'zen',
  'zip', 'zum',
];

function gerarNicks() {
  const tudo = [];
  const triplas = (alfabeto) => {
    for (const a of alfabeto) for (const b of alfabeto) for (const c of alfabeto) {
      tudo.push(a + b + c);
    }
  };
  if (CHARSET === 'teste') return ['kry', 'abc', 'zzz', '777', 'qxj', 'sol'];
  if (CHARSET === 'letras') triplas(LETRAS);
  else if (CHARSET === 'numeros') triplas(NUMEROS);
  else if (CHARSET === 'tudo') triplas(LETRAS + NUMEROS);
  else { triplas(LETRAS); triplas(NUMEROS); } // letras+numeros (padrao)
  if (!tudo.includes('kry')) tudo.push('kry'); // exemplo que o Luis buscou
  return tudo;
}

function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Ritmo global compartilhado entre os trabalhadores; pausadoAte segura
// todo mundo quando a API pede pra esperar (429).
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

let total429 = 0;
async function consultar(nick, tentativa = 0, vezes429 = 0) {
  await minhaVez();
  let resp;
  let corpo = '';
  try {
    resp = await fetch(API + encodeURIComponent(nick), {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    corpo = await resp.text();
  } catch (e) {
    if (tentativa < 4) { await esperar(1000 * 2 ** tentativa); return consultar(nick, tentativa + 1, vezes429); }
    return { estado: 'desconhecido', detalhe: 'rede: ' + e.message };
  }
  if (resp.status === 429) {
    total429 += 1;
    if (vezes429 >= 20) return { estado: 'desconhecido', detalhe: '429 insistente' };
    const apos = Number(resp.headers.get('retry-after')) || 5;
    pausadoAte = Math.max(pausadoAte, Date.now() + apos * 1000);
    return consultar(nick, tentativa, vezes429 + 1);
  }
  let json = null;
  try { json = JSON.parse(corpo); } catch { /* resposta nao-JSON cai no desconhecido */ }
  const codigo = json ? String(json.code || '') : '';
  if (json && json.success === true && json.data && json.data.player) {
    return { estado: 'ocupado', detalhe: codigo };
  }
  if (resp.status === 404 || /not.?found/i.test(codigo)) {
    return { estado: 'livre', detalhe: codigo || String(resp.status) };
  }
  if (/invalid|bad.?username|too.?short/i.test(codigo)) {
    return { estado: 'invalido', detalhe: codigo };
  }
  if (resp.status >= 500 && tentativa < 4) {
    await esperar(1000 * 2 ** tentativa);
    return consultar(nick, tentativa + 1, vezes429);
  }
  return { estado: 'desconhecido', detalhe: `${resp.status} ${corpo.slice(0, 200)}` };
}

// Se a validacao falhar, sonda outras fontes e despeja o comeco de cada
// resposta no log, pra dar pra ajustar o script sem tentar no escuro.
async function sondarAlternativas() {
  const urls = [
    API + 'cherryjimbo',
    'https://hytale.tools/search/KRy',
    'https://hytale.tools/api/search/KRy',
    'https://api.hytale.tools/search/KRy',
    'https://hytl.tools/api/player/cherryjimbo',
    'https://api.hytl.tools/player/cherryjimbo',
    'https://hystale.com/available',
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA } });
      const corpo = (await resp.text()).replace(/\s+/g, ' ').slice(0, 400);
      console.log(`[sonda] ${resp.status} ${url}\n        ${corpo}`);
    } catch (e) {
      console.log(`[sonda] ERRO ${url}: ${e.message}`);
    }
    await esperar(400);
  }
}

// Trava de seguranca: um nick que com certeza existe e um que com certeza
// nao existe. Se a API mudou de formato, melhor abortar do que entregar
// uma lista errada pro Luis comprar nick em cima.
async function validarFonte() {
  const ocupado = await consultar('cherryjimbo'); // conta real, exemplo da propria doc do PlayerDB
  const livre = await consultar('zzqjxvwqxkp'); // 11 letras aleatorias, ninguem tem
  console.log(`[controle] cherryjimbo -> ${ocupado.estado} (${ocupado.detalhe})`);
  console.log(`[controle] zzqjxvwqxkp -> ${livre.estado} (${livre.detalhe})`);
  if (ocupado.estado !== 'ocupado' || livre.estado !== 'livre') {
    console.error('[controle] a API nao respondeu como esperado; abortando pra nao gravar lista errada.');
    await sondarAlternativas();
    process.exit(1);
  }
}

function eSequencia(n) {
  const asc = LETRAS.includes(n) || NUMEROS.includes(n);
  const desc = [...n].reverse().join('');
  return asc || LETRAS.includes(desc) || NUMEROS.includes(desc);
}

function destaques(livres) {
  const tem = new Set(livres);
  const soLetras = livres.filter((n) => /^[a-z]{3}$/.test(n));
  return {
    palavras: PALAVRAS.filter((p) => tem.has(p)).sort(),
    repetidos: livres.filter((n) => n[0] === n[1] && n[1] === n[2]).sort(),
    sequencias: livres.filter((n) => eSequencia(n)).sort(),
    palindromos: livres.filter((n) => n[0] === n[2] && n[0] !== n[1]).sort(),
    pronunciaveis: soLetras.filter((n) => /^[^aeiou][aeiou][^aeiou]$/.test(n)).sort(),
  };
}

function gravar(resultado) {
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA, 'nicks_livres.json'), JSON.stringify(resultado, null, 2) + '\n');

  const d = destaques(resultado.livres);
  const lista = (v) => (v.length ? v.join(', ') : '(nenhum livre)');
  const md = [];
  md.push('# Nicks de 3 caracteres livres no Hytale');
  md.push('');
  md.push(`Verificado em ${resultado.verificado_em} via ${resultado.fonte} (charset: ${resultado.charset}).`);
  md.push('');
  md.push(`- Verificados: **${resultado.total_verificados}**`);
  md.push(`- Livres: **${resultado.livres.length}** (lista completa em nicks_livres.json)`);
  md.push(`- Ocupados: **${resultado.ocupados.length}**`);
  if (resultado.invalidos.length) md.push(`- Recusados pela API (formato): ${resultado.invalidos.length}`);
  if (resultado.desconhecidos.length) md.push(`- Sem resposta clara (re-checar): ${resultado.desconhecidos.length}`);
  md.push('');
  const kry = resultado.livres.includes('kry') ? 'LIVRE' : (resultado.ocupados.includes('kry') ? 'ocupado' : 'sem resposta clara');
  md.push(`O exemplo buscado, **KRy**: ${kry}.`);
  md.push('');
  md.push('## Destaques entre os livres');
  md.push('');
  md.push(`- Palavras: ${lista(d.palavras)}`);
  md.push(`- Repetidos (aaa, 777...): ${lista(d.repetidos)}`);
  md.push(`- Sequencias (abc, 123...): ${lista(d.sequencias)}`);
  md.push(`- Palindromos (aba, k1k...): ${d.palindromos.length > 120 ? d.palindromos.length + ' livres (ver JSON)' : lista(d.palindromos)}`);
  md.push(`- Pronunciaveis (consoante-vogal-consoante): ${d.pronunciaveis.length > 120 ? d.pronunciaveis.length + ' livres (ver JSON)' : lista(d.pronunciaveis)}`);
  md.push('');
  md.push('A checagem diz se o nick JA FOI registrado por alguem. Nomes que a');
  md.push('Hypixel Studios reservou/filtrou so aparecem na criacao da conta em');
  md.push('hytale.com - registre logo o que quiser, curto assim some rapido.');
  md.push('');
  fs.writeFileSync(path.join(SAIDA, 'RESULTADO.md'), md.join('\n'));
}

async function principal() {
  console.log(`charset=${CHARSET} max_rps=${MAX_RPS} trabalhadores=${TRABALHADORES}`);
  await validarFonte();

  const nicks = gerarNicks();
  console.log(`${nicks.length} nicks pra verificar (~${Math.round(nicks.length / MAX_RPS / 60)} min)`);

  const livres = [];
  const ocupados = [];
  const invalidos = [];
  const desconhecidos = [];
  let feitos = 0;
  let indice = 0;

  const montar = () => ({
    verificado_em: new Date().toISOString(),
    fonte: 'playerdb.co/api/player/hytale',
    charset: CHARSET,
    total_verificados: feitos,
    livres: [...livres].sort(),
    ocupados: [...ocupados].sort(),
    invalidos: [...invalidos].sort(),
    desconhecidos: [...desconhecidos].sort(),
  });

  const trabalhador = async () => {
    for (;;) {
      const i = indice++;
      if (i >= nicks.length) return;
      const nick = nicks[i];
      const r = await consultar(nick);
      if (r.estado === 'livre') livres.push(nick);
      else if (r.estado === 'ocupado') ocupados.push(nick);
      else if (r.estado === 'invalido') invalidos.push(nick);
      else { desconhecidos.push(nick); console.log(`[?] ${nick}: ${r.detalhe}`); }
      feitos += 1;
      if (feitos % 500 === 0) {
        console.log(`${feitos}/${nicks.length} - livres ate agora: ${livres.length} (429s: ${total429})`);
        gravar(montar()); // parcial, pro caso do job morrer no meio
      }
    }
  };
  await Promise.all(Array.from({ length: TRABALHADORES }, trabalhador));

  // Segunda chance pros que ficaram sem resposta clara.
  const duvidosos = desconhecidos.splice(0);
  for (const nick of duvidosos) {
    const r = await consultar(nick);
    if (r.estado === 'livre') livres.push(nick);
    else if (r.estado === 'ocupado') ocupados.push(nick);
    else if (r.estado === 'invalido') invalidos.push(nick);
    else desconhecidos.push(nick);
  }

  gravar(montar());
  console.log(`fim: ${livres.length} livres, ${ocupados.length} ocupados, ` +
    `${invalidos.length} invalidos, ${desconhecidos.length} sem resposta (429s: ${total429})`);
}

principal().catch((e) => { console.error(e); process.exit(1); });
