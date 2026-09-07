// Fonte: feeds RSS de sites de promocao (Melhores Destinos, Passagens
// Imperdiveis, etc). Gratuito, sem chave, e sobrevive bem a IP de datacenter -
// e o unico canal que pega tarifa relampago que so existe no site da cia e
// promocao de MILHAS (LATAM Pass, transferencia bonificada), coisa que
// nenhuma busca de preco enxerga.

const { pausa, log, normalizar } = require('../util');

// UA de bot leva 403 de quem esta atras de Cloudflare (visto no diagnostico).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function pegar(tag, xml) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function itens(xml) {
  const out = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const bloco = m[1];
    out.push({
      titulo: pegar('title', bloco),
      link: pegar('link', bloco),
      descricao: pegar('description', bloco),
      publicadoEm: pegar('pubDate', bloco)
    });
  }
  return out;
}

function relevante(item, cfg) {
  const texto = normalizar(item.titulo + ' ' + item.descricao);
  const geo = cfg.palavrasGeo.filter((p) => texto.includes(normalizar(p)));
  const milhas = cfg.palavrasMilhas.filter((p) => texto.includes(normalizar(p)));
  // Promocao do SEU programa passa mesmo sem citar rota: "LATAM Pass com 100%
  // de bonus" nao fala de Montevideu, mas e exatamente o que voce quer saber.
  const programa = cfg.palavrasPrograma.some((p) => texto.includes(normalizar(p)));
  if (geo.length === 0 && !programa) return null;
  return { geo, milhas, ehMilhas: milhas.length > 0 || programa, programa };
}

function recente(item, maxIdadeHoras) {
  if (!item.publicadoEm) return true; // sem data, deixa passar; o dedupe cuida
  const t = Date.parse(item.publicadoEm);
  if (Number.isNaN(t)) return true;
  return (Date.now() - t) <= maxIdadeHoras * 3600 * 1000;
}

async function coletar(cfg) {
  const achados = [];
  const falhas = [];

  for (const url of cfg.urls) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
      clearTimeout(t);
      if (!r.ok) { falhas.push({ url, erro: `HTTP ${r.status}` }); log(`  feed FALHOU: ${url} -> HTTP ${r.status}`); continue; }
      const xml = await r.text();
      const lista = itens(xml);
      if (lista.length === 0) { falhas.push({ url, erro: 'feed sem <item>' }); log(`  feed FALHOU: ${url} -> sem <item>`); continue; }

      let aproveitados = 0;
      for (const item of lista) {
        if (!recente(item, cfg.maxIdadeHoras)) continue;
        const rel = relevante(item, cfg);
        if (!rel) continue;
        aproveitados++;
        achados.push({
          fonte: 'feed',
          feed: url,
          titulo: item.titulo,
          link: item.link,
          resumo: item.descricao.slice(0, 300),
          publicadoEm: item.publicadoEm,
          geo: rel.geo,
          ehMilhas: rel.ehMilhas,
          milhas: rel.milhas,
          coletadoEm: new Date().toISOString()
        });
      }
      log(`  feed ok: ${url} (${lista.length} itens, ${aproveitados} relevantes)`);
    } catch (e) {
      falhas.push({ url, erro: e.name === 'AbortError' ? 'timeout' : e.message });
      log(`  feed FALHOU: ${url} -> ${e.message}`);
    }
    await pausa(500);
  }

  return { achados, falhas };
}

module.exports = { coletar, itens, relevante };
