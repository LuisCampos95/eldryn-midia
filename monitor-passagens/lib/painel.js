// Gera o RANKING.md: o lugar onde voce OLHA as passagens.
//
// Markdown de proposito: o GitHub renderiza markdown bonito mesmo em
// repositorio privado, inclusive no app do celular. Nao precisa de Pages, de
// site, de deploy nem de plano pago - voce abre o arquivo no repo e ve.
//
// A issue continua sendo o alerta (te empurra). Isto aqui e o painel (voce
// puxa, quando bate a vontade de viajar e quer ver o que esta barato).

const { brl } = require('./util');

function tabela(linhas, cambio, taxas) {
  const cab = '| rota | destino | data | preco | km | R$/km | cias |\n' +
              '|---|---|---|---|---|---|---|';
  const corpo = linhas.map((l) => {
    const cias = (l.cias || []).slice(0, 3).join(', ') || '-';
    const conv = cambio && taxas ? cambio(l.precoBRL, taxas) : '';
    return `| ${l.rota} | ${l.cidade || l.rota.split('-')[1]} | ${l.data} | ` +
           `**${brl(l.precoBRL)}**${conv ? `<br><sub>${conv}</sub>` : ''} | ` +
           `${l.distanciaKm.toLocaleString('pt-BR')} | ${l.precoPorKm.toFixed(2)} | ${cias} |`;
  }).join('\n');
  return `${cab}\n${corpo}`;
}

function gerar({ ranking, porOrigem, resumo, taxas, cambio, cidadePorId }) {
  const enriquecer = (l) => ({ ...l, cidade: cidadePorId[l.rota.split('-')[1]] });
  const p = [];

  p.push('# Passagens — o que esta barato agora\n');
  p.push(`_Atualizado em ${resumo.quando} · ${resumo.leituras} leituras · ` +
         `${resumo.paresNoCatalogo} pares no catalogo · o catalogo inteiro e varrido a cada ~${resumo.voltaEm} rodadas._\n`);

  if (!ranking.length) {
    p.push('> Nenhuma leitura de preco nesta rodada. Veja o log do Actions.\n');
    return p.join('\n');
  }

  p.push('## Melhores por preco/km\n');
  p.push('Preco por km e o unico jeito de comparar uma pechincha pra Recife com uma');
  p.push('pra Madri. Voo curto sempre custa mais por km — compare dentro da mesma faixa.\n');
  p.push(tabela(ranking.slice(0, 20).map(enriquecer), cambio, taxas));
  p.push('');

  for (const [origem, linhas] of Object.entries(porOrigem)) {
    if (!linhas.length) continue;
    p.push(`## Saindo de ${origem}\n`);
    p.push(tabela(linhas.slice(0, 10).map(enriquecer), cambio, taxas));
    p.push('');
  }

  p.push('---\n');
  p.push('Preco e de busca, nao e garantia de venda: confirme no site da cia antes de comprar.');
  p.push('Alertas de queda chegam por issue (com e-mail). Este painel e a foto do momento.');
  return p.join('\n');
}

module.exports = { gerar };
