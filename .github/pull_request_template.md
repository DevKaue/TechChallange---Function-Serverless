## O que muda

<!-- Uma frase. O "porquê" vai na descrição abaixo, não aqui. -->

## Critério de aceite coberto

<!-- ID do AC (ex.: AC-A2 borda, AC-B1 erro). Se o PR não fecha nenhum AC, diga
     qual dívida ele paga ou qual armadilha ele evita. -->

## Teste que prova

<!-- Nome do arquivo e do caso. "Rodei local" não é teste; teste é código que
     falha se a mudança regredir. -->

## Evidência

<!-- Link do run verde, ou print quando o artefato não é HTTP (ruleset, gate,
     colaborador). -->

## Impacto de custo de infraestrutura

- [ ] Não cria nem redimensiona recurso cobrado
- [ ] Cria/redimensiona — valor estimado por dia: `US$ ____` e o porquê:

## Checklist

- [ ] Documentação atualizada **neste mesmo PR** (README, ADR/RFC, diagrama)
- [ ] Comentário novo explica o **porquê** e a armadilha observável, não o que a linha faz
- [ ] Nenhum segredo, endpoint literal ou ID de conta no diff
- [ ] Método de merge correto: **squash** para `feat/* → develop`; **merge commit** para
      `develop → homolog` e `homolog → main` (squash em promoção faz as branches
      divergirem permanentemente)
