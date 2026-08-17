// Publica no Instagram @brasilhytale o que ja venceu o horario.
// Roda no GitHub Actions (PC do Luis pode estar desligado).
// Token vem da variavel de ambiente META_TOKEN (secret do repositorio).

const fs = require('fs');
const path = require('path');

const GRAPH = 'https://graph.facebook.com/v21.0';
const IG_PERMITIDO = 'brasilhytale';
const RAIZ = __dirname;
const AGENDA = path.join(RAIZ, 'agenda.json');
const FEITOS = path.join(RAIZ, 'publicados.json');

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
  const feitos = fs.existsSync(FEITOS) ? JSON.parse(fs.readFileSync(FEITOS, 'utf8')) : [];
  const jaFoi = new Set(feitos.map(f => f.post));

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
    console.log('\n>', s.post, '(' + s.hora + ')', s.tipo, url);
    checaBloqueio(s, s.post);
    if (SECO) { console.log('  (ensaio)'); continue; }

    try {
      const params = { caption: s.texto };
      if (s.tipo === 'video') { params.media_type = 'REELS'; params.video_url = url; }
      else { params.image_url = url; }

      const cont = await graph('/' + ig.id + '/media', params, 'POST');
      console.log('  container', cont.id);
      await esperaContainer(cont.id);

      const pub = await graph('/' + ig.id + '/media_publish', { creation_id: cont.id }, 'POST');
      console.log('  PUBLICADO', pub.id);
      feitos.push({ post: s.post, hora: s.hora, id: pub.id, em: new Date().toISOString() });
      fs.writeFileSync(FEITOS, JSON.stringify(feitos, null, 2) + '\n');
    } catch (e) {
      console.log('  FALHOU:', e.message);
      process.exitCode = 1;
    }
  }
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
