# ADR [número]: [Título da decisão]

* **Status**: [Rascunho | Proposto | Aceito | Rejeitado | Substituído]
* **Data**: [AAAA-MM-DD]
* **Hora**: [HH:MM]
* **Autor**: [Nome do autor]
* **Revisores**: [Nomes dos revisores, se houver]
* **Stakeholders envolvidos**: [Times, pessoas ou áreas impactadas]

---

## Contexto

Escreva o problema ou cenário que levou à necessidade de tomar essa decisão. Inclua informações relevantes como:
- necessidade de negócio,
- limitações técnicas,
- gargalos detectados,
- requisitos não funcionais impactados (ex: performance, escalabilidade, segurança).

Exemplo:
> A API de consulta de pedidos está apresentando alta latência, afetando a experiência do usuário em horários de pico. Precisamos reduzir o tempo de resposta e o número de acessos ao banco de dados.

---

## Opções Consideradas

Apresente as alternativas que o time avaliou para resolver o problema, destacando os prós e contras de cada uma.

### Opção 1: [Nome da Alternativa 1]
* **Descrição breve**: [O que é e como funciona essa alternativa]
* **Prós**:
  * [✔️] [Ponto positivo]
  * [✔️] [Ponto positivo]
* **Contras**:
  * [❌] [Ponto negativo]
  * [❌] [Ponto negativo]

### Opção 2: [Nome da Alternativa 2]
* **Descrição breve**: [O que é e como funciona essa alternativa]
* **Prós**:
  * [✔️] [Ponto positivo]
* **Contras**:
  * [❌] [Ponto negativo]

---

## Decisão

Declare claramente a decisão tomada (qual das opções acima foi a escolhida).
> Exemplo: Adotar a **Opção 1 (Cache Redis)** com TTL de 10 minutos para todas as requisições GET em `/pedidos`.

![Fluxo de Decisão](https://raw.githubusercontent.com/seu-usuario/repositorio/main/docs/fluxo-decisao.png)

---

## Justificativa

Explique os motivos que levaram à escolha da opção vencedora em detrimento das outras:
- Critérios usados na análise (custo, tempo de implementação, curva de aprendizado, risco, alinhamento com a estratégia, etc).
- Por que os "Contras" da opção escolhida foram considerados aceitáveis.

---

## Consequências

Liste os impactos positivos e negativos, técnicos e organizacionais do caminho escolhido:

### Positivas

* [✔️] Redução de latência em 80%
* [✔️] Redução de carga no banco de dados

### Negativas / Riscos

* [⚠️] Cache pode entregar dados desatualizados
* [⚠️] Maior complexidade para invalidar cache em atualizações

---

## Ações Imediatas

* [ ] [Descreva as ações a serem tomadas]
* [ ] [Por exemplo: implementar cache, configurar métricas, treinar time]

---

## Lições Aprendidas

(Opcional) Registre aprendizados do processo, boas práticas identificadas ou erros a evitar no futuro.

---

## Referências

(Opcional)

* [Link para documentação técnica ou pesquisa usada]
* [Artigos, RFCs, padrões, tutoriais]