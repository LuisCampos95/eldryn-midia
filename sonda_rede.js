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
    let urlServerFn = null;
    let cabecalhosServerFn = null;
    pagina.on('requestfinished', async (req) => {
      if (!req.url().includes('_serverFn')) return;
      urlServerFn = req.url();
      cabecalhosServerFn = req.headers();
      try {
        const r = await req.response();
        console.log('\n[cabecalhos completos do pedido _serverFn]');
        console.log(JSON.stringify(req.headers(), null, 1));
        console.log('[cabecalhos completos da resposta _serverFn]');
        console.log(JSON.stringify(r ? r.headers() : null, null, 1));
      } catch (e) { console.log('[erro pegando cabecalhos _serverFn]', e.message); }
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

    if (urlServerFn) {
      const cookies = await pagina.context().cookies();
      const cookieHdr = cookies.map((c) => c.name + '=' + c.value).join('; ');
      console.log('\n--- replay 1: fetch() do NODE, so com os cabecalhos capturados (sem cookie) ---');
      try {
        const semCookie = { ...cabecalhosServerFn };
        delete semCookie.cookie;
        const r1 = await fetch(urlServerFn, { headers: semCookie });
        console.log('status:', r1.status, 'corpo:', (await r1.text()).slice(0, 300));
      } catch (e) { console.log('erro:', e.message); }

      console.log('--- replay 2: fetch() do NODE, cabecalhos + cookie da sessao do browser ---');
      try {
        const r2 = await fetch(urlServerFn, { headers: { ...cabecalhosServerFn, cookie: cookieHdr } });
        console.log('status:', r2.status, 'corpo:', (await r2.text()).slice(0, 300));
      } catch (e) { console.log('erro:', e.message); }

      console.log('--- replay 3: fetch() DENTRO do navegador (page.evaluate), sem UA/headers customizados ---');
      const r3 = await pagina.evaluate(async (u) => {
        try { const r = await fetch(u); return { status: r.status, corpo: (await r.text()).slice(0, 300) }; }
        catch (e) { return { erro: e.message }; }
      }, urlServerFn).catch((e) => ({ erro: e.message }));
      console.log(JSON.stringify(r3));

      console.log('--- headers que o node.fetch mandou por padrao (comparar com os do browser acima) ---');
      console.log('cookies da sessao:', cookieHdr.slice(0, 200));
    }

    await pagina.close();
  }
  await navegador.close();
})();
