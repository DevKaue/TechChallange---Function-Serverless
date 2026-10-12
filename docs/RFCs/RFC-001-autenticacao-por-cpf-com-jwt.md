# RFC 001: Autenticação do cliente por CPF em Function Serverless, com JWT HS256 de segredo compartilhado

* **Status**: Aceita
* **Data**: 2026-10-12
* **Autor**: Kaue Sabino
* **Prazo para comentários**: — (encerrado: a estratégia já está implementada e esta RFC registra a proposta que a originou)
* **Decisão resultante**: [ADR-001](../ADRs/ADR-001-composicao-no-primeiro-request-e-authorizer-sem-banco.md) e [ADR-002](../ADRs/ADR-002-kong-invoca-a-funcao-sem-api-gateway.md) deste repositório; [ADR-005 do repositório da aplicação](https://github.com/DevKaue/tech-challenge-app-/blob/develop/docs/ADRs/ADR-005-kong-como-api-gateway.md) para o gateway

> **RFC ou ADR?** A RFC **propõe e pede comentário antes** de a decisão existir: ela abre a
> discussão, apresenta alternativas em pé de igualdade e admite ser rejeitada. O ADR
> **registra a decisão depois** de tomada, e é imutável — muda-se por substituição, não por
> edição. Toda RFC aceita gera um ADR; nem todo ADR vem de uma RFC.

---

## Resumo

Propõe-se que o cliente da oficina se autentique **apenas pelo CPF**, numa Function
Serverless (AWS Lambda) separada da aplicação principal. A função valida o CPF, consulta a
existência e o status do cliente no banco gerenciado e devolve um **JWT HS256 de 1 hora**,
assinado com o **mesmo segredo** que a aplicação principal já usa para os tokens de
funcionário. O Kong invoca a função no `POST /auth` e valida o token nas rotas protegidas; a
aplicação valida de novo.

A proposta é necessária agora porque a Fase 3 exige, ao mesmo tempo, uma Function Serverless
de autenticação e rotas sensíveis protegidas por autenticação via CPF. As Fases 1 e 2 só
tinham login de funcionário por e-mail e senha (`POST /api/auth/login`), e o cliente não
tinha como obter um token.

Se nada for feito, o requisito de autenticação de cliente fica descoberto, e a alternativa
de última hora — um endpoint dentro da aplicação — não cumpre o entregável de Function
Serverless.

---

## Motivação

O desafio da Fase 3 pede uma função serverless que autentique o cliente pelo CPF, consulte
**a existência e o status do cliente** na base gerenciada e devolva um token para as APIs
protegidas. Três sintomas concretos orientam o desenho:

1. **A aplicação principal já valida JWT HS256.** O `JwtStrategy` do NestJS recebe o
   segredo como string. Um emissor novo que use outro algoritmo exige mudança no consumidor,
   em outro repositório e em outro ciclo de deploy.
2. **CPF é dado pessoal e alvo de enumeração.** Um endpoint que responda de forma diferente
   para "não existe" e "bloqueado" ensina a um atacante, com uma lista vazada, quem é cliente
   da oficina.
3. **O ambiente é o AWS Academy.** A conta não permite criar roles (`iam:CreateRole`), o
   que elimina qualquer desenho que dependa de role própria, provider OIDC criado aqui ou
   IRSA.

---

## Proposta detalhada

### Fluxo

1. O cliente envia `POST /auth` com `{"cpf": "..."}` ao Kong.
2. O plugin `aws-lambda` do Kong invoca `techchallenge-auth-<env>` com o evento REST
   (v1.0), o body em base64 e o `X-Correlation-ID` gerado pelo plugin `correlation-id`.
3. A função valida o **formato** (11 dígitos ou `000.000.000-00`) e os **dígitos
   verificadores** antes de qualquer I/O. CPF inválido devolve 400 sem tocar no banco.
4. A função consulta `SELECT id, status, deleted_at FROM customers WHERE document = $1 AND
   document_type = 'CPF'`. Elegível é `status = ACTIVE` e `deleted_at` nulo.
5. Não cadastrado e não elegível devolvem o **mesmo 401**, com a mesma mensagem. O motivo
   real (`not_found`, `archived`, `inactive`, `blocked`) vai só para o log estruturado.
6. Banco indisponível devolve 503, nunca 200.
7. Cliente elegível recebe `{access_token, token_type: "Bearer", expires_in: 3600}`.

### Contrato do token

| Claim | Valor | Motivo |
|---|---|---|
| `sub` | id do cliente, UUID puro | A aplicação roteia em memória por `type`, sem prefixo `customer:` |
| `type` | `customer` | Separa o token de cliente do de funcionário |
| `iss` | `techchallenge-auth-lambda` | O plugin `jwt` do Kong escolhe o consumer por esta claim (`key_claim_name: iss`) |
| `jti` | UUID aleatório | Dois logins no mesmo segundo geram tokens distintos |
| `iat`, `exp` | `exp - iat = 3600` | Janela máxima de um token após bloqueio do cliente |

Ficam **fora** do token: CPF, nome, e-mail, telefone, status e `role`. JWT é base64, não
cifrado, e cai em log de acesso com facilidade. A ausência de `role` faz o `RolesGuard` da
aplicação recusar o token de cliente em rota administrativa sem código novo do lado de lá.

### Segredo

- HS256 com o segredo do SSM `/techchallenge/<env>/auth/jwt-secret`, criado pelo
  repositório de infraestrutura Kubernetes e compartilhado com a aplicação e o Kong.
- A função recebe só o **path** como variável de ambiente e lê o valor em runtime, no
  primeiro request do container. O valor nunca passa pelo state do Terraform desta função
  nem pela configuração da Lambda.
- Segredo com menos de 32 caracteres derruba a montagem da função (503 no contrato): a
  função nunca sobe "saudável" emitindo token forjável.

### O que esta proposta não cobre

- **Quais rotas o cliente pode acessar** na aplicação: é autorização, decidida pela
  aplicação (pendência da RFC-001 do repositório da aplicação).
- **Revogação imediata** de token: o bloqueio do cliente vale no próximo login, até 1 h.
- **Rotação do segredo**: exige redeploy coordenado de função, aplicação e Kong.
- **Cadastro do cliente**: continua na aplicação principal.

---

## Alternativas consideradas

### Alternativa 1 — Amazon Cognito com fluxo de autenticação customizado
* **Descrição**: um User Pool com o CPF como username e os gatilhos `DefineAuthChallenge`,
  `CreateAuthChallenge` e `VerifyAuthChallengeResponse` em Lambda; o Cognito emitiria tokens
  RS256 e publicaria o JWKS.
* **Prós**: [✔️] Emissão, expiração, refresh token e JWKS gerenciados; [✔️] chave privada
  nunca sai da AWS; [✔️] revogação de refresh token nativa.
* **Contras**: [❌] cria uma **segunda base de clientes**, que precisa ser sincronizada com
  a tabela `customers` a cada cadastro, arquivamento e mudança de status — exatamente a
  consulta de "existência e status" que o desafio pede passaria a ser feita contra uma cópia;
  [❌] três Lambdas de gatilho no lugar de uma; [❌] RS256 obriga a aplicação a trocar o
  `JwtStrategy` e o Kong a trocar a credencial dos consumers; [❌] mais recursos e permissões
  para provisionar numa conta que não permite criar roles.
* **Por que não foi escolhida**: o problema é consultar a base que já existe e emitir um
  token que os consumidores já sabem validar. O Cognito resolve um problema maior (gestão de
  identidade) e cobra por isso com uma segunda fonte de verdade.

### Alternativa 2 — JWT RS256 com JWKS publicado pela função
* **Descrição**: a função assina com chave privada (no SSM ou KMS) e publica a chave pública
  em um endpoint JWKS; Kong e aplicação validam com a chave pública.
* **Prós**: [✔️] só a função consegue emitir token de cliente; [✔️] vazamento do lado
  consumidor não permite forjar token; [✔️] rotação por `kid` sem redeploy dos consumidores.
* **Contras**: [❌] exige publicar, versionar e rotacionar o JWKS, e expor mais uma rota;
  [❌] muda o `JwtStrategy` da aplicação, que hoje valida HS256 com o mesmo segredo dos
  tokens de funcionário; [❌] o Kong passaria a manter credencial RSA por consumer.
* **Por que não foi escolhida**: com o segredo restrito ao SSM e à IAM, e um único time
  operando os três consumidores, o ganho não compensa nesta fase. É o próximo passo natural
  quando um terceiro precisar validar tokens ou a rotação ficar frequente, e está registrado
  como dívida consciente no README. O assinador já fixa `algorithm: 'HS256'` explicitamente,
  o que congela a superfície antes dessa migração.

### Alternativa 3 — Autenticação por CPF dentro da aplicação principal
* **Descrição**: um endpoint `POST /api/auth/customer` no NestJS, reaproveitando o módulo
  `access-identity`, o Prisma e o `JwtService` já existentes.
* **Prós**: [✔️] nenhum componente novo; [✔️] mesma conexão com o banco e mesma emissão de
  token; [✔️] sem cold start.
* **Contras**: [❌] **não cumpre o entregável** de Function Serverless de autenticação;
  [❌] acopla o login do cliente ao deploy e à escala da aplicação inteira.
* **Por que não foi escolhida**: o requisito é explícito; esta alternativa só seria
  considerada se ele não existisse.

### Alternativa 4 — API Gateway da AWS com Lambda Authorizer
* **Descrição**: HTTP API na frente da função de autenticação e um Authorizer validando o
  token nas rotas protegidas.
* **Prós**: [✔️] gerenciado, sem pods para operar.
* **Contras**: [❌] VPC Link e balanceador privado para alcançar a aplicação no EKS; [❌] uma
  invocação de Authorizer por requisição protegida.
* **Por que não foi escolhida**: foi a primeira versão deste repositório, substituída pelo
  Kong ([ADR-002](../ADRs/ADR-002-kong-invoca-a-funcao-sem-api-gateway.md)). A estratégia
  de token desta RFC vale nos dois desenhos.

---

## Impacto

* **Custo** (US$/dia, quando houver recurso cobrado): ~US$ 0,01 por ambiente com tráfego
  acadêmico — Lambda, ECR, CloudWatch Logs e SSM. Cálculo e premissas na seção
  [Custo estimado do README](../../README.md#custo-estimado). Não cria NAT, endpoint de VPC
  nem banco.
* **Segurança**: o segredo HS256 compartilhado permite que qualquer consumidor que o conheça
  forje um token de cliente; mitigado por SSM, IAM e tamanho mínimo de 32 caracteres. A
  checagem de `iss` e `type` impede que um token de funcionário abra rota de cliente, e a
  ausência de `role` impede o caminho inverso. CPF e token nunca são registrados em log.
* **Operação e runbook**: o motivo de cada 401 e 503 é localizado pelo `correlationId` no
  log `/aws/lambda/techchallenge-auth-<env>`. O passo a passo está no
  [QUICKSTART](../../QUICKSTART.md#se-der-errado).
* **Outros repositórios afetados**:
  * **Infraestrutura Kubernetes**: cria o parâmetro `/techchallenge/<env>/auth/jwt-secret`,
    a VPC com as tags que a função descobre e o Kong.
  * **Banco de dados**: publica `/techchallenge/<env>/db/*` e o SG de cliente
    (`client-sg-id`) que a função anexa.
  * **Aplicação**: declara as rotas e plugins do Kong (`aws-lambda`, `jwt`,
    `rate-limiting`, `correlation-id`), cria a coluna `status` em `customers` e precisa
    aceitar `type: customer` nas rotas de cliente.

---

## Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação | Como se detecta |
|---|---|---|---|---|
| Vazamento do segredo HS256 por um dos três consumidores | Baixa | Alto: token de qualquer cliente forjável | Segredo só no SSM, lido por path; mínimo de 32 caracteres; migração para RS256 registrada como dívida | Sem detecção automática hoje: o log de sucesso não registra `sub` nem `jti`, de propósito |
| Enumeração de CPF a partir de lista vazada | Média | Médio: revela quem é cliente | 401 idêntico para inexistente e inelegível; rate limit de 10/min por IP no Kong | Pico de `auth.denied` com `reason: not_found` no log |
| Cliente bloqueado continua com acesso | Média | Médio | `exp` de 1 h; o próximo login já é recusado | Reclamação ou auditoria; não há sinal automático |
| Esgotar conexões do RDS sob carga | Baixa | Alto: 503 para todos | Pool com `max: 1` por container; alarme de conexões do repositório de banco | Alarme `rds-conexoes` e aumento de `db.error` |
| Drift entre o schema do banco e a função | Média | Alto: 503 em todo login | Status desconhecido vira 503, nunca token; fixture de integração espelha a migration da aplicação | `db.error` com `errorCode` `42P01` ou `42703` |

---

## Questões em aberto

* **Quais rotas aceitam `type: customer`** na aplicação, e com qual regra de posse do
  recurso. Decide o time da aplicação (RFC-001 daquele repositório).
* **Procedimento de rotação do segredo** coordenando função, aplicação e Kong. Decide o
  repositório de infraestrutura Kubernetes, dono do parâmetro.
* **Quando migrar para RS256/JWKS**: gatilho proposto é o primeiro consumidor fora do time.

---

## Comentários recebidos

| Data | Quem | Comentário | Resolução |
|---|---|---|---|
| 2026-10-06 | RFC-001 do repositório da aplicação | Propõe "Lambda emite, Kong valida, aplicação revalida", com um consumer do Kong por `iss` e HS256 com segredo único no SSM | Incorporado: o contrato do token e o `iss` desta RFC são os mesmos daquela; o Authorizer saiu pelo ADR-002 |

---

## Referências

* [`contracts/customer-access-token.schema.json`](../../contracts/customer-access-token.schema.json) e [`contracts/errors.json`](../../contracts/errors.json)
* [`docs/api/openapi.yaml`](../api/openapi.yaml)
* [Sequência de autenticação](../diagrams/02-sequencia-autenticacao.mmd)
* `src/application/usecases/authenticate-customer.usecase.ts` e `src/infra/security/jsonwebtoken-token.service.ts`
* ADR-005 e RFC-001 do repositório [tech-challenge-app-](https://github.com/DevKaue/tech-challenge-app-)
* RFC 7519 (JSON Web Token) e RFC 7518 (algoritmos JWA, HS256 e RS256)
