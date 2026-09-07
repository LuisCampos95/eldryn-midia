// Leitura ESTRUTURAL da pagina do Google Flights.
//
// Ate aqui o preco era colhido por expressao regular procurando "R$ N" no
// HTML inteiro, o que obrigava a adivinhar por estatistica qual numero era
// passagem (dai o filtro de repeticao e o de pagina invalida). E companhia,
// voo e escala nao existiam - so dava pra listar as cias citadas na pagina,
// que nao e a cia da tarifa.
//
// O diagnostico achou o ancoradouro. Cada itinerario e renderizado assim:
//
//   <div class="YMlIz FpEdX jLMuyc">
//     <span data-gs="Cj..." aria-label="2424 Reais brasileiros" role="text">
//
// Duas coisas de uma vez:
//
//   aria-label  -> o preco, num formato exato. So itinerario tem isso; numero
//                  solto da pagina nao tem. Fim da adivinhacao.
//   data-gs     -> protobuf em base64 cujo campo 2 e a lista de voos separada
//                  por barra: "AR1383|AR1240". O prefixo IATA da a companhia.

const CIAS = {
  AR: 'Aerolineas Argentinas', LA: 'LATAM', JJ: 'LATAM Brasil', '4M': 'LATAM Argentina',
  LP: 'LATAM Peru', XL: 'LATAM Ecuador', G3: 'Gol', AD: 'Azul', H2: 'SKY Airline',
  JA: 'JetSMART', WJ: 'JetSMART Argentina', FO: 'Flybondi', CM: 'Copa', AV: 'Avianca',
  AM: 'Aeromexico', AA: 'American', UA: 'United', DL: 'Delta', B6: 'JetBlue',
  AC: 'Air Canada', TP: 'TAP', IB: 'Iberia', UX: 'Air Europa', AF: 'Air France',
  KL: 'KLM', LH: 'Lufthansa', BA: 'British Airways', TK: 'Turkish', AZ: 'ITA Airways',
  EK: 'Emirates', QR: 'Qatar', ET: 'Ethiopian', SU: 'Aeroflot', PZ: 'Paranair',
  Z8: 'Amaszonas', OB: 'BoA', '2K': 'Avianca Ecuador', P5: 'Wingo', VH: 'Aeroregional'
};

// protobuf: so precisamos dos campos de topo, e so o 2 nos interessa
function camposProtobuf(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const tag = buf[i++];
    const num = tag >> 3;
    const wire = tag & 7;
    if (wire === 2) {
      let len = 0, sh = 0, x;
      do { x = buf[i++]; len |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80 && i < buf.length);
      out[num] = buf.slice(i, i + len);
      i += len;
    } else if (wire === 0) {
      let v = 0, sh = 0, x;
      do { x = buf[i++]; v |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80 && i < buf.length);
      out[num] = v;
    } else {
      break; // wire type que nao usamos: para aqui em vez de ler lixo
    }
  }
  return out;
}

function voosDoDataGs(gs) {
  try {
    const campos = camposProtobuf(Buffer.from(gs, 'base64'));
    const bruto = campos[2];
    if (!Buffer.isBuffer(bruto)) return [];
    const texto = bruto.toString('utf8');
    // "AR1383|AR1240" -> ['AR1383','AR1240']
    if (!/^[A-Z0-9]{2}\d{1,4}(\|[A-Z0-9]{2}\d{1,4})*$/.test(texto)) return [];
    return texto.split('|');
  } catch (_) {
    return [];
  }
}

function ciaDoVoo(voo) {
  const cod = voo.slice(0, 2);
  return CIAS[cod] || cod;
}

/**
 * Extrai os itinerarios da pagina.
 * Devolve [{ precoBRL, voos, cias, trechos }], em ordem de aparicao.
 */
function extrair(html) {
  const out = [];
  const vistos = new Set();
  // ancora no aria-label, e procura o data-gs na vizinhanca (a ordem dos
  // atributos pode mudar, entao olhamos pros dois lados)
  const re = /aria-label="(\d[\d.,]*)\s+Reais brasileiros"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const preco = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(preco)) continue;

    const janela = html.slice(Math.max(0, m.index - 600), m.index + 200);
    const gs = /data-gs="([A-Za-z0-9+/=_-]+)"/.exec(janela);
    const voos = gs ? voosDoDataGs(gs[1]) : [];

    const chave = `${preco}|${voos.join(',')}`;
    if (vistos.has(chave)) continue; // o Google repete o mesmo itinerario em secoes diferentes
    vistos.add(chave);

    out.push({
      precoBRL: preco,
      voos,
      cias: [...new Set(voos.map(ciaDoVoo))],
      trechos: voos.length
    });
  }
  return out;
}

/** O mais barato, que e o que o monitor reporta. */
function maisBarato(itinerarios) {
  if (!itinerarios.length) return null;
  return itinerarios.reduce((a, b) => (a.precoBRL <= b.precoBRL ? a : b));
}

module.exports = { extrair, maisBarato, voosDoDataGs, ciaDoVoo, CIAS };
