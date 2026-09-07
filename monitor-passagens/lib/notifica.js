// Notificacao sem custo e sem cadastro: abre uma issue no proprio repositorio.
// O GitHub ja manda e-mail (e push, se voce tem o app) pro dono do repo, entao
// nao precisa de bot, servidor nem plano pago.
// Telegram e opcional: so liga se voce criar os secrets.

const { brl } = require('./util');

function linhaAlerta(al, taxas, cambio) {
  if (al.feed) {
    const f = al.feed;
    const tag = f.ehMilhas ? '**[MILHAS]** ' : '';
    return `- ${tag}[${f.titulo}](${f.link})\n  - ${f.resumo}`;
  }
  const o = al.obs;
  const extra = cambio ? cambio(o.precoBRL, taxas) : '';
  const volta = o.dataVolta ? ` → ${o.dataVolta} (${o.noites} noites)` : ' (so ida)';
  // cia de verdade, do itinerario. Vazio quando a leitura caiu no caminho
  // antigo - melhor nada que chute.
  const cia = o.cias && o.cias.length
    ? `\n  - ${o.cias.join(' + ')}${o.voos && o.voos.length ? ` · voos ${o.voos.join(', ')}` : ''}`
    : '';
  const dist = o.distanciaKm
    ? ` · ${o.distanciaKm.toLocaleString('pt-BR')} km · ${o.precoPorKm.toFixed(2)}/km`
    : '';
  const milhas = al.milhasMax
    ? `\n  - Em LATAM Pass so compensa ate **~${al.milhasMax.toLocaleString('pt-BR')} milhas** + taxas`
    : '';
  return `- **${o.rotaId}** ${o.data}${volta} — **${brl(o.precoBRL)}**${extra ? ` (${extra})` : ''}${dist}${cia}\n` +
         al.motivos.map((m) => `  - ${m.texto}`).join('\n') + milhas +
         (o.link ? `\n  - [abrir no Google Flights](${o.link}) — cia, horarios, escalas e onde comprar` : '');
}

function montarCorpo(alertas, taxas, cambio, resumo) {
  const voos = alertas.filter((a) => !a.feed);
  const feeds = alertas.filter((a) => a.feed);
  const partes = [];

  if (voos.length) {
    partes.push('## Precos que dispararam alerta\n');
    partes.push(voos.map((a) => linhaAlerta(a, taxas, cambio)).join('\n'));
  }
  if (feeds.length) {
    partes.push('\n## Promocoes publicadas\n');
    partes.push(feeds.map((a) => linhaAlerta(a, taxas, cambio)).join('\n'));
  }
  partes.push('\n---\n');
  partes.push(`Rodada de ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC · ` +
              `${resumo.observacoes} leituras de preco · ${resumo.falhas} falhas de coleta.`);
  partes.push('\nPreco e de busca, nao e garantia: confirme no site da cia antes de comprar.');
  return partes.join('\n');
}

function titulo(alertas) {
  const voos = alertas.filter((a) => !a.feed);
  if (voos.length) {
    const melhor = voos.reduce((a, b) => (a.obs.precoBRL <= b.obs.precoBRL ? a : b));
    return `[passagem] ${melhor.obs.rotaId} ${melhor.obs.data} por ${brl(melhor.obs.precoBRL)}` +
           (voos.length > 1 ? ` (+${voos.length - 1})` : '');
  }
  const f = alertas[0].feed;
  return `[passagem] ${f.titulo}`.slice(0, 120);
}

async function abrirIssue(corpo, tit) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return { ok: false, erro: 'sem GITHUB_TOKEN/GITHUB_REPOSITORY (fora do Actions)' };

  const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title: tit, body: corpo })
  });
  if (!r.ok) return { ok: false, erro: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
  const j = await r.json();
  return { ok: true, url: j.html_url };
}

async function telegram(corpo, tit) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return { ok: false, erro: 'sem secrets do Telegram (opcional)' };
  const texto = `*${tit}*\n\n${corpo}`.slice(0, 4000);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: 'Markdown', disable_web_page_preview: true })
  });
  return r.ok ? { ok: true } : { ok: false, erro: `HTTP ${r.status}` };
}

function resumoDoActions(texto) {
  const arq = process.env.GITHUB_STEP_SUMMARY;
  if (!arq) return;
  try { require('fs').appendFileSync(arq, texto + '\n'); } catch (_) { /* nao e critico */ }
}

module.exports = { montarCorpo, titulo, abrirIssue, telegram, resumoDoActions };
