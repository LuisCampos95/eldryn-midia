// Diagnostico: abre hytale.tools/search/{n} num Chromium headless e
// grava toda chamada de rede que nao seja asset estatico, pra achar o
// endpoint/RPC real de disponibilidade (a pagina usa TanStack Start,
// entao a checagem roda via server function depois da hidratacao - nao
// da pra ver isso so lendo o HTML inicial).
const { chromium } = require('playwright');

const NICKS = ['kkk', 'zqx']; // kkk: reservado (confirmado pelo Luis). zqx: provavel livre.
const IGNORAR = /\.(js|css|png|jpe?g|svg|woff2?|ico|map|webp)(\?|$)/i;

(async () => {
  const navegador = await chromium.launch();
  for (const nick of NICKS) {
    const pagina = await navegador.newPage();
    const chamadas = [];
    pagina.on('request', (req) => {
      if (IGNORAR.test(req.url())) return;
      chamadas.push({ fase: 'pedido', url: req.url(), metodo: req.method(), cabecalhos: req.headers(), corpo: req.postData() });
    });
    pagina.on('response', async (resp) => {
      if (IGNORAR.test(resp.url())) return;
      let corpo = '';
      try { corpo = (await resp.text()).slice(0, 2000); } catch { /* binario/stream, ignora */ }
      chamadas.push({ fase: 'resposta', url: resp.url(), status: resp.status(), corpo });
    });
    await pagina.goto('https://hytale.tools/search/' + nick, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => console.error('goto falhou:', e.message));
    await pagina.waitForTimeout(2500);
    const textoVisivel = await pagina.evaluate(() => document.body.innerText).catch(() => '');
    console.log('\n========== ' + nick + ' ==========');
    console.log('--- texto visivel na pagina ---');
    console.log(textoVisivel.slice(0, 1500));
    console.log('--- chamadas de rede (nao-asset) ---');
    for (const c of chamadas) {
      if (c.fase === 'pedido') console.log('PEDIDO ' + c.metodo + ' ' + c.url + (c.corpo ? '\n  corpo: ' + c.corpo.slice(0, 300) : ''));
      else console.log('RESPOSTA ' + c.status + ' ' + c.url + '\n  corpo: ' + c.corpo.replace(/\s+/g, ' ').slice(0, 400));
    }
    await pagina.close();
  }
  await navegador.close();
})();
