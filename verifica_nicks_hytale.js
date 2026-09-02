// Varre nicks de 3 caracteres do Hytale e grava em nicks/ os que estao
// livres pra registrar.
//
// Historico: v1 (PlayerDB) e v2/v3 (chutes de endpoint oficial) deram
// falso-livre - kkk e bob apareceram livres estando reservados. A causa:
// o PlayerDB so enxerga conta ja criada, nao a lista de reservas do
// Hytale; e o endpoint oficial do proprio Hytale (accounts.hytale.com)
// bloqueia chamada direta (devolve o SPA). A v4 usa a fonte que o
// hytale.tools DE FATO usa, capturada com um Chromium headless
// inspecionando a rede da pagina https://hytale.tools/search/{n}:
//
//   GET https://hytale.tools/_serverFn/<hash>?payload=<json>
//   -> {"status":"available"} pro livre, {"status":"reserved_by_hytale"}
//      (ou outro texto) pro indisponivel - o mesmo texto que a pagina
//      mostra em "Status: ...".
//
// Antes de varrer, qualifica essa fonte contra nicks confirmados
// indisponiveis (kkk e bob, conferidos pelo Luis em 01/09/2026; kry e
// cherryjimbo) e uma amostra aleatoria. Se o hash do _serverFn tiver
// mudado (o hytale.tools faz deploy novo), a qualificacao reprova e o
// script aborta sem gravar lista errada, em vez de adivinhar de novo.

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;
const SAIDA = path.join(RAIZ, 'nicks');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Capturado ao vivo pela sonda (sonda_rede.js) em 01/09/2026. Pode mudar
// se o hytale.tools fizer deploy novo - por isso a qualificacao roda
// sempre antes de confiar.
const HASH_SERVER_FN = 'c6e3ad339620d6a1afc87fa427d880f62ae966183f767beb52aaaf65cc91867a';

// CHARSET=letras+numeros (padrao) | letras | numeros | tudo
const CHARSET = (process.env.CHARSET || 'letras+numeros').toLowerCase().trim();
// Mais conservador que as tentativas anteriores: aqui a gente bate no
// backend de producao real do hytale.tools (o mesmo que atende usuario
// navegando o site), nao numa API dedicada a bulk. Padrao baixo de proposito.
const MAX_RPS = Math.max(1, Math.min(10, Number(process.env.MAX_RPS) || 4));
const TRABALHADORES = Math.max(2, Math.min(8, Math.round(MAX_RPS)));

const LETRAS = 'abcdefghijklmnopqrstuvwxyz';
const NUMEROS = '0123456789';

const CONTROLES_OCUPADOS = ['kkk', 'bob', 'kry', 'cherryjimbo'];

// Palavras reais de portugues e ingles (sem acento/cedilha - nick e ASCII),
// varios tamanhos; gerarNicks() filtra so as de 3-5 letras. Curada a mao,
// nao e dicionario completo.
const PALAVRAS_PT = ['sol','lua','mar','ceu','voz','paz','luz','dia','boi','cao','gato','lobo','urso','puma','onca','leao','touro','tigre','aguia','falcao','coruja','lince','raposa','cobra','sapo','peixe','aranha','abelha','formiga','borboleta','tartaruga','jacare','elefante','girafa','macaco','cavalo','vaca','porco','ovelha','cabra','galo','pato','ganso','pomba','corvo','pardal','canario','papagaio','arara','tucano','flamingo','pinguim','foca','baleia','golfinho','tubarao','polvo','lula','caranguejo','camarao','ostra','estrela','planeta','cometa','galaxia','universo','oceano','mare','onda','praia','ilha','monte','serra','vale','campo','terra','agua','fogo','vento','chuva','neve','gelo','trovao','raio','nuvem','aurora','ouro','prata','ferro','aco','cobre','bronze','jade','rubi','safira','esmeralda','topazio','ametista','cristal','diamante','granito','marmore','quartzo','dragao','fenix','grifo','unicornio','elfo','anao','gigante','troll','fada','bruxa','mago','feiticeiro','druida','guerreiro','cavaleiro','arqueiro','ladrao','assassino','heroi','vilao','rei','rainha','principe','princesa','imperador','duque','conde','barao','cacador','viking','samurai','ninja','pirata','corsario','capitao','marujo','navegador','explorador','aventureiro','viajante','nomade','forte','calmo','doce','amargo','azedo','salgado','rapido','lento','fraco','grande','pequeno','alto','baixo','largo','estreito','novo','velho','jovem','antigo','moderno','brilhante','escuro','claro','luminoso','sombrio','silencioso','macio','aspero','liso','quente','frio','morno','gelado','seco','molhado','umido','limpo','sujo','puro','sagrado','divino','celestial','selvagem','domestico','feroz','docil','pacifico','corajoso','covarde','valente','timido','orgulhoso','humilde','sabio','tolo','esperto','ingenuo','astuto','honesto','leal','traidor','generoso','gentil','cruel','amavel','hostil','amigo','inimigo','aliado','rival','parceiro','solitario','misterioso','secreto','livre','deu','oca','viu','flor','vale','abrir','falar','andar','correr','pular','nadar','voar','sonhar','viver','crer','saber','poder','querer','fazer','dizer','ver','ir','vir','dar','ficar','estar','ser','ter','haver'];
const PALAVRAS_EN = ['sun','moon','star','sky','sea','fire','wind','rain','snow','ice','frost','storm','cloud','dawn','dusk','night','light','dark','shade','shadow','glow','spark','flame','blaze','ember','ash','smoke','mist','fog','dew','tide','wave','surf','shore','beach','cliff','rock','stone','sand','dust','mud','clay','gold','iron','steel','bronze','brass','copper','silver','jade','ruby','opal','pearl','gem','crystal','glass','wolf','bear','lion','tiger','hawk','eagle','owl','crow','raven','sparrow','robin','swan','dove','falcon','phoenix','dragon','griffin','wyrm','drake','unicorn','pegasus','sphinx','hydra','kraken','troll','ogre','giant','dwarf','elf','fae','fairy','witch','mage','druid','monk','priest','cleric','paladin','knight','squire','archer','ranger','rogue','thief','ninja','samurai','viking','pirate','sailor','captain','hunter','tracker','scout','spy','agent','hero','villain','king','queen','prince','duke','earl','baron','lord','lady','sage','oracle','seer','prophet','wizard','sorcerer','warlock','shaman','healer','warrior','soldier','guard','sentry','watch','blade','sword','spear','axe','bow','arrow','shield','armor','helm','cloak','robe','crown','throne','castle','tower','keep','fort','wall','gate','bridge','path','road','trail','forest','grove','glade','meadow','field','plain','hill','peak','ridge','cave','cavern','den','lair','nest','hive','swarm','pack','herd','flock','pride','clan','tribe','guild','order','realm','world','void','abyss','chaos','fate','doom','hope','faith','honor','glory','valor','wrath','rage','fury','calm','peace','war','battle','fight','duel','quest','journey','trek','voyage','drift','wander','roam','seek','find','hunt','chase','flee','hide','ward','hold','grip','reach','touch','feel','sense','mind','soul','heart','spirit','ghost','wraith','specter','phantom','breath','life','death','birth','end','start','begin','finish','close','open','wide','narrow','deep','high','low','fast','slow','quick','swift','brave','bold','wise','smart','clever','sharp','keen','sly','cunning','kind','gentle','fierce','wild','tame','quiet','loud','bright','clear','pure','clean','fresh','young','ancient','timeless','edge','void','omen','myth','rune','glyph','sigil','totem','charm','spell','curse','hex','ward','veil','haze','gleam','flare','flash','bolt','gust','breeze','squall','tempest','maelstrom','abyss','chasm','rift','void','ember','cinder','soot','husk','shell','core','pulse','flux','surge','tide'];

function urlServerFn(nick) {
  const payload = { t: { t: 10, i: 0, p: { k: ['data'], v: [{ t: 1, s: nick }] }, o: 0 }, f: 63, m: [] };
  return 'https://hytale.tools/_serverFn/' + HASH_SERVER_FN + '?payload=' + encodeURIComponent(JSON.stringify(payload));
}

// A resposta e uma serializacao estilo "seroval": {p:{k:[chaves...],
// v:[{t:tipo,s:valor}...]}}. Acha o campo "status" (texto igual ao que a
// pagina mostra: "available", "reserved_by_hytale" etc) dentro do
// primeiro resultado (j.p.v[0].p).
function extrairStatus(corpo) {
  let j;
  try { j = JSON.parse(corpo); }
  catch {
    // defesa contra corpo cortado por 1-2 bytes (observado so em captura
    // via Playwright na sonda; nao esperado no fetch() normal do script)
    let ok = false;
    for (let extra = 1; extra <= 3 && !ok; extra++) {
      try { j = JSON.parse(corpo + '}'.repeat(extra)); ok = true; } catch { /* tenta mais */ }
    }
    if (!ok) return null;
  }
  const resultado = j && j.p && Array.isArray(j.p.v) ? j.p.v[0] : null;
  const dentro = resultado && resultado.p;
  if (!dentro || !Array.isArray(dentro.k) || !Array.isArray(dentro.v)) return null;
  const idx = dentro.k.indexOf('status');
  if (idx === -1) return null;
  const val = dentro.v[idx];
  return val && typeof val.s === 'string' ? val.s : null;
}

function gerarNicks() {
  const tudo = [];
  const triplas = (alfabeto) => {
    for (const a of alfabeto) for (const b of alfabeto) for (const c of alfabeto) {
      tudo.push(a + b + c);
    }
  };
  if (CHARSET === 'palavras') {
    const todas = [...new Set([...PALAVRAS_PT, ...PALAVRAS_EN])]
      .map((w) => w.toLowerCase())
      .filter((w) => /^[a-z]{3,5}$/.test(w));
    return [...new Set(todas)];
  }
  if (CHARSET === 'letras') triplas(LETRAS);
  else if (CHARSET === 'numeros') triplas(NUMEROS);
  else if (CHARSET === 'tudo') triplas(LETRAS + NUMEROS);
  else { triplas(LETRAS); triplas(NUMEROS); } // letras+numeros (padrao)
  return tudo;
}

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

let total429 = 0;
async function consultar(nick, tentativa = 0, vezes429 = 0) {
  await minhaVez();
  let resp;
  let corpo = '';
  try {
    resp = await fetch(urlServerFn(nick), {
      headers: {
        'User-Agent': UA,
        // sem esses dois o servidor devolve 200 com corpo vazio - achado
        // comparando um fetch() de dentro do navegador (falha) com um
        // fetch() replicando os cabecalhos exatos que o browser manda
        // pro _serverFn (funciona, mesmo sem cookie de sessao).
        Accept: 'application/x-tss-framed, application/x-ndjson, application/json',
        'X-Tsr-Serverfn': 'true',
        Referer: 'https://hytale.tools/search/' + encodeURIComponent(nick),
      },
    });
    corpo = await resp.text();
  } catch (e) {
    if (tentativa < 3) { await esperar(1000 * 2 ** tentativa); return consultar(nick, tentativa + 1, vezes429); }
    return { disp: null, status: null, status_http: 0, rotulo: 'rede:' + e.message.slice(0, 60) };
  }
  if (resp.status === 429) {
    total429 += 1;
    if (vezes429 >= 20) return { disp: null, status: null, status_http: 429, rotulo: '429 insistente' };
    const apos = Number(resp.headers.get('retry-after')) || 5;
    pausadoAte = Math.max(pausadoAte, Date.now() + apos * 1000);
    return consultar(nick, tentativa, vezes429 + 1);
  }
  if (resp.status >= 500 && tentativa < 3) {
    await esperar(1000 * 2 ** tentativa);
    return consultar(nick, tentativa + 1, vezes429);
  }
  if (resp.status !== 200) return { disp: null, status: null, status_http: resp.status, rotulo: 'http' + resp.status + ': ' + corpo.slice(0, 120) };
  const status = extrairStatus(corpo);
  if (status === null) return { disp: null, status: null, status_http: 200, rotulo: 'sem-status: ' + corpo.slice(0, 150) };
  return { disp: status === 'available', status, status_http: 200, rotulo: status };
}

const diario = [];
function anota(linha) { console.log(linha); diario.push(linha); }
function gravarDiagnostico(extra) {
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA, 'diagnostico.md'),
    '# Diagnostico da qualificacao\n\n```\n' + diario.join('\n') + '\n```\n' + (extra || '') + '\n');
}

async function qualificar() {
  anota('endpoint: ' + urlServerFn('{n}'));
  for (const nick of CONTROLES_OCUPADOS) {
    const r = await consultar(nick);
    anota('    ' + nick + ' -> disp=' + r.disp + ' status=' + r.status + ' [' + r.status_http + '] ' + r.rotulo);
    if (r.disp !== false) { anota('    REPROVADO: controle deveria vir indisponivel'); return false; }
  }
  const amostra = amostraAleatoria(20);
  let livres = 0, nulos = 0;
  const exemplos = [];
  for (const nick of amostra) {
    const r = await consultar(nick);
    if (r.disp === true) { livres += 1; if (exemplos.length < 5) exemplos.push(nick); }
    else if (r.disp === null) nulos += 1;
  }
  anota('    amostra de 20 aleatorios: livres=' + livres + ' nulos=' + nulos + ' ex-livres=' + exemplos.join(','));
  if (livres < 1 || nulos > 4) { anota('    REPROVADO na amostra'); return false; }
  anota('    QUALIFICADA');
  return true;
}

function gravar(resultado) {
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA, 'nicks_livres.json'), JSON.stringify(resultado, null, 2) + '\n');
  fs.writeFileSync(path.join(SAIDA, 'nicks_livres.txt'), resultado.livres.join('\n') + '\n');
  const md = [
    '# Nicks de 3 caracteres livres no Hytale',
    '',
    'Verificado em ' + resultado.verificado_em + ' via hytale.tools (mesmo endpoint que o site usa).',
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
  const ok = await qualificar();
  gravarDiagnostico(ok ? 'Fonte qualificada.' : 'NAO qualificada - hash do _serverFn pode ter mudado.');
  if (!ok) {
    console.error('fonte nao qualificada; nao vou gravar lista. Veja nicks/diagnostico.md');
    process.exit(1);
  }

  const nicks = gerarNicks();
  console.log(nicks.length + ' nicks pra varrer (~' + Math.round(nicks.length / MAX_RPS / 60) + ' min)');

  const livres = [];
  const ocupados = [];
  const desconhecidos = [];
  let feitos = 0;
  let indice = 0;

  const montar = () => ({
    verificado_em: new Date().toISOString(),
    fonte: 'hytale.tools _serverFn (mesmo endpoint da pagina de busca)',
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
      classificar(nick, await consultar(nick));
      feitos += 1;
      if (feitos % 500 === 0) {
        console.log(feitos + '/' + nicks.length + ' - livres ate agora: ' + livres.length + ' (429s: ' + total429 + ')');
        gravar(montar());
      }
    }
  };
  await Promise.all(Array.from({ length: TRABALHADORES }, trabalhador));

  for (const nick of desconhecidos.splice(0)) {
    classificar(nick, await consultar(nick));
  }

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
