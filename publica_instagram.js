// Publica no Instagram @brasilhytale o que ja venceu o horario.
// Roda no GitHub Actions (PC do Luis pode estar desligado).
// Token vem da variavel de ambiente META_TOKEN (secret do repositorio).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GRAPH = 'https://graph.facebook.com/v21.0';
const IG_PERMITIDO = 'brasilhytale';
const RAIZ = __dirname;
const AGENDA = path.join(RAIZ, 'agenda.json');
const FEITOS = path.join(RAIZ, 'publicados.json');

// Uma reivindicacao mais velha que isso e considerada abandonada (processo
// morreu entre reivindicar e publicar) e pode ser tentada de novo.
const REIVINDICACAO_EXPIRA_MS = 15 * 60 * 1000;

// Trava de concorrente. Vai embutida aqui porque o Actions so tem este repositorio.
const BLOQUEADOS = ['mup', 'draacoun', 'digubigule'];
const REGEX_BLOQ = BLOQUEADOS.map(t => new RegExp('(^|[^a-z0-9])' + t + '([^a-z0-9]|$)', 'i'));
function checaBloqueio(alvo, rotulo) {
  const texto = typeof alvo === 'string' ? alvo : JSON.stringify(alvo);
  for (let i = 0; i < REGEX_BLOQ.length; i++) {
    if (REGEX_BLOQ[i].test(texto)) {
      throw new Error('BLOQUEADO por concorrente ("' + BLOQUEADOS[i] + '") em ' + rotulo);
    }
  }
}

const SECO = process.argv.includes('--ensaio');
const token = process.env.META_TOKEN || (() => {
  const alt = path.resolve(RAIZ, '..', 'EldrynSocial', 'config.json');
  if (fs.existsSync(alt)) return JSON.parse(fs.readFileSync(alt, 'utf8')).meta.token;
  return null;
})();
if (!token) { console.error('sem META_TOKEN'); process.exit(1); }

async function graph(caminho, params = {}, metodo = 'GET') {
  const url = new URL(GRAPH + caminho);
  if (metodo === 'GET') for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  const opcoes = { method: metodo };
  if (metodo === 'POST') {
    const f = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) f.set(k, v);
    f.set('access_token', token);
    opcoes.body = f;
  }
  const r = await fetch(url, opcoes);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message + ' (code ' + j.error.code + ')');
  return j;
}

const dorme = ms => new Promise(r => setTimeout(r, ms));

function git(args) {
  return execFileSync('git', args, { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

// Le publicados.json do DISCO, nao de uma copia em memoria. Depois de um
// pull/rebase o arquivo muda debaixo do processo, e reusar uma copia antiga
// e exatamente o que causou a publicacao em dobro em 20/08/2026.
function lerFeitos() {
  return fs.existsSync(FEITOS) ? JSON.parse(fs.readFileSync(FEITOS, 'utf8')) : [];
}

// Reivindica um post ANTES de chamar a API do Instagram, atomicamente via
// commit git. Duas execucoes do workflow rodando ao mesmo tempo (o cron de
// 10min colidindo com um workflow_dispatch manual, por exemplo) podem fazer
// checkout no MESMO instante, ambas verem "nao publicado ainda" e publicar o
// MESMO post duas vezes - foi o que aconteceu com o post do patch notes em
// 20/08/2026, o dono teve que apagar a copia manualmente. A concurrency do
// GitHub Actions (cancel-in-progress: false) deveria serializar as execucoes,
// mas nao segurou a tempo dessa vez, entao a trava de verdade precisa estar
// aqui, nao so no workflow.
//
// O mecanismo: escreve um marcador "reivindicado" e tenta empurrar. Se o push
// for aceito, ninguem mais vai processar este post (quem chegar depois le o
// marcador e desiste). Se o push falhar (a outra execucao empurrou primeiro),
// reler o estado remoto e decidir: post ja tem id de verdade -> a outra
// publicou, desiste; post so tem reivindicacao de outro processo e ainda
// fresca -> desiste tambem, por seguranca; reivindicacao antiga ou ausente ->
// tenta nesta execucao de novo.
async function reivindicar(post, hora) {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const feitos = lerFeitos();
    const existente = feitos.find(f => f.post === post);
    if (existente && existente.id) return { ok: false, motivo: 'ja publicado por outra execucao' };
    if (existente && !existente.id) {
      const idade = Date.now() - new Date(existente.reivindicadoEm).getTime();
      if (idade < REIVINDICACAO_EXPIRA_MS) {
        return { ok: false, motivo: 'outra execucao esta processando agora' };
      }
      // reivindicacao antiga, processo anterior morreu no meio. substitui.
      existente.reivindicadoEm = new Date().toISOString();
    } else {
      feitos.push({ post, hora, reivindicadoEm: new Date().toISOString() });
    }
    fs.writeFileSync(FEITOS, JSON.stringify(feitos, null, 2) + '\n');

    try {
      git(['add', 'publicados.json']);
      git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=github-actions[bot]@users.noreply.github.com',
        'commit', '-m', 'reivindica ' + post]);
      git(['push']);
      return { ok: true, feitos };
    } catch (e) {
      // push rejeitado (a outra execucao chegou primeiro): descarta o commit
      // local, traz o estado real, e tenta de novo com dado fresco.
      try { git(['reset', '--hard', 'HEAD~1']); } catch (e2) { /* nada a desfazer */ }
      try { git(['fetch', 'origin', 'main']); git(['reset', '--hard', 'origin/main']); } catch (e2) { /* segue */ }
      await dorme(1000 + Math.random() * 2000);
    }
  }
  return { ok: false, motivo: 'nao consegui reivindicar apos 5 tentativas' };
}

// Grava o resultado final (id de verdade) por cima da reivindicacao. Mesmo
// mecanismo de retry, mas aqui NUNCA desiste silenciosamente: a publicacao ja
// aconteceu de verdade no Instagram, perder esse registro faria a proxima
// execucao tentar reivindicar nesse post de novo (reivindicacao expira) e
// publicar em dobro so por causa de uma falha de commit.
function gravarResultado(post, hora, id) {
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const feitos = lerFeitos();
    const i = feitos.findIndex(f => f.post === post);
    const registro = { post, hora, id, em: new Date().toISOString() };
    if (i === -1) feitos.push(registro); else feitos[i] = registro;
    fs.writeFileSync(FEITOS, JSON.stringify(feitos, null, 2) + '\n');
    try {
      git(['add', 'publicados.json']);
      git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=github-actions[bot]@users.noreply.github.com',
        'commit', '-m', 'registra publicacao ' + post]);
      git(['push']);
      return true;
    } catch (e) {
      try { git(['reset', '--hard', 'HEAD~1']); } catch (e2) { /* nada a desfazer */ }
      try { git(['fetch', 'origin', 'main']); git(['reset', '--hard', 'origin/main']); } catch (e2) { /* segue */ }
    }
  }
  console.log('  AVISO: publicou (' + id + ') mas nao consegui gravar o registro depois de 8 tentativas');
  return false;
}

async function esperaContainer(id) {
  // video precisa terminar de processar antes de publicar
  for (let i = 0; i < 60; i++) {
    const s = await graph('/' + id, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') {
      throw new Error('container ' + s.status_code + ' ' + (s.status || ''));
    }
    await dorme(5000);
  }
  throw new Error('container nao ficou pronto em 5 minutos');
}

(async () => {
  const agenda = JSON.parse(fs.readFileSync(AGENDA, 'utf8'));
  const feitos0 = lerFeitos();
  const jaFoi = new Set(feitos0.filter(f => f.id).map(f => f.post));

  // trava de alvo, toda execucao
  const conta = await graph('/me', { fields: 'instagram_business_account{id,username}' });
  const ig = conta.instagram_business_account;
  if (!ig || ig.username !== IG_PERMITIDO) {
    throw new Error('ABORTADO. Instagram alvo e @' + (ig && ig.username) + ', so @' + IG_PERMITIDO + ' e permitido.');
  }

  const agora = Date.now();
  const vencidos = agenda.slots.filter(s => !jaFoi.has(s.post) && new Date(s.quandoUtc).getTime() <= agora);

  console.log('alvo @' + ig.username, '| agora ' + new Date(agora).toISOString());
  console.log('na agenda', agenda.slots.length, '| ja publicados', jaFoi.size, '| vencidos agora', vencidos.length);

  if (!vencidos.length) { console.log('nada a fazer'); return; }

  for (const s of vencidos) {
    const url = agenda.baseUrl + '/midia/' + s.arquivo;
    console.log('\n>', s.post, '(' + s.hora + ')', s.tipo,
      s.tipo === 'carrossel' ? s.arquivos.length + ' fotos' : url);
    checaBloqueio(s, s.post);
    if (SECO) { console.log('  (ensaio)'); continue; }

    const reiv = await reivindicar(s.post, s.hora);
    if (!reiv.ok) { console.log('  PULANDO:', reiv.motivo); continue; }

    try {
      let cont;
      if (s.tipo === 'carrossel') {
        // carrossel: um container por foto marcado como is_carousel_item, e
        // depois um container pai do tipo CAROUSEL amarrando todos eles.
        const filhos = [];
        for (const arq of s.arquivos) {
          const f = await graph('/' + ig.id + '/media', {
            image_url: agenda.baseUrl + '/midia/' + arq,
            is_carousel_item: 'true',
          }, 'POST');
          await esperaContainer(f.id);
          filhos.push(f.id);
          console.log('    item', arq, '->', f.id);
        }
        cont = await graph('/' + ig.id + '/media', {
          media_type: 'CAROUSEL',
          children: filhos.join(','),
          caption: s.texto,
        }, 'POST');
        console.log('  carrossel', cont.id, 'com', filhos.length, 'fotos');
      } else {
        const params = { caption: s.texto };
        if (s.tipo === 'video') { params.media_type = 'REELS'; params.video_url = url; }
        else { params.image_url = url; }
        cont = await graph('/' + ig.id + '/media', params, 'POST');
        console.log('  container', cont.id);
      }
      await esperaContainer(cont.id);

      const pub = await graph('/' + ig.id + '/media_publish', { creation_id: cont.id }, 'POST');
      console.log('  PUBLICADO', pub.id);
      gravarResultado(s.post, s.hora, pub.id);
    } catch (e) {
      console.log('  FALHOU:', e.message);
      process.exitCode = 1;
    }
  }
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
