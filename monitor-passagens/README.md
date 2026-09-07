# Monitor de passagens

Origem fixa, **destino aberto**. Ele sai de **Montevideu**, **Sao Paulo**
(GRU/CGH/VCP) e **Buenos Aires** (EZE/AEP) pra 63 destinos, e avisa quando
alguma coisa esta com preco bom - seja Recife, Santiago, Cancun ou Lisboa.

Roda de graca no GitHub Actions. Sem servidor, sem API paga, sem `npm install`.

## Onde voce ve as passagens

Dois lugares, com papeis diferentes:

- **[`RANKING.md`](RANKING.md) — o painel.** Reescrito a cada rodada com o que
  esta barato agora: os 20 melhores por preco/km e o melhor de cada origem,
  com preco tambem em pesos uruguaios e dolar. E markdown de proposito: o
  GitHub renderiza bonito mesmo em repositorio privado, inclusive no app do
  celular. Sem Pages, sem deploy, sem plano pago — voce abre o arquivo e ve.
  Este e o lugar de "bateu vontade de viajar, o que tem barato?".

- **Issue — o alerta.** Quando alguma coisa dispara uma das quatro regras, o
  robo abre uma issue e o GitHub te manda e-mail e push no celular. Este e o
  lugar de "apareceu uma pechincha, corre". Telegram e opcional, veja no fim.

Um voce puxa, o outro te empurra.

## O que ele varre

**Origens** (fixas): Montevideu · Sao Paulo (3 aeroportos) · Buenos Aires (2).

**Destinos** (`destinos.json`, 63 no total):

| regiao | destinos |
|---|---|
| Brasil | 21 — SP, Rio, POA, Floripa, Curitiba, Brasilia, BH, Recife, Salvador, Fortaleza, Natal, Maceio, Joao Pessoa, Belem, Manaus, Sao Luis, Vitoria, Goiania, Cuiaba, Campo Grande, Foz |
| Argentina | 8 — Bariloche, Iguazu, Mendoza, Ushuaia, Salta, El Calafate, Neuquen, Tucuman |
| America do Sul | 12 — Santiago, Lima, Cusco, Bogota, Medellin, Cartagena, Quito, Guayaquil, Assuncao, Santa Cruz, La Paz, Panama |
| America do Norte | 9 — Miami, Orlando, Nova York, LA, Chicago, Atlanta, Toronto, Cidade do Mexico, Cancun |
| Europa | 11 — Lisboa, Porto, Madri, Barcelona, Paris, Roma, Milao, Londres, Amsterda, Frankfurt, Istambul |

Sao **186 pares** origem-destino. Horizonte de 14 a 240 dias.

## Como ele cobre tudo isso sem estourar a cota

Varrer os 186 pares de uma vez levaria uns 25 minutos por rodada. Entao a fila
e dividida em duas:

- **fixas** — o triangulo Montevideu/Sao Paulo/Buenos Aires mais Rio, Porto
  Alegre e Santiago entram em **todas** as rodadas.
- **rodizio** — o resto do catalogo entra por fatia, e o cursor avanca a cada
  rodada. Em ~7 rodadas o catalogo inteiro foi visitado, ou seja **menos de
  2 dias**.

Sao 130 consultas por rodada (~6 min), 4 rodadas por dia. Em repositorio
privado isso da uns **880 minutos por mes**, dentro dos 2.000 gratuitos do
Actions. Pra gastar menos, baixe `varredura.consultasPorRodada` no
`config.json` ou tire uma rodada do cron.

As datas tambem giram a cada rodada, entao com o tempo ele cobre o calendario
todo em vez de bater sempre nos mesmos dias.

## Quando ele te avisa

Com destino aberto, "barato" deixa de ter um numero so: R$ 900 pra Buenos
Aires (229 km) e caro, pra Londres (11.018 km) e uma pechincha historica. Sao
quatro regras, e basta uma pra disparar:

1. **Teto por faixa de distancia** — vale desde a primeira rodada, sem
   depender de historico:

   | distancia | teto |
   |---|---|
   | ate 500 km | R$ 350 |
   | ate 1.500 km | R$ 550 |
   | ate 3.000 km | R$ 750 |
   | ate 6.000 km | R$ 1.300 |
   | ate 10.000 km | R$ 2.400 |
   | acima | R$ 3.200 |

2. **Percentil da rota** — entre os 10% mais baratos ja vistos naquela rota
   nos ultimos 90 dias. A regra mais precisa, mas so acorda depois de ~25
   leituras daquela rota.

3. **Barato pra regiao** — abaixo de 60% da mediana daquela regiao saindo
   daquela origem. **Esta e a que resolve a partida a frio**: uma rota nova
   nao tem historico proprio, mas "Europa saindo de Montevideu" junta dezenas
   de leituras em poucos dias, entao da pra comparar com os vizinhos. Foi ela
   que pegou Barcelona a R$ 2.100 num teste, sem nunca ter visto essa rota.

4. **Queda** — o mesmo voo caiu 25% ou mais contra a mediana de 7 dias.

Cada alerta nao se repete por 48 horas.

## Preco por km

Toda leitura guarda a distancia em linha reta e o **preco por km**. E o unico
jeito honesto de comparar uma pechincha pra Recife com uma pechincha pra
Madri, e e por ele que o resumo de cada rodada ordena o ranking dos 20
melhores. Voo curto sempre custa mais por km — compare dentro da mesma faixa.

## Milhas (LATAM Pass)

Nenhum programa brasileiro tem API publica e gratuita de busca de resgate.
Entao o monitor ataca milhas por dois lados que custam zero:

- **Feeds de promocao** (Melhores Destinos, Passageiro de Primeira, Pontos pra
  Voar, Mestre das Milhas, Viaje na Viagem). E por ali que passa promocao
  relampago, tarifa que so existe no site da companhia e promocao de milhas:
  transferencia bonificada, queima de milhas, LATAM Pass em desconto.
  Promocao do seu programa passa no filtro **mesmo sem citar rota** — "LATAM
  Pass com 100% de bonus" interessa independente do destino.
- **Teto de milhas em cada alerta de preco.** Sabendo o preco em dinheiro, ele
  calcula quantas milhas o resgate teria que custar pra valer a pena:

  ```
  milhas_max = (preco - taxa_de_embarque) / valor_do_milheiro * 1000
  ```

  Com o padrao (R$ 20 o milheiro, R$ 180 de taxa), um voo de R$ 2.100 vira
  *"so compensa ate ~96.000 milhas + taxas"*. Ai voce abre o latam.com, ve a
  cotacao do resgate e decide na hora. Ajuste `milhas.valorPorMilheiroBRL`.

## De onde vem o preco

| fonte | custo | chave | o que da |
|---|---|---|---|
| Google Flights | zero | nao | preco real por data, todas as cias |
| Feeds RSS de promocao | zero | nao | promocao relampago e de milhas |
| Travelpayouts | zero | opcional | JSON limpo, dia mais barato do mes |
| open.er-api.com | zero | nao | cotacao pra mostrar em $U e US$ |

### Como o preco e lido

Cada itinerario e renderizado assim na pagina:

```html
<div class="YMlIz FpEdX jLMuyc">
  <span data-gs="Cj...Eg1BUjEzODN8QVIxMjQw..."
        aria-label="2424 Reais brasileiros" role="text">
```

A leitura **ancora nisso**, e nao em procurar "R$" pelo HTML:

- o `aria-label` da o preco num formato exato. So itinerario tem esse rotulo,
  entao numero solto da pagina nao entra;
- o `data-gs` e um protobuf em base64 cujo campo 2 e a lista de voos,
  `AR1383|AR1240`. Dai saem os numeros de voo e, pelo prefixo IATA, a
  **companhia da tarifa** - nao a lista de cias citadas na pagina.

Se o Google mudar essa estrutura, a leitura cai numa **rede estatistica** que
adivinha qual numero da pagina e passagem (menor preco que se repete; pagina
com menos de 40 precos e recusada). Cada leitura registra em `leitura` qual
dos dois caminhos foi usado, entao da pra ver no painel e no log o dia em que
a estrutura quebrar. Quando cai na rede, a companhia fica **vazia** - nunca
chutada.

### As duas estrategias de URL

O Google Flights nao tem API oficial: o monitor monta a mesma URL que o site
usa. Duas estrategias, as duas testadas rodando no Actions:

- **`q`** (primaria) — busca em texto. Para ida e volta a frase que o Google
  entende e `from X to Y D1 through D2`; ha cinco variantes no codigo e o
  `--diagnostico` mede qual responde. Se nenhuma funcionar, a consulta cai
  pra so ida da mesma rota e a leitura e **rotulada como so ida**, em vez de
  passar por ida e volta.
- **`tfs`** (reserva) — o parametro protobuf que o site usa. Precisa do
  parametro `tfu` junto, senao o Google monta a pagina e nao executa a busca.
  Com ele funciona, mas a pagina vem com a grade de datas vizinhas (~750
  precos), entao o menor pode ser de outro dia. Por isso leitura via `tfs`
  entra como **precisao baixa**: fica no historico pra nao perder cobertura,
  mas nao gera alerta nem entra na base das estatisticas.

Se o `q` comecar a falhar muito, a rodada avisa no resumo do Actions em vez de
emudecer: acima de 30% das leituras em precisao baixa vira aviso explicito.

## Testes

```bash
node teste.js
```

Sem rede e sem dependencia, roda em menos de um segundo, e roda no CI **antes**
da coleta. Existem por causa de dois bugs que chegaram em producao:

- um `const` declarado dentro de um `else` e usado fora dele. Erro de
  execucao, entao `node --check` nao viu; a coleta inteira foi a zero.
- campos de companhia e voos que se perderam entre a leitura e a observacao,
  porque uma edicao mirou em texto ja reescrito e virou no-op silencioso. O
  painel saiu com a coluna vazia e nada acusou.

Dai a regra que os testes cobrem: **o que decide alguma coisa e funcao pura**
(`lerPagina`, `montarObservacao`, `avaliar`, `montarFila`) **e o teste confere
o objeto de retorno inteiro**, nao so o campo que interessava na hora.

## Rodando na mao

```bash
node monitor.js --diagnostico    # testa cada fonte e diz qual esta viva
node monitor.js --limite=5       # rodada curta
node monitor.js --rota=MVD-LIS   # so uma rota
node monitor.js --sem-alerta     # coleta e grava, nao notifica
```

## Arquivos

```
destinos.json        origens fixas + catalogo de destinos com coordenadas
config.json          varredura, tetos por distancia, regras, valor do milheiro
monitor.js           orquestra a rodada
lib/catalogo.js      monta a fila, rodizio e distancias
lib/fontes/itinerario.js  leitura estrutural: preco, companhia e voos
teste.js             testes offline, rodam antes da coleta no CI
lib/fontes/          um adaptador por fonte de dados
historico/           serie historica em NDJSON, um arquivo por mes
RANKING.md           o painel: o que esta barato agora (abra este)
ultimo.json          os mesmos dados em JSON, pra quem quiser processar
estado.json          cursor do rodizio e controle de alerta repetido
```

O historico e commitado no repo de proposito: e ele que faz as regras 2, 3 e 4
funcionarem, e assim voce nunca perde os dados.

## Adicionar um destino

No `destinos.json`:

```json
{ "id": "MVD", "cidade": "Montevideo", "regiao": "cone-sul",
  "lat": -34.84, "lon": -56.03, "fixo": false }
```

`lat`/`lon` sao obrigatorios (sem eles nao da pra calcular distancia nem teto).
`fixo: true` faz entrar em todas as rodadas em vez do rodizio — use com
parcimonia, cada fixo custa 3 consultas por rodada.

## Ajustes que valem a pena

- **Alerta demais** → suba `alertas.percentilAlvo` de 10 pra 5, ou baixe os
  `tetosPorDistancia`.
- **Alerta de menos** → o contrario, ou baixe `regiaoFracaoDaMediana` de 0.6
  pra 0.7.
- **Economizar Actions** → `varredura.consultasPorRodada` menor, ou menos
  horarios no cron.

## Telegram (opcional)

Crie os secrets `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`. Sem eles, so a
issue e aberta.

## Limites honestos

- Preco de busca nao e garantia de venda. Confirme no site da cia.
- Scraping quebra: por isso o diagnostico roda a cada push, existem duas
  estrategias e uma fonte de reserva.
- O runner do GitHub tem IP de datacenter. Se o Google passar a bloquear,
  aumente `googleFlights.pausaMs`, ligue o Travelpayouts, ou rode na sua
  maquina — o codigo e o mesmo.
- Busca de resgate ao vivo em milhas exigiria login automatizado nos
  programas, que da problema de 2FA e risco pra sua conta. Ficou de fora de
  proposito.
