// Gera o RANKING.md: o lugar onde voce OLHA as passagens.
//
// Markdown de proposito: o GitHub renderiza markdown bonito mesmo em
// repositorio privado, inclusive no app do celular. Nao precisa de Pages, de
// site, de deploy nem de plano pago - voce abre o arquivo no repo e ve.
//
// A issue continua sendo o alerta (te empurra). Isto aqui e o painel (voce
// puxa, quando bate a vontade de viajar e quer ver o que esta barato).

const { brl } = require('./util');
const { tetoPorDistancia, folgaAteTetoPct, eBarata } = require('./catalogo');

// O painel so mostra o que esta ABAIXO DO TETO da faixa de distancia.
//
// Antes ele listava os melhores por preco/km independente do teto, com um
// rotulo discreto de 'acima do teto'. O efeito era o oposto do proposito:
// quando nao havia nada barato, ele mostrava caro bem ordenado - Santiago a
// R$ 1.991 com teto de R$ 1.500 aparecia como se fosse recomendacao.
//
// Painel de promocao que mostra passagem cara nao e painel de promocao. Se
// nao ha nada abaixo do teto, o certo e dizer que nao ha.
//
// E raspar no teto tambem nao vale: o teto e o maximo que voce pagaria, nao um
// bom preco. Por isso a linha precisa de folga minima (cfg.folgaMinimaPct).
function eBaratinha(l, cfg) {
  if (typeof l.distanciaKm !== 'number' || typeof l.precoBRL !== 'number') return false;
  return eBarata(l.precoBRL, teto(l, cfg), cfg.folgaMinimaPct);
}

function teto(l, cfg) {
  const base = tetoPorDistancia(l.distanciaKm, cfg.tetosPorDistancia);
  return base * (l.tipoTarifa === 'ida-e-volta' ? 2 : 1);
}

function abaixoPct(l, cfg) {
  return Math.round(folgaAteTetoPct(l.precoBRL, teto(l, cfg)));
}

// A coluna de companhia voltou, e agora e verdade: sai do data-gs do proprio
// itinerario (os numeros de voo), nao mais de varrer nomes de cia pela pagina.
// Onde a leitura ainda cai no caminho antigo, a celula fica vazia em vez de
// chutar.
function tabela(linhas, cambio, taxas, cfg) {
  const cab = '| rota | destino | ida | volta | preco | abaixo do teto | cia | voos | km | R$/km | abrir |\n' +
              '|---|---|---|---|---|---|---|---|---|---|---|';
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
    const folga = `**${abaixoPct(l, cfg)}%**<br><sub>teto ${brl(teto(l, cfg))}</sub>`;
    return `| \`${l.rota}\` | ${l.cidade || l.rota.split('-')[1]} | ${l.data} | ${volta} | ` +
           `**${brl(l.precoBRL)}**${conv ? `<br><sub>${conv}</sub>` : ''} | ${folga} | ${cia} | ${voos} | ` +
           `${l.distanciaKm.toLocaleString('pt-BR')} | ${l.precoPorKm.toFixed(2)} | ${link} |`;
  }).join('\n');
  return `${cab}\n${corpo}`;
}

function gerar({ ranking, porOrigem, resumo, taxas, cambio, cidadePorId, cfg }) {
  const enriquecer = (l) => ({ ...l, cidade: cidadePorId[l.rota.split('-')[1]] });
  const p = [];

  // Ordena pela FOLGA ate o teto, nao por preco/km. Com o teto filtrando, o
  // preco/km ja nao responde a pergunta certa: ele diz qual voo custa menos
  // por quilometro, e o que interessa agora e qual e a maior pechincha. O
  // teto ja embute a distancia, entao a folga compara direto.
  const baratas = ranking.filter((l) => eBaratinha(l, cfg))
                         .sort((a, b) => abaixoPct(b, cfg) - abaixoPct(a, cfg));
  const caras = ranking.length - baratas.length;

  p.push('# Passagens — o que esta barato agora\n');
  p.push(`_Atualizado em ${resumo.quando} · ${resumo.leituras} leituras · ` +
         `${resumo.paresNoCatalogo} pares no catalogo · o catalogo inteiro e varrido a cada ~${resumo.voltaEm} rodadas._\n`);

  if (!ranking.length) {
    p.push('> Nenhuma leitura de preco nesta rodada. Veja o log do Actions.\n');
    return p.join('\n');
  }

  if (!baratas.length) {
    p.push('## Nada barato agora\n');
    p.push(`Nenhuma das ${ranking.length} rotas lidas nesta rodada ficou pelo menos ` +
           `${cfg.folgaMinimaPct}% abaixo do teto da sua faixa de distancia. Passagem cara nao`);
    p.push('entra aqui — quando aparecer promocao de verdade, ela aparece nesta lista e chega');
    p.push('por issue no seu e-mail.\n');
    p.push('Se voce acha que esta apertado demais, ajuste `tetosPorDistancia` ou');
    p.push('`folgaMinimaPct` no `config.json`.\n');
    return p.join('\n');
  }

  p.push('## Abaixo do teto\n');
  p.push(`So entra aqui o que esta pelo menos **${cfg.folgaMinimaPct}% abaixo do teto** da faixa de`);
  p.push('distancia — raspar no teto nao e promocao, e o limite. A lista vem ordenada pela');
  p.push('folga, a maior pechincha primeiro. O preco por km voado fica na tabela pra');
  p.push('comparar destinos de distancias diferentes.\n');
  p.push(tabela(baratas.slice(0, 20).map(enriquecer), cambio, taxas, cfg));
  p.push('');
  if (caras) {
    p.push(`_Outras ${caras} rotas foram lidas nesta rodada e ficaram caras demais pro teto. ` +
           'Nao entram no painel de proposito._\n');
  }

  for (const [origem, linhas] of Object.entries(porOrigem)) {
    const boas = linhas.filter((l) => eBaratinha(l, cfg))
                       .sort((a, b) => abaixoPct(b, cfg) - abaixoPct(a, cfg));
    if (!boas.length) continue;
    p.push(`## Saindo de ${origem}\n`);
    p.push(tabela(boas.slice(0, 10).map(enriquecer), cambio, taxas, cfg));
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
