// Gera o RANKING.md: o lugar onde voce OLHA as passagens.
//
// Markdown de proposito: o GitHub renderiza markdown bonito mesmo em
// repositorio privado, inclusive no app do celular. Nao precisa de Pages, de
// site, de deploy nem de plano pago - voce abre o arquivo no repo e ve.
//
// A issue continua sendo o alerta (te empurra). Isto aqui e o painel (voce
// puxa, quando bate a vontade de viajar e quer ver o que esta barato).

const { brl } = require('./util');

// A coluna de companhia voltou, e agora e verdade: sai do data-gs do proprio
// itinerario (os numeros de voo), nao mais de varrer nomes de cia pela pagina.
// Onde a leitura ainda cai no caminho antigo, a celula fica vazia em vez de
// chutar.
function tabela(linhas, cambio, taxas) {
  const cab = '| rota | destino | ida | volta | preco | cia | voos | km | R$/km | abrir |\n' +
              '|---|---|---|---|---|---|---|---|---|---|';
  const corpo = linhas.map((l) => {
    const conv = cambio && taxas ? cambio(l.precoBRL, taxas) : '';
    // rotulo pelo que a leitura REALMENTE e, nao pelo que a consulta pediu:
    // quando nenhuma frase de ida e volta funciona, a rede de seguranca cai
    // pra so ida, e isso tem que aparecer
    const volta = l.tipoTarifa === 'ida-e-volta' && l.dataVolta
      ? `${l.dataVolta}<br><sub>${l.noites} noites</sub>`
      : '**so ida**';
    const link = l.link ? `[buscar](${l.link})` : '-';
    const cia = l.cias && l.cias.length ? l.cias.join(' + ') : '—';
    const voos = l.voos && l.voos.length ? '`' + l.voos.join('` `') + '`' : '—';
    return `| \`${l.rota}\` | ${l.cidade || l.rota.split('-')[1]} | ${l.data} | ${volta} | ` +
           `**${brl(l.precoBRL)}**${conv ? `<br><sub>${conv}</sub>` : ''} | ${cia} | ${voos} | ` +
           `${l.distanciaKm.toLocaleString('pt-BR')} | ${l.precoPorKm.toFixed(2)} | ${link} |`;
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
  p.push('**Preco de ida e volta, por adulto, em economica.** O link abre a mesma busca no');
  p.push('Google Flights, onde aparecem a companhia, os horarios, as escalas e onde comprar.');
  p.push('');
  p.push('Preco e de busca, nao e garantia de venda: confirme antes de comprar.');
  p.push('Alertas de queda chegam por issue (com e-mail). Este painel e a foto do momento.');
  return p.join('\n');
}

module.exports = { gerar };
