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

module.exports = { gravar, carregar, DIR };
