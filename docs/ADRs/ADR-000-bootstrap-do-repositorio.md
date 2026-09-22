# ADR 000: Bootstrap do repositório — commit inicial direto e três branches de vida longa

* **Status**: Aceito
* **Data**: 2026-09-21
* **Hora**: 23:40
* **Autor**: Kaue Sabino
* **Revisores**: —
* **Stakeholders envolvidos**: Avaliação do Tech Challenge Fase 3 (13SOAT)

---

## Contexto

O desafio da Fase 3 exige, textualmente:

> * Branch main/master protegida (sem commits diretos).
> * Uso obrigatório de Pull Requests para merge.
> * Deploy automático das branches de homologação e produção.

Este repositório nasceu vazio: `git init` feito, remote configurado, **zero commits**. E
aqui existe uma restrição do GitHub que não tem como ser contornada: **não é possível criar
uma regra de proteção para uma branch que ainda não existe.** Não há branch antes do
primeiro commit, e não há primeiro commit sem um push direto.

Há ainda uma segunda restrição, que só aparece quando o repositório tem um único
colaborador: **o GitHub não permite que o autor aprove o próprio Pull Request.** Com
"Required approvals ≥ 1" e a lista de bypass vazia, todo merge fica bloqueado — inclusive o
PR que corrigiria a regra. E habilitar bypass para administradores desfaz a proteção que se
queria ter: o `git push` direto na `main` volta a passar.

---

## Opções Consideradas

### Opção 1: Ligar a proteção só quando o repositório "estiver pronto"
* **Descrição breve**: trabalhar direto na `main` durante o início e ligar as regras depois.
* **Prós**:
  * [✔️] Nenhum atrito no começo, quando o repositório muda de forma a cada hora.
* **Contras**:
  * [❌] O histórico fica com dezenas de commits diretos na branch protegida. Quem avalia
    olha `git log`, não só a tela de configuração — e o requisito "sem commits diretos"
    aparece descumprido no registro permanente do repositório.
  * [❌] A regra passa a ser uma declaração sobre o futuro, não uma propriedade do repositório.

### Opção 2: Exigir aprovação no PR, com um segundo colaborador
* **Descrição breve**: adicionar outra pessoa com permissão de escrita para aprovar cada PR.
* **Prós**:
  * [✔️] "Uso obrigatório de Pull Requests" fica com revisão humana de verdade.
* **Contras**:
  * [❌] Não é uma decisão que se toma, é uma pessoa que se arruma. Depender de terceiro
    para mergear na véspera da entrega é risco de calendário sem contrapartida.
  * [❌] O usuário `soat-architecture` entra com acesso de leitura e **não** aprova PR.

### Opção 3: Um único commit inicial documentado, três branches, e o gate humano no environment
* **Descrição breve**: um commit direto — o primeiro e último —, criação de `main`,
  `homolog` e `develop`, rulesets ligados imediatamente nas três com **0 aprovações
  exigidas**, e o gate humano deslocado para o `environment: production`.
* **Prós**:
  * [✔️] O requisito do desafio é "uso obrigatório de Pull Requests", que fica integralmente
    cumprido. O desafio **não** exige aprovação.
  * [✔️] Com a lista de bypass vazia, `git push origin main` é rejeitado pelo servidor com
    `GH006` **inclusive para o dono** — a proteção é demonstrável, não declarada.
  * [✔️] O gate humano não desaparece: muda de lugar. Em GitHub Environments o autor do
    deployment **pode** aprová-lo, então a aprovação de produção funciona com um único
    colaborador. O repositório-base já usa `environment: production` no deploy.
  * [✔️] `git log --first-parent main` mostra exatamente um commit direto, e este ADR
    explica o porquê.
* **Contras**:
  * [❌] Existe um commit direto no histórico. Inevitável, dada a restrição do GitHub.
  * [❌] Sem revisão humana obrigatória por PR, a qualidade fica apoiada nos status checks.

---

## Decisão

Adotar a **Opção 3**.

1. **Um** commit direto na `main` — `chore: estrutura inicial do repositório` —, contendo
   apenas andaime: README, licença, `.gitignore`, `.editorconfig`, `CONTRIBUTING.md`,
   templates de PR, ADR e RFC, `CODEOWNERS`, `dependabot.yml` e este ADR. **Nenhuma regra de
   negócio e nenhum recurso de infraestrutura.**
2. `develop` e `homolog` criadas a partir da `main`, no mesmo commit.
3. Rulesets ligados **imediatamente** nas três, com: PR obrigatório · **0 aprovações** ·
   sem exclusão · sem force push · resolução de conversas · histórico linear **desligado**
   (senão os merge commits de promoção seriam bloqueados) · branches atualizadas só na
   `main` · **lista de bypass vazia**.
4. Status checks obrigatórios ficam **desligados até o CI existir e ser visto verde uma
   vez**. Com a lista de bypass vazia, um check que nunca reporta bloqueia até o PR que o
   consertaria.
5. Gate humano no `environment: production`, com **"Prevent self-review" desligado**.
6. Daqui em diante, **nada** entra em `main`, `homolog` ou `develop` fora de Pull Request.

---

## Justificativa

A escolha separa dois requisitos que costumam ser confundidos: *revisão por PR* e *gate de
produção*. O desafio exige o primeiro; o segundo é boa prática que continua entregue, via
environment, sem depender de uma segunda pessoa.

O ponto que decide entre a Opção 1 e a Opção 3 é o **histórico**. Uma regra de proteção
ligada depois de vinte commits diretos protege o futuro e denuncia o passado, e o registro
permanece no repositório. Um commit inicial explicado é decisão; vinte commits diretos são
descuido — e a diferença entre os dois, para quem avalia, é exatamente este arquivo.

---

## Consequências

### Positivas

* [✔️] `git push origin main` rejeitado com `GH006` mesmo para o dono — proteção
  demonstrável em vídeo.
* [✔️] `git log --first-parent main` prova que só existe um commit fora de PR.
* [✔️] O merge nunca trava por falta de aprovador.
* [✔️] O gate humano de produção é gravável: a tela "Review deployments" e a linha de log
  com usuário e horário.

### Negativas / Riscos

* [⚠️] Sem revisão humana obrigatória, um erro só é pego pelos status checks — daí o lint
  ser bloqueante e a cobertura ter limite global desde o primeiro commit.
* [⚠️] "Prevent self-review" ligado por engano no environment trava o deploy de produção,
  com o mesmo efeito que se queria evitar. É item de verificação antes de qualquer
  demonstração.
* [⚠️] Se houver um segundo colaborador com escrita, esta decisão deve ser revista: com
  aprovador disponível, exigir 1 aprovação é estritamente melhor.

---

## Ações Imediatas

* [x] Commit inicial na `main`.
* [x] Criar `develop` e `homolog`.
* [x] Ligar os rulesets nas três branches, sem status checks.
* [ ] Convidar `soat-architecture` e confirmar que a lista de convites pendentes fica vazia.
* [ ] Desligar "Prevent self-review" no `environment: production`.
* [ ] Acrescentar `homolog` aos gatilhos do CI **antes** de ligar os status checks obrigatórios.
* [ ] Ligar cada status check só depois de vê-lo verde uma vez.

---

## Lições Aprendidas

Restrição de ferramenta não some por ser inconveniente. O que distingue uma entrega
cuidadosa é nomear a restrição, escolher conscientemente como conviver com ela e deixar o
registro — em vez de deixar que ela apareça sozinha no histórico.

---

## Referências

* Desafio Tech Challenge Fase 3 (13SOAT) — seção "Regras de proteção"
* Repositório-base das Fases 1 e 2: https://github.com/DevKaue/TechChallange
* GitHub Docs — Rulesets, e Environments com required reviewers
