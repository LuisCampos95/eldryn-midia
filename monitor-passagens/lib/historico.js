// Historico em NDJSON, um arquivo por mes, commitado no repo.
// E o ativo mais importante do projeto: sem serie historica o alerta so sabe
// comparar com um teto fixo, que envelhece mal. Com serie, ele sabe dizer
// "isso esta entre os 10% mais baratos que ja vi nessa rota".

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'historico');

function arquivoDoMes(iso) {
  return path.join(DIR, iso.slice(0, 7) + '.ndjson');
}

function gravar(observacoes) {
  if (!observacoes.length) return 0;
  fs.mkdirSync(DIR, { recursive: true });
  const porArquivo = new Map();
  for (const o of observacoes) {
    const arq = arquivoDoMes(o.coletadoEm);
    if (!porArquivo.has(arq)) porArquivo.set(arq, []);
    porArquivo.get(arq).push(JSON.stringify(o));
  }
  for (const [arq, linhas] of porArquivo) {
    fs.appendFileSync(arq, linhas.join('\n') + '\n');
  }
  return observacoes.length;
}

function carregar(janelaDias) {
  if (!fs.existsSync(DIR)) return [];
  const limite = Date.now() - janelaDias * 86400000;
  const out = [];
  for (const nome of fs.readdirSync(DIR).filter((n) => n.endsWith('.ndjson')).sort()) {
    const bruto = fs.readFileSync(path.join(DIR, nome), 'utf8');
    for (const linha of bruto.split('\n')) {
      if (!linha.trim()) continue;
      try {
        const o = JSON.parse(linha);
        if (Date.parse(o.coletadoEm) >= limite) out.push(o);
      } catch (_) { /* linha corrompida: ignora, nao derruba a rodada */ }
    }
  }
  return out;
}

// Cada rodada varre so um pedaco do catalogo (rodizio). Se o painel olhar so
// a rodada atual, a pechincha de ontem some da tela hoje sem ter encarecido:
// Buenos Aires-Iguazu a R$ 408, 63% abaixo do teto, saiu do painel na rodada
// seguinte so porque a vez dela no rodizio ja tinha passado.
//
// Entao o painel olha a janela inteira. De cada rota fica a leitura MAIS
// RECENTE, nao a mais barata da janela - a mais barata contaria um preco que
// pode nao existir mais. Dentro da mesma rodada (leituras a menos de 30 min
// uma da outra) vale a data mais barata, que ai e a pergunta certa: de todas
// as datas que olhei agora, qual sai menos.
const MESMA_RODADA_MS = 30 * 60000;

function melhorPorRota(observacoes) {
  const porRota = {};
  for (const o of observacoes) {
    if (o.precisao !== 'alta' || typeof o.precoBRL !== 'number') continue;
    // Sem numero de voo, nao entra no painel. Ponto.
    //
    // Preco sem itinerario atras e um numero que a pagina mostrou e que eu nao
    // consigo verificar: pode ser "a partir de", pode ser so ida, pode ser o
    // chute da leitura estatistica antiga (a que ja pos Miami a R$ 302 no
    // painel). Buenos Aires-Milao apareceu a R$ 2.162, 66% abaixo do teto e
    // companhia em branco, vindo de um registro de antes do leitor estrutural.
    //
    // Essas leituras continuam no historico - as regras de percentil e de
    // mediana por regiao trabalham com distribuicao, onde um numero torto
    // pesa pouco. O painel e recomendacao direta, e ai nao da.
    //
    // Se um dia o Google mudar e a leitura estrutural parar de funcionar, o
    // painel esvazia em vez de encher de numero duvidoso. E o jeito certo de
    // quebrar, e o alarme de saude ja avisa quando a estrategia falha.
    if (!(o.voos && o.voos.length)) continue;
    (porRota[o.rotaId] = porRota[o.rotaId] || []).push(o);
  }
  const out = {};
  for (const [rotaId, lista] of Object.entries(porRota)) {
    const maisNova = Math.max.apply(null, lista.map((o) => Date.parse(o.coletadoEm)));
    const daRodada = lista.filter((o) => maisNova - Date.parse(o.coletadoEm) <= MESMA_RODADA_MS);
    out[rotaId] = daRodada.reduce((a, b) => (a.precoBRL <= b.precoBRL ? a : b));
  }
  return out;
}

module.exports = { gravar, carregar, melhorPorRota, MESMA_RODADA_MS, DIR };
