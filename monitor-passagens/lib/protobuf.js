// Codificador protobuf minimo. So o suficiente pra montar o parametro `tfs`
// do Google Flights, que e um protobuf serializado em base64url.
//
// Nao existe biblioteca aqui de proposito: o repo roda sem `npm install`,
// e sao ~40 linhas.

function varint(n) {
  const bytes = [];
  let v = n;
  while (v > 127) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

// wire type 0 = varint, 2 = length-delimited
function tag(campo, wire) {
  return varint(campo * 8 + wire);
}

function campoInt(campo, valor) {
  return Buffer.concat([tag(campo, 0), varint(valor)]);
}

function campoString(campo, valor) {
  const b = Buffer.from(String(valor), 'utf8');
  return Buffer.concat([tag(campo, 2), varint(b.length), b]);
}

function campoMensagem(campo, buffer) {
  return Buffer.concat([tag(campo, 2), varint(buffer.length), buffer]);
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

module.exports = { varint, campoInt, campoString, campoMensagem, base64url };
