// Comenta o IP do Eldryn nos posts do Facebook que ja passaram do horario
// agendado. Roda no mesmo cron do Instagram (instagram.yml), a cada 10min.
//
// O Facebook agenda NATIVO: a gente manda uma vez, a Graph API publica
// sozinha na hora marcada, sem avisar a gente. Por isso precisa de poller,
// diferente do Instagram (publica_instagram.js dispara o post e ja tem o id
// na hora). A fila (quem ja foi agendado no Facebook) vem do repo privado
// EldrynSocial via publicar_fila_comentario.js, porque o token e o registro
// de agendamento moram la.
//
// Link no proprio post derruba alcance. No comentario nao penaliza, entao o
// IP de verdade so entra aqui, nunca na legenda.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = __dirname;
const GRAPH = 'https://graph.facebook.com/v21.0';
const FILA = path.join(RAIZ, 'facebook_pendente.json');
const COMENTADOS = path.join(RAIZ, 'facebook_comentados.json');
const COMENTARIO_IP = 'IP: eldryn.com.br 🎮';

const token = process.env.META_TOKEN || (() => {
  const alt = path.resolve(RAIZ, '..', 'EldrynSocial', 'config.json');
  if (fs.existsSync(alt)) return JSON.parse(fs.readFileSync(alt, 'utf8')).meta.token;
  return null;
})();
if (!token) { console.error('sem META_TOKEN'); process.exit(1); }

if (!fs.existsSync(FILA)) { console.log('sem facebook_pendente.json, nada a fazer'); process.exit(0); }

async function comentar(id, texto) {
  const corpo = new URLSearchParams();
  corpo.set('message', texto);
  corpo.set('access_token', token);
  const r = await fetch(GRAPH + '/' + id + '/comments', { method: 'POST', body: corpo });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j;
}

(async () => {
  const fila = JSON.parse(fs.readFileSync(FILA, 'utf8'));
  const comentados = fs.existsSync(COMENTADOS) ? JSON.parse(fs.readFileSync(COMENTADOS, 'utf8')) : [];
  const jaComentado = new Set(comentados);

  const agora = Math.floor(Date.now() / 1000);
  // 5 minutos de folga pro Facebook terminar de processar o post agendado.
  const pendentes = fila.filter(f => f.quando + 300 <= agora && !jaComentado.has(f.post));

  console.log('fila: ' + fila.length + ' | ja comentados: ' + comentados.length + ' | pendentes agora: ' + pendentes.length);
  if (!pendentes.length) return;

  let mudou = false;
  for (const f of pendentes) {
    console.log('> ' + f.post + ' (id ' + f.id + ')');
    try {
      const r = await comentar(f.id, COMENTARIO_IP);
      console.log('  COMENTADO ' + r.id);
      comentados.push(f.post);
      mudou = true;
    } catch (e) {
      console.log('  FALHOU: ' + e.message);
    }
  }

  if (!mudou) return;
  fs.writeFileSync(COMENTADOS, JSON.stringify(comentados, null, 2) + '\n');
  try {
    execFileSync('git', ['add', 'facebook_comentados.json'], { cwd: RAIZ });
    execFileSync('git', ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=github-actions[bot]@users.noreply.github.com',
      'commit', '-m', 'registra comentario do IP no facebook'], { cwd: RAIZ });
    execFileSync('git', ['push'], { cwd: RAIZ });
  } catch (e) {
    console.log('AVISO: comentou mas nao consegui gravar/empurrar o registro (' + e.message + ')');
  }
})().catch(e => { console.error('\n' + e.message); process.exit(1); });
