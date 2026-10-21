# ADR 001: Composição no primeiro request e Lambda Authorizer sem consulta ao banco

* **Status**: Aceito. A parte do Lambda Authorizer foi substituída pelo [ADR-002](ADR-002-kong-invoca-a-funcao-sem-api-gateway.md)
* **Data**: 2026-09-27
* **Hora**: 22:30
* **Autor**: Kaue Sabino
* **Revisores**: —
* **Stakeholders envolvidos**: Avaliação do Tech Challenge Fase 3 (13SOAT); aplicação principal (consumidora do JWT)

---

## Contexto

A função precisa de três dependências externas antes de atender a primeira requisição:
o segredo do JWT e os parâmetros do banco, ambos no SSM, e uma conexão TLS com o RDS.
Duas decisões ficaram em aberto na F3:

1. **Onde montar essas dependências.** O caminho óbvio é o escopo do módulo, com
   top-level await, para aproveitar o init da Lambda. O sintoma observável quando o SSM
   falha nesse momento é `Runtime.InitError`: o API Gateway devolve **502 sem corpo**, o
   container morto é reciclado a cada requisição e o cliente não recebe `correlationId`
   nenhum para o suporte rastrear.
2. **O que o Lambda Authorizer verifica.** O desafio pede que rotas sensíveis sejam
   protegidas por autenticação via CPF. O token já carrega o `sub` do cliente; a dúvida é
   se o Authorizer deve reconsultar o status do cliente a cada requisição protegida.

---

## Opções Consideradas

### Opção 1: Montagem no init do módulo
* **Prós**:
  * [✔️] Usa o tempo de init, que não é cobrado até 10 s.
* **Contras**:
  * [❌] Falha de SSM vira 502 sem corpo, fora do contrato 400/401/503.
  * [❌] Falha transitória derruba o container; não há "tentar de novo" dentro dele.

### Opção 2: Montagem preguiçosa no primeiro request, com retry na falha
* **Prós**:
  * [✔️] Falha vira resposta do contrato: 503 com `correlationId` (autenticação) ou negação (Authorizer).
  * [✔️] A promessa de montagem só fica em cache quando dá certo; a próxima invocação tenta de novo.
  * [✔️] Toda a montagem recebe portas injetadas (env, SSM, leitura da CA, criação do pool) e é testável com fakes.
* **Contras**:
  * [❌] O primeiro request de cada container paga a latência do SSM e da conexão TLS.

### Opção 3: Authorizer reconsulta o status do cliente
* **Prós**:
  * [✔️] Bloqueio de cliente vale imediatamente.
* **Contras**:
  * [❌] Uma conexão e uma consulta por requisição protegida, somadas ao tráfego da aplicação inteira, contra o teto de ~110 conexões da db.t4g.micro.
  * [❌] O Authorizer passaria a precisar de rede para a VPC, SG de cliente e permissão no path do banco.

### Opção 4: Authorizer valida só o token
* **Prós**:
  * [✔️] Sem rede, sem banco, sem permissão no path `/db/*`: menor superfície.
  * [✔️] Custo e latência constantes por requisição.
* **Contras**:
  * [❌] Um cliente bloqueado depois de autenticar continua com acesso até o `exp` (1 h).

---

## Decisão

**Opção 2** para a montagem das duas funções e **Opção 4** para o Authorizer.

O Authorizer verifica: algoritmo `HS256` (lista explícita), emissor
`techchallenge-auth-lambda`, `type = customer`, expiração, `nbf` e `sub` em formato UUID.
Qualquer caminho inesperado **nega** e nunca lança exceção.

---

## Justificativa

A escolha entre as opções 1 e 2 é decidida pelo contrato: o README promete 400/401/503, e
um 502 sem corpo quebra essa promessa exatamente no incidente em que o suporte mais
precisa do `correlationId`.

A escolha entre 3 e 4 é decidida pela janela de risco: o token já expira em 1 h, e a
checagem de emissor e `type` fecha o caso mais perigoso — um JWT administrativo da
aplicação principal, assinado com o mesmo segredo, abrindo rotas de cliente.

---

## Consequências

### Positivas
* [✔️] Nenhuma falha de dependência sai como 502; todas saem no contrato e com log `bootstrap.error`.
* [✔️] O Authorizer não tem permissão de IAM no path do banco.

### Negativas / Riscos
* [⚠️] Primeiro request por container mais lento. Medir no dashboard de latência e reavaliar provisioned concurrency se passar do SLO.
* [⚠️] Janela de até 1 h para bloqueio de cliente valer. Registrada como dívida no README.

---

## Referências

* `src/infra/http/lazy-handler.ts` e `src/infra/composition/auth-composition.ts`
* `src/infra/security/jsonwebtoken-token.verifier.ts` e `src/infra/http/authorizer-http.handler.ts`
* [ADR-000](ADR-000-bootstrap-do-repositorio.md)
