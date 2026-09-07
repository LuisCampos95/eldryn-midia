# Monitor de passagens

Vigia preco de passagem saindo de **Montevideu** e **Buenos Aires** para **Sao
Paulo** (e voos internos da Argentina), avisa quando aparece coisa barata, e
guarda o historico pra saber o que e "barato" de verdade.

Roda de graca no GitHub Actions. Sem servidor, sem cadastro, sem API paga,
sem `npm install`.

## Como voce e avisado

Quando algo dispara alerta, o robo **abre uma issue neste repositorio**. O
GitHub ja te manda e-mail (e notificacao no celular, se voce tem o app), entao
nao precisa configurar nada. Telegram e opcional, veja no fim.

## O que ele vigia

| rota | prioridade | teto |
|---|---|---|
| Montevideu -> Sao Paulo (GRU/CGH/VCP) | alta | R$ 900 |
| Sao Paulo -> Montevideu | alta | R$ 900 |
| Buenos Aires (EZE/AEP) -> Sao Paulo | alta | R$ 800 |
| Sao Paulo -> Buenos Aires | media | R$ 800 |
| Montevideu -> Buenos Aires | baixa | R$ 350 |
| Buenos Aires -> Bariloche / Iguazu / Mendoza / Ushuaia | baixa | R$ 450-700 |

Os tres aeroportos de Sao Paulo entram numa consulta so, entao tanto faz se a
promocao e de Guarulhos, Congonhas ou Viracopos: se for barata, voce fica
sabendo.

Horizonte: de 14 a 180 dias a frente. Cada rodada varre datas espacadas de 7
em 7 dias e **desloca o ponto de partida a cada rodada**, entao em poucos dias
o monitor ja passou por todas as datas do periodo.

## Quando ele te avisa

Tres regras, e basta uma pra disparar:

1. **Teto** — preco abaixo do valor que voce definiu pra rota no `config.json`.
2. **Percentil** — preco entre os 10% mais baratos que ja vimos nessa rota nos
   ultimos 90 dias. Precisa de pelo menos 25 leituras acumuladas.
3. **Queda** — o mesmo voo caiu 25% ou mais contra a mediana dos ultimos 7 dias.

A regra 1 funciona desde o primeiro dia. As regras 2 e 3 sao as boas, e elas
**precisam de historico**: nas primeiras semanas o robo coleta calado e vai
ficando mais esperto. Isso e esperado, nao e defeito.

Cada alerta nao se repete por 48 horas (`cooldownHoras`).

## Milhas (LATAM Pass)

Nenhum programa brasileiro tem API publica e gratuita de busca de resgate.
Entao o monitor ataca milhas por dois lados que custam zero:

- **Feeds de promocao** (Melhores Destinos, Passagens Imperdiveis e cia).
  E por ali que passa promocao relampago, tarifa que so existe no site da
  companhia e promocao de milhas: transferencia bonificada, queima de milhas,
  LATAM Pass em desconto. Os itens sao filtrados pelas suas rotas antes de
  virar alerta.
- **Teto de milhas em cada alerta de preco.** Como o alerta sabe o preco em
  dinheiro, ele calcula quantas milhas o resgate teria que custar pra valer a
  pena, usando o valor que voce da ao milheiro:

  ```
  milhas_max = (preco - taxa_de_embarque) / valor_do_milheiro * 1000
  ```

  Com o padrao (R$ 20 o milheiro, R$ 180 de taxa), um voo de R$ 1.200 vira
  *"so compensa ate ~51.000 milhas + taxas"*. Ai voce abre o latam.com, ve a
  cotacao do resgate e decide na hora, sem achismo. Ajuste
  `milhas.valorPorMilheiroBRL` pro que voce realmente considera justo.

## De onde vem o preco

| fonte | custo | chave | o que da |
|---|---|---|---|
| Google Flights | zero | nao | preco real por data, todas as cias |
| Feeds RSS de promocao | zero | nao | promocao relampago e de milhas |
| Travelpayouts | zero | opcional | JSON limpo, dia mais barato do mes |
| open.er-api.com | zero | nao | cotacao pra mostrar em $U e US$ |

O Google Flights nao tem API oficial: o monitor monta a mesma URL que o site
usa. Por isso existem **duas estrategias** (`tfs`, o parametro protobuf do
proprio Google, e `q`, a busca em texto). Se uma quebrar, ele cai na outra
sozinho. Se as duas quebrarem, os feeds continuam funcionando.

## Rodando na mao

```bash
cd monitor-passagens

node monitor.js --diagnostico    # testa cada fonte e diz qual esta viva
node monitor.js --limite=5       # rodada curta
node monitor.js --rota=MVD-SAO   # so uma rota
node monitor.js --sem-alerta     # coleta e grava, nao notifica
```

Fora do GitHub Actions ele nao consegue abrir issue (falta o token) e avisa
isso no log — o resto funciona igual.

## Arquivos

```
config.json          rotas, tetos, horizonte, regras de alerta, valor do milheiro
monitor.js           orquestra a rodada
lib/fontes/          um adaptador por fonte de dados
historico/           serie historica em NDJSON, um arquivo por mes
ultimo.json          foto do melhor preco de cada rota na ultima rodada
estado.json          controle de alerta repetido
```

O historico e commitado no repo de proposito: e ele que faz as regras 2 e 3
funcionarem, e assim voce nunca perde os dados.

## Ajustes que valem a pena

Tudo no `config.json`:

- **Baixar o teto** de uma rota se estiver enchendo o saco com alerta demais.
- **`percentilAlvo`** de 10 pra 5 deixa o alerta mais raro e mais valioso.
- **Adicionar rota**: coloque o grupo de aeroportos em `grupos`, o nome da
  cidade em `cidades` e a rota em `rotas`.
- **`googleFlights.pausaMs`**: se o Google comecar a bloquear, aumente.

## Telegram (opcional)

Se preferir alerta no celular na hora, crie os secrets `TELEGRAM_BOT_TOKEN` e
`TELEGRAM_CHAT_ID` no repositorio. Sem eles, so a issue e aberta.

## Travelpayouts (opcional)

Cadastro gratuito em travelpayouts.com, pegue o token e salve como secret
`TRAVELPAYOUTS_TOKEN`. Sem ele essa fonte fica desligada e nada quebra.

## Limites honestos

- Preco de busca nao e garantia de venda. Confirme no site da cia.
- Scraping quebra: por isso o diagnostico roda a cada push e existem duas
  estrategias e uma fonte de reserva.
- O runner do GitHub tem IP de datacenter. Se o Google passar a bloquear,
  aumente `pausaMs`, ou ligue o Travelpayouts, ou rode o `monitor.js` na sua
  maquina — o codigo e o mesmo.
- Milhas em dinheiro so entram por estimativa (teto de milhas) e pelos feeds.
  Busca de resgate ao vivo exigiria login automatizado nos programas, que da
  problema de 2FA e risco pra sua conta. Ficou de fora de proposito.
