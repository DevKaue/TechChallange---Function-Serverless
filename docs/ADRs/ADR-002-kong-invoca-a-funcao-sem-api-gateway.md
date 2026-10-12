# ADR 002: O Kong invoca a função direto, sem API Gateway nem Lambda Authorizer

* **Status**: Aceito
* **Data**: 2026-10-09
* **Hora**: 19:30
* **Autor**: Kaue Sabino
* **Revisores**: —
* **Stakeholders envolvidos**: Repositórios da aplicação e da infraestrutura Kubernetes; avaliação do Tech Challenge Fase 3 (13SOAT)

---

## Contexto

O [ADR-005 do repositório da aplicação](https://github.com/DevKaue/tech-challenge-app-/blob/develop/docs/ADRs/ADR-005-kong-como-api-gateway.md)
trocou o AWS API Gateway pelo Kong rodando no EKS. Para este repositório, isso muda quatro coisas:

1. O `POST /auth` chega pelo plugin `aws-lambda` do Kong, que invoca a função com
   `awsgateway_compatible: true`. O evento vem no formato **REST (v1.0)**, e o handler só
   aceitava o v2.0 do HTTP API.
2. As rotas protegidas são validadas pelo plugin `jwt` do Kong, com `key_claim_name: iss`.
   O Lambda Authorizer da F3 ([ADR-001](ADR-001-composicao-no-primeiro-request-e-authorizer-sem-banco.md))
   deixa de ter quem o chame.
3. O Kong só tem permissão de invocar `techchallenge-auth-<env>`, com `staging` para a
   `develop` e a `homolog`, e `prod` para a `main`.
4. No AWS Academy a conta não permite criar roles. A função roda com a **LabRole**
   existente, e o Kong invoca com a LabRole do nó, via IMDSv2.

---

## Opções Consideradas

### Opção 1: Trocar o handler de v2.0 para v1.0
* **Prós**:
  * [✔️] Um formato só.
* **Contras**:
  * [❌] Prende a função ao Kong: o teste local, a integração e qualquer gateway HTTP API futuro passam a precisar de outro adaptador.

### Opção 2: Adaptador que aceita v1.0 e v2.0 (escolhida)
* **Prós**:
  * [✔️] O handler continua o mesmo; só a leitura do evento muda (`src/infra/http/http-event.ts`).
  * [✔️] O teste local e o smoke com evento v2.0 continuam valendo.
  * [✔️] A resposta `{statusCode, headers, body}` é a mesma nos dois formatos e é o que o Kong lê com `is_proxy_integration: true`.
* **Contras**:
  * [❌] Dois formatos para manter nos testes.

---

## Decisão

**Opção 2**, e o Lambda Authorizer é **removido** do repositório: código, testes e
documentação. A validação das rotas protegidas é do plugin `jwt` do Kong e, de novo, da
aplicação (RFC-001 do repositório da aplicação).

O contrato do token não muda: HS256, `iss: techchallenge-auth-lambda`, `type: customer`,
`sub` com o id do cliente e `exp` de 1 h. O segredo continua sendo lido do SSM em
`JWT_SECRET_SSM_PATH=/techchallenge/<env>/auth/jwt-secret`, agora criado pelo repositório
de infraestrutura Kubernetes.

---

## Justificativa

- O adaptador normaliza só o que o handler usa: headers, body, `isBase64Encoded` e o
  requestId. No v1.0 `headers` e `body` chegam como `null`, e o `requestContext` é montado
  pelo Kong; qualquer campo ausente cai num valor seguro em vez de virar exceção, porque
  exceção no handler sai como erro do gateway, fora do contrato 400/401/503.
- O correlation id aceita `#`: o plugin `correlation-id` do Kong gera `<uuid>#<n>`, e sem
  isso todo id vindo do gateway seria trocado pelo requestId, perdendo a correlação entre o
  log do Kong e o da função.
- Manter o Authorizer "por garantia" seria código sem chamador, com IAM e testes para
  manter.

---

## Consequências

### Positivas
* [✔️] Uma função só, um handler só (`handler.handler`).
* [✔️] Nenhum recurso de API Gateway no Terraform, e nenhuma role criada.

### Negativas / Riscos
* [⚠️] O bloqueio de cliente continua valendo só no próximo login (até 1 h), agora porque o plugin `jwt` também não consulta o banco. A aplicação pode fechar essa janela ao validar `type: customer` (pendência da RFC-001).
* [⚠️] No AWS Academy, qualquer pod do nó tem a LabRole e pode invocar a função. Aceito pelo ADR-005; deixa de ser aceitável fora do Academy, onde o caminho é IRSA.

---

## Referências

* `src/infra/http/http-event.ts` e `src/infra/http/auth-http.handler.ts`
* ADR-005 e RFC-001 do repositório da aplicação
* [ADR-001](ADR-001-composicao-no-primeiro-request-e-authorizer-sem-banco.md), parcialmente substituído por este
