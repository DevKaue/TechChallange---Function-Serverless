# Function Serverless de Autenticação — Tech Challenge Fase 3

Function Serverless (AWS Lambda) que autentica o **cliente da oficina pelo CPF**: valida o
documento, consulta a existência e o status do cliente na base gerenciada e devolve um
**JWT** válido para consumo das APIs protegidas. Quem chama a função é o **Kong**, o API
Gateway do projeto ([ADR-002](docs/ADRs/ADR-002-kong-invoca-a-funcao-sem-api-gateway.md)),
que também valida os tokens nas rotas protegidas com o plugin `jwt`.

É um dos quatro repositórios da Fase 3, que espelham em estrutura e documentação o
repositório-base das Fases 1 e 2:

| Repositório | Papel |
|---|---|
| **TechChallange---Function-Serverless** (este) | **Function Serverless de autenticação por CPF** |
| [tech-challenge-app-](https://github.com/DevKaue/tech-challenge-app-) | Aplicação da Fase 3, com as rotas do Kong (ADR-005, RFC-001) |
| [TechChallenge---Infraestrutura-Kubernetes-com-Terraform](https://github.com/DevKaue/TechChallenge---Infraestrutura-Kubernetes-com-Terraform) | EKS, Kong e o segredo JWT no SSM |
| [tech-challenge-database-infra](https://github.com/DevKaue/tech-challenge-database-infra) | Banco de dados gerenciado (Terraform) |
| [TechChallange](https://github.com/DevKaue/TechChallange) | Repositório-base: aplicação principal em Kubernetes (Fases 1 e 2) |

> **Status: código, imagem, Terraform e workflow de deploy prontos; primeiro deploy
> pendente.** O apply depende da infra Kubernetes (VPC, segredo JWT no SSM) e do banco do
> mesmo ambiente estarem no ar.

## Contexto do projeto

A oficina já tinha login de **funcionário** por e-mail e senha na aplicação principal. A
Fase 3 pede que o **cliente** também consiga se autenticar, só com o CPF, para acessar as
rotas que lhe dizem respeito — e que essa autenticação seja uma Function Serverless,
separada da aplicação. A estratégia completa, com as alternativas descartadas (Cognito,
RS256/JWKS, autenticação dentro da aplicação), está na
[RFC-001](docs/RFCs/RFC-001-autenticacao-por-cpf-com-jwt.md).

### Propósito

| Função | Entrada | Handler | O que faz |
|---|---|---|---|
| `techchallenge-auth-<env>` | `POST /auth` com `{"cpf": "..."}`, invocada pelo plugin `aws-lambda` do Kong | `handler.handler` | Valida o CPF (formato e dígitos verificadores) antes de qualquer I/O, consulta existência e status do cliente no Postgres gerenciado e devolve um JWT HS256 de 1 h |

`<env>` é `staging` para a `develop` e `prod` para a `main`: é o único nome
que o Kong tem permissão de invocar.

O que **não** se aplica a este repositório, e por quê:

- **Manifestos Kubernetes**: não se aplica, porque a função não roda no cluster. O
  `Ingress` e os `KongPlugin` que a invocam são declarados no repositório da aplicação.
- **Swagger gerado automaticamente**: não se aplica, porque a função não é NestJS. O
  contrato é escrito à mão em [`docs/api/openapi.yaml`](docs/api/openapi.yaml) e acompanha a
  coleção Postman (ver [Contrato da API](#contrato-da-api)).
- **Migrations de banco**: não se aplica, porque o schema de `customers` pertence à
  aplicação principal; a função só lê.

## Stack definida

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Runtime | Node.js 22 + TypeScript | O validador de CPF é portado linha a linha da aplicação principal; duas implementações da mesma regra divergiriam num caso de borda, em produção |
| Empacotamento | Container image no ECR, sobre `public.ecr.aws/lambda/nodejs:22` | Atende ao entregável de Dockerfile e permite embutir o bundle de CAs do RDS, fechando a dívida de TLS declarada no repositório-base |
| Banco | `pg` (driver direto), sem ORM | O schema pertence a outro repositório; um `schema.prisma` copiado seria uma segunda fonte de verdade que compila mesmo divergente |
| Token | `jsonwebtoken`, HS256 | Mesmo segredo e mesmo algoritmo da aplicação principal ([RFC-001](docs/RFCs/RFC-001-autenticacao-por-cpf-com-jwt.md)) |
| Segredos e configuração | SSM Parameter Store via `@aws-sdk/client-ssm` | Só **paths** entram como variável de ambiente; o valor é lido em runtime e nunca passa pelo state do Terraform nem pela configuração da Lambda |
| API Gateway | Kong no EKS, plugins `aws-lambda` e `jwt` | Decisão do ADR-005 do repositório da aplicação; aqui, [ADR-002](docs/ADRs/ADR-002-kong-invoca-a-funcao-sem-api-gateway.md) |
| Testes | Jest; integração contra Postgres 15.19 real | Mesma estratégia do repositório-base: a consulta é provada contra o banco, não contra mock |
| Contratos | JSON Schema 2020-12, validado com Ajv | O teste valida o token **real** emitido pelo assinador, não um exemplo escrito à mão |
| Qualidade | `tsc --noEmit` e ESLint com `--max-warnings=0` | Lint bloqueante desde o primeiro commit ([CONTRIBUTING](CONTRIBUTING.md), R12) |
| IaC | Terraform `~> 1.10`, provider AWS `~> 5.90` | Função, repositório ECR, log group e rede. A role de execução é a **LabRole** existente: o AWS Academy não permite criar roles |
| CI/CD | GitHub Actions com OIDC | Sem chave estática em secret de repositório; no AWS Academy, credenciais temporárias do lab |

## ADRs (Architecture Decision Records)

As ADRs do repositório estão em [docs/ADRs](docs/ADRs):

- [ADR-000-bootstrap-do-repositorio.md](docs/ADRs/ADR-000-bootstrap-do-repositorio.md)
- [ADR-001-composicao-no-primeiro-request-e-authorizer-sem-banco.md](docs/ADRs/ADR-001-composicao-no-primeiro-request-e-authorizer-sem-banco.md) — a parte do Authorizer foi substituída pelo ADR-002
- [ADR-002-kong-invoca-a-funcao-sem-api-gateway.md](docs/ADRs/ADR-002-kong-invoca-a-funcao-sem-api-gateway.md)

## RFCs (Request for Comments)

As RFCs do repositório estão em [docs/RFCs](docs/RFCs):

- [RFC-001-autenticacao-por-cpf-com-jwt.md](docs/RFCs/RFC-001-autenticacao-por-cpf-com-jwt.md) — estratégia de autenticação por CPF com JWT HS256 de segredo compartilhado

## Arquitetura

A função é uma única rota e segue três camadas, no mesmo espírito da Clean Architecture do
repositório-base:

- `domain/` — `Cpf` (value object que só existe se o documento for válido), `Customer`,
  `CustomerStatus`, os erros do contrato e as portas (`CustomerRepository`, `TokenService`,
  `SecretProvider`, `IdGenerator`). Não importa SDK, driver nem `infra/`.
- `application/` — `AuthenticateCustomerUseCase`, que valida o CPF, busca o cliente,
  decide a elegibilidade e pede o token, sem conhecer HTTP, AWS, Postgres ou JWT.
- `infra/` — os adaptadores: evento HTTP, SSM, Pool `pg`, assinador JWT e logger.

A ausência de uma camada `presentation/` é deliberada: numa função de uma rota, ela seria
`handler.ts` mais um adapter ([CONTRIBUTING](CONTRIBUTING.md), R5).

A função monta as dependências na **primeira requisição** do container, lendo segredos e o
contrato de descoberta do banco pelo SSM, e reaproveita nas seguintes. Falha nessa montagem
vira **503 no contrato**, nunca 502, e a próxima invocação tenta de novo. Ver
[ADR-001](docs/ADRs/ADR-001-composicao-no-primeiro-request-e-authorizer-sem-banco.md).

Regras que valem para toda requisição:

1. O CPF é validado **antes** de qualquer I/O: CPF inválido nunca consulta o banco.
2. A consulta é sempre por `(document, document_type = 'CPF')`, o unique composto da tabela.
3. Elegível é `status = ACTIVE` **e** `deleted_at` nulo. Inexistente e inelegível devolvem o
   mesmo 401.
4. Status desconhecido no banco é tratado como indisponibilidade (503): nunca emite token.
5. O handler nunca lança exceção: toda saída é `{statusCode, headers, body}` no contrato.

### Formato do evento

O Kong envia o evento no formato REST (v1.0), com `awsgateway_compatible: true` e o body em
base64. O handler também aceita o v2.0 do HTTP API, usado no teste local. A resposta é a
mesma nos dois: `{statusCode, headers, body}`, que o Kong repassa com
`is_proxy_integration: true`. O `X-Correlation-ID` gerado pelo plugin `correlation-id` do
Kong (`<uuid>#<n>`) é propagado para o log e para a resposta.

## Desenho da arquitetura

Os diagramas do repositório ficam em `docs/diagrams` (formato Mermaid) e estão reproduzidos
abaixo, porque o GitHub não renderiza `.mmd` linkado.

| Diagrama | Conteúdo |
|---|---|
| [docs/diagrams/01-autenticacao.mmd](docs/diagrams/01-autenticacao.mmd) | Arquitetura deste repositório: Kong, função, SSM, RDS e aplicação |
| [docs/diagrams/02-sequencia-autenticacao.mmd](docs/diagrams/02-sequencia-autenticacao.mmd) | Sequência do `POST /auth`, com os desvios 400, 401 e 503, até a rota protegida |
| [docs/diagrams/03-fluxo-deploy.mmd](docs/diagrams/03-fluxo-deploy.mmd) | Fluxo de deploy: CI, imagem no ECR, Terraform e smoke pelo Kong |

### Arquitetura deste repositório

```mermaid
flowchart LR
  C[Cliente] -->|POST /auth cpf| KONG[Kong no EKS<br/>plugin aws-lambda]
  KONG -->|evento v1.0, LabRole do nó| AUTH[Lambda techchallenge-auth-env<br/>handler.handler]
  AUTH -->|SELECT id, status, deleted_at| RDS[(RDS PostgreSQL)]
  AUTH -.->|paths| SSM[SSM Parameter Store]
  AUTH -->|JWT HS256 1h| KONG
  KONG --> C
  C -->|Bearer JWT| KONGJ[Kong<br/>plugin jwt, consumer por iss]
  SSM -.->|mesmo segredo, via Secret do deploy do app| KONGJ
  KONGJ --> APP[Aplicação principal no EKS<br/>revalida o token]
```

### Sequência da autenticação

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant K as Kong (EKS)
    participant L as Lambda techchallenge-auth-{env}
    participant S as SSM Parameter Store
    participant DB as RDS PostgreSQL
    participant A as Aplicação principal (EKS)

    C->>K: POST /auth {"cpf": "..."}
    K->>K: rate-limiting (10/min por IP) e X-Correlation-ID (uuid e contador)
    K->>L: Invoke (plugin aws-lambda, evento v1.0, body em base64, LabRole do nó)

    opt primeira invocação do container
        L->>S: GetParameter jwt-secret e db/host, port, name, username, password
        alt SSM, configuração ou bundle de CA com falha
            L-->>K: 503 service_unavailable + correlationId (log bootstrap.error)
            K-->>C: 503
        else dependências montadas
            S-->>L: valores (cache por container)
            L->>L: abre o Pool pg (max 1, TLS com a CA do RDS)
        end
    end

    L->>L: valida formato e dígitos verificadores do CPF, antes de qualquer I/O
    alt CPF inválido ou JSON malformado
        L-->>K: 400 invalid_request "CPF inválido" (banco não é consultado)
        K-->>C: 400
    else CPF válido
        L->>DB: SELECT id, status, deleted_at FROM customers WHERE document = $1 AND document_type = 'CPF'
        alt banco indisponível, timeout ou tabela ausente
            DB--xL: erro (ex.: 42P01, 57014, timeout de conexão)
            L-->>K: 503 service_unavailable + correlationId (log db.error)
            K-->>C: 503
        else não cadastrado, arquivado, INACTIVE ou BLOCKED
            DB-->>L: nenhuma linha ou cliente inelegível
            L-->>K: 401 unauthorized "CPF não autorizado" (motivo só no log auth.denied)
            K-->>C: 401
        else cliente ACTIVE e não arquivado
            DB-->>L: id, status ACTIVE, deleted_at nulo
            L->>L: assina JWT HS256 (sub, type customer, iss techchallenge-auth-lambda, jti, exp 1 h)
            L-->>K: 200 {access_token, token_type Bearer, expires_in 3600}
            K-->>C: 200 + x-correlation-id
        end
    end

    C->>K: requisição em rota protegida /api (Authorization: Bearer token)
    K->>K: plugin jwt: consumer escolhido pelo iss, assinatura HS256 e exp
    alt token ausente, adulterado ou expirado
        K-->>C: 401 (a requisição não chega à aplicação)
    else token válido
        K->>A: encaminha com X-Correlation-ID
        A->>A: revalida o token (aceitar type customer é pendência da RFC-001 da aplicação)
        A-->>K: resposta da rota
        K-->>C: resposta da rota
    end
```

### Fluxo de deploy

```mermaid
graph TB
    classDef gh fill:#fff2cc,stroke:#d6b656
    classDef ci fill:#d5e8d4,stroke:#82b366
    classDef deploy fill:#dae8fc,stroke:#6c8ebf
    classDef aws fill:#ffe6cc,stroke:#d79b00
    classDef data fill:#f8cecc,stroke:#b85450
    classDef local fill:#f5f5f5,stroke:#666

    DEV["Desenvolvedor"]
    CLIENTE["Cliente / Internet"]

    subgraph GitHubActions["GitHub Actions"]
        direction TB

        subgraph CI["ci.yml - PR e push em develop/homolog/main"]
            direction TB
            C1["commits (só PR)<br/>título do PR em<br/>Conventional Commits"]
            C2["qualidade<br/>typecheck + lint --max-warnings=0<br/>+ build + Jest com cobertura"]
            C3["seguranca<br/>npm audit + sem chave estática<br/>+ nenhum CPF em src"]
            C4["terraform<br/>fmt + validate staging/prod<br/>+ terraform test (provider mockado)"]
            C5["imagem<br/>docker build + evento v1.0<br/>contra o RIE: espera 503 de bootstrap"]
        end

        subgraph DEPLOY["deploy.yml - push em develop (staging) e main (production)"]
            direction TB
            D1["1. Resolver a tag<br/>v&lt;run_number&gt; ou image_tag do dispatch"]
            D2["2. Credenciais AWS<br/>OIDC (AWS_DEPLOY_ROLE) ou lab (AWS_LAB_*)"]
            D3["3. terraform init<br/>bucket de TF_STATE_BUCKET<br/>state lambda/&lt;env&gt;/terraform.tfstate"]
            D4["4. Garantir o ECR<br/>apply -target do repositório e lifecycle"]
            D5["5. Login no ECR"]
            D6["6. Build + push<br/>--provenance=false"]
            D7["7. terraform apply<br/>-var image_tag"]
            D8["8. aws lambda wait<br/>function-updated-v2"]
            D9["9. Smoke pelo Kong<br/>só com KONG_URL no environment"]
        end
    end

    subgraph AWS["AWS"]
        direction TB
        ECR[("Amazon ECR<br/>techchallenge-auth-&lt;env&gt;<br/>tag imutável, 10 últimas")]
        FN["Lambda techchallenge-auth-&lt;env&gt;<br/>imagem, 256 MB, timeout 9 s<br/>subnets privadas, LabRole"]
        LOGS["CloudWatch Logs<br/>/aws/lambda/techchallenge-auth-&lt;env&gt;<br/>retenção 14 dias"]
        SSM["SSM Parameter Store<br/>/techchallenge/&lt;env&gt;/auth/jwt-secret<br/>/techchallenge/&lt;env&gt;/db/*"]
        KONG["Kong no EKS<br/>plugin aws-lambda"]
        RDS[("RDS PostgreSQL<br/>repositório de banco")]
    end

    S3[("S3 TF_STATE_BUCKET<br/>state do Terraform")]

    subgraph LOCAL["Desenvolvimento local"]
        LT["npm test + npm run test:integration"]
        LDB[("Postgres 15.19<br/>:5432 em Docker")]
        RIE["docker run da imagem<br/>Runtime Interface Emulator :9000"]
    end

    DEV -->|"PR / push"| CI
    DEV -->|"merge em develop ou main"| DEPLOY
    DEV -->|"workflow_dispatch com image_tag (rollback)"| D1

    C2 ~~~ C3
    C4 ~~~ C5

    D1 --> D2 --> D3
    D3 -->|"build novo"| D4 --> D5 --> D6 --> D7
    D3 -->|"rollback: sem build"| D7
    D7 --> D8 --> D9

    D3 -.->|"state e lock"| S3
    D6 -->|"push"| ECR
    D7 -->|"image_uri"| FN
    ECR -.->|"pull da imagem"| FN
    FN -->|"logs JSON"| LOGS
    FN -->|"GetParameter no primeiro request"| SSM
    FN -->|"SQL/TLS 5432"| RDS
    KONG -->|"Invoke"| FN
    D9 -->|"POST /auth"| KONG
    CLIENTE -->|"POST /auth"| KONG

    DEV -->|"npm run db:it:up / docker run"| LOCAL
    LT --> LDB

    style GitHubActions fill:#fbfbfb,stroke:#999,stroke-dasharray:3
    style AWS fill:#fdf4ec,stroke:#999,stroke-dasharray:3
    style CI fill:#f3f9f3
    style DEPLOY fill:#f3f7fb

    class DEV,CLIENTE gh
    class C1,C2,C3,C4,C5 ci
    class D1,D2,D3,D4,D5,D6,D7,D8,D9 deploy
    class ECR,FN,LOGS,SSM,KONG aws
    class RDS,S3 data
    class LT,LDB,RIE local
```

## Diagramas C4

Visualização direta dos diagramas de Contexto, Container e Components no GitHub:

- [docs/C4Model/README.md](docs/C4Model/README.md)

## Estrutura principal

```text
.
├── src/
│   ├── handler.ts             # composition root: Pool pg, SSM e logger concretos
│   ├── domain/                # Cpf, Customer, CustomerStatus, erros e portas
│   ├── application/           # AuthenticateCustomerUseCase e DTOs
│   ├── infra/
│   │   ├── composition/       # montagem das dependências, testável com fakes
│   │   ├── config/            # variáveis de ambiente e leitura do SSM
│   │   ├── database/          # parâmetros do banco e Pool com TLS
│   │   ├── http/              # evento v1.0/v2.0, correlation id, respostas, lazy handler
│   │   ├── logging/           # logger JSON
│   │   ├── repositories/      # PgCustomerRepository
│   │   └── security/          # assinador JWT e gerador do jti
│   └── contracts/             # teste dos contratos contra o token real
├── contracts/                 # JSON Schemas da resposta e do JWT, tabela de erros
├── test/
│   ├── integration/           # repositório e fluxo completo contra Postgres real
│   └── e2e/smoke-auth.sh      # smoke pós-deploy pelo Kong
├── infra/terraform/
│   ├── modules/function/      # Lambda, ECR, log group, rede e testes do módulo
│   └── envs/{staging,prod}/   # um diretório e um state por ambiente
├── docs/
│   ├── ADRs/                  # decisões permanentes
│   ├── RFCs/                  # propostas técnicas
│   ├── C4Model/               # contexto, container e componentes
│   ├── diagrams/              # diagramas Mermaid numerados
│   ├── api/openapi.yaml       # contrato HTTP do POST /auth
│   └── postman/               # coleção Postman
├── .github/workflows/         # ci.yml e deploy.yml
├── Dockerfile                 # imagem da função
└── QUICKSTART.md              # passo a passo local e AWS
```

## Como rodar

O passo a passo completo, com o que esperar de cada comando e a tabela de problemas
comuns, está no **[QUICKSTART.md](QUICKSTART.md)**.

### Testes locais

```bash
nvm use                      # Node 22
npm ci
npm run typecheck && npm run lint
npm test                     # unitários + contratos, com cobertura mínima global

npm run db:it:up             # Postgres 15.19 em Docker, porta 5432
npm run test:integration     # repositório e fluxo completo contra o banco real
npm run db:it:down
```

A suíte de integração usa `DATABASE_URL`, com padrão
`postgres://postgres:postgres@localhost:5432/postgres`, e cria um schema isolado por
arquivo de teste. O CI atual roda os unitários, os contratos e a imagem, mas **não** roda a
suíte de integração: ela é executada localmente antes do PR.

### Variáveis de ambiente da função

| Variável | Obrigatória | Exemplo |
|---|---|---|
| `APP_ENV` | sim | `staging` |
| `JWT_SECRET_SSM_PATH` | sim | `/techchallenge/staging/auth/jwt-secret` |
| `DB_SSM_PREFIX` | sim | `/techchallenge/staging/db` |
| `RDS_CA_BUNDLE_PATH` | não | padrão `/var/task/certs/global-bundle.pem` |

Só **paths** do SSM entram como variável, nunca valores. O segredo JWT é criado pelo
repositório de infraestrutura Kubernetes, e é o mesmo que o Kong e a aplicação usam. Os
parâmetros do banco (`host`, `port`, `name`, `username`, `password`) são publicados pelo
repositório [tech-challenge-database-infra](https://github.com/DevKaue/tech-challenge-database-infra).

### Imagem

O [`Dockerfile`](Dockerfile) gera a imagem da função sobre `public.ecr.aws/lambda/nodejs:22`,
com o JavaScript compilado, as dependências de produção e o bundle de CAs do RDS em
`/var/task/certs/global-bundle.pem`. A imagem base traz o Runtime Interface Emulator, e o
CI invoca a imagem real com um evento v1.0 do Kong:

```bash
docker build --provenance=false -t techchallenge-auth:local .
docker run --rm -p 9000:8080 -e APP_ENV=local \
  -e JWT_SECRET_SSM_PATH=/techchallenge/staging/auth/jwt-secret \
  -e DB_SSM_PREFIX=/techchallenge/staging/db techchallenge-auth:local
curl -s localhost:9000/2015-03-31/functions/function/invocations \
  -d '{"httpMethod":"POST","path":"/auth","headers":{},"body":"{\"cpf\":\"11144477735\"}","isBase64Encoded":false,"requestContext":{"requestId":"local"}}'
```

Sem credencial da AWS, a resposta esperada é o 503 de bootstrap, com `correlationId`.

## Deploy

| Documento | Para quê |
|---|---|
| **[QUICKSTART.md](QUICKSTART.md)** | **Comece aqui.** Pré-requisitos, secrets dos environments, primeiro deploy, smoke e teardown |
| [infra/terraform](infra/terraform) | Módulo da função e um diretório por ambiente |
| [.github/workflows/deploy.yml](.github/workflows/deploy.yml) | Pipeline de deploy |

### Terraform da função

[`infra/terraform`](infra/terraform) segue o mesmo desenho do repositório de banco: um
módulo e um diretório por ambiente, com a key do state literal (`lambda/<env>/terraform.tfstate`)
no bucket compartilhado do bootstrap da infra Kubernetes, com lock nativo do S3
(`use_lockfile`). O nome do bucket não fica no código: entra no `init` por
`-backend-config`, da variável `TF_STATE_BUCKET`.

| Recurso | Observação |
|---|---|
| `aws_lambda_function` `techchallenge-auth-<env>` | Imagem do ECR, x86_64, 256 MB, timeout de 9 s (o plugin do Kong espera 10 s), nas subnets privadas da VPC do ambiente |
| Role de execução | **LabRole**, lida por data source: o AWS Academy não permite criar roles |
| `aws_ecr_repository` `techchallenge-auth-<env>` | Tag imutável, scan no push, mantém as 10 últimas imagens |
| Security groups | SG de cliente publicado pelo banco (Postgres) e um SG próprio só com saída HTTPS (SSM) |
| `aws_cloudwatch_log_group` | Retenção de 14 dias, criado antes da função |

A rede é descoberta por tag (`Project`, `Environment`, `ManagedBy`), e as subnets privadas
pela tag `kubernetes.io/role/internal-elb`. Um `check` do Terraform avisa quando há menos de
duas subnets privadas: é o sinal de que a infra Kubernetes do ambiente ainda não foi aplicada.

Não há API Gateway, Authorizer nem permissão de invocação neste Terraform: o Kong invoca
com a credencial do nó (LabRole), e fora do Academy a permissão é a role IRSA criada pela
infra Kubernetes.

```bash
cd infra/terraform/modules/function && terraform init -backend=false && terraform test
```

### Pipeline

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) roda no push para `develop`
(staging) e para `main` (prod). A `homolog` não faz deploy, como nos outros três
repositórios. O staging só roda com a variável `STAGING_ENABLED=true`: enquanto o
staging da infra estiver desligado para economizar crédito, o push na `develop`
fica pulado em vez de falhar.

1. Cria o repositório ECR, se ainda não existir.
2. Builda e publica a imagem com a tag `v<run_number>`. Num re-run a tag é a
   mesma, então a imagem já publicada é reaproveitada.
3. Aplica o Terraform do ambiente com essa tag e espera a função ficar ativa.
4. Roda o smoke pelo Kong, quando `KONG_URL` está configurada no environment.

Rollback: `workflow_dispatch` com `image_tag` de uma versão anterior, sem novo build.

Um deploy por ambiente roda de cada vez, sem cancelar o que está em andamento: interromper
um apply deixa o lock do state preso. O deploy de `main` usa o `environment: production`,
onde fica o gate de aprovação ([ADR-000](docs/ADRs/ADR-000-bootstrap-do-repositorio.md)).

Credenciais, por environment do GitHub (`staging` e `production`): `AWS_DEPLOY_ROLE` quando
houver OIDC; no AWS Academy, `AWS_LAB_ACCESS_KEY_ID`, `AWS_LAB_SECRET_ACCESS_KEY` e
`AWS_LAB_SESSION_TOKEN`, que expiram com a sessão do lab e precisam ser atualizadas antes
de cada deploy. Use um dos dois conjuntos, nunca os dois.

O [`ci.yml`](.github/workflows/ci.yml) roda em PR e push para `develop`, `homolog` e `main`:
título do PR em Conventional Commits, typecheck, lint, build, testes unitários com cobertura,
`npm audit`, guarda contra chave estática da AWS e contra CPF em código de produção,
`terraform fmt`/`validate`/`test` e a invocação da imagem real com o evento v1.0.

### Smoke pós-deploy

```bash
API_URL=http://<nlb-do-kong> \
CPF_ATIVO=<cpf sintético do seed de homologação> \
PROTECTED_URL=http://<nlb-do-kong>/api/<rota de cliente> \
test/e2e/smoke-auth.sh
```

No deploy, o smoke usa a variável `KONG_URL`, o secret `SMOKE_CPF_ATIVO` e a variável
opcional `SMOKE_PROTECTED_URL` do environment. São 4 chamadas ao `/auth`, que cabem no rate
limit de 10/min por IP do Kong.

## Contrato da API

| Artefato | Uso |
|---|---|
| [docs/api/openapi.yaml](docs/api/openapi.yaml) | OpenAPI 3.0 do `POST /auth`: request, respostas, headers e o payload do JWT. Abra no [Swagger Editor](https://editor.swagger.io/) ou em qualquer visualizador OpenAPI |
| [docs/postman/techchallenge-auth.postman_collection.json](docs/postman/techchallenge-auth.postman_collection.json) | Coleção Postman v2.1 com os casos 200, 400 e 401, a rota protegida e a invocação local da imagem; variáveis `baseUrl` e `cpf` |
| [contracts/](contracts) | Fonte de verdade: resposta pública, payload do JWT e tabela de erros, validados em teste |

| Status | Quando | Corpo |
|---|---|---|
| 200 | CPF válido, cliente existente e elegível | `{access_token, token_type: "Bearer", expires_in: 3600}` |
| 400 | Formato ou dígito verificador inválido, JSON malformado — sem tocar no banco | `{error: "invalid_request", message: "CPF inválido", correlationId}` |
| 401 | Cliente não cadastrado **ou** não elegível, indistinguíveis | `{error: "unauthorized", message: "CPF não autorizado", correlationId}` |
| 503 | Banco indisponível ou falha ao montar a função (SSM, configuração) | `{error: "service_unavailable", message: "Serviço temporariamente indisponível", correlationId}` |

Fora da tabela principal: o Kong devolve **429** quando o rate limit de 10/min por IP é
excedido, sem invocar a função; e um erro inesperado dentro da função vira **500**
controlado (`internal_error`), nunca exceção.

O 401 é deliberadamente indistinguível entre "não existe" e "não elegível": diferenciar
permitiria enumeração de CPF a partir de listas vazadas. O motivo real fica no log
estruturado, correlacionado pelo `correlationId` devolvido no corpo.

Exemplo, com o CPF sintético da massa de teste:

```bash
curl -s -X POST http://<nlb-do-kong>/auth \
  -H 'content-type: application/json' \
  -H 'x-correlation-id: exemplo-1' \
  -d '{"cpf":"111.444.777-35"}'
```

### Rotas protegidas

Quem valida o token nas rotas protegidas é o plugin `jwt` do Kong, que escolhe o consumer
pela claim `iss` (`techchallenge-auth-lambda` para cliente) e confere `exp`. A aplicação
valida de novo. O contrato do token emitido aqui está em
[`contracts/customer-access-token.schema.json`](contracts/customer-access-token.schema.json):
HS256, `iss: techchallenge-auth-lambda`, `type: customer`, `sub` com o id do cliente, `jti`
aleatório e `exp - iat = 3600`. CPF, nome, e-mail, telefone, status e `role` não entram no
token.

O token nunca é registrado em log, em nenhuma forma.

## Observabilidade

### Logs estruturados

Cada evento da função é **uma linha JSON** escrita em `stdout`, no log group
`/aws/lambda/techchallenge-auth-<env>` (retenção de 14 dias). O log group usa o formato
`Text` da Lambda, então o runtime prefixa cada linha com horário, `requestId` e nível antes
do JSON.

```json
{"timestamp":"2026-10-12T12:00:00.000Z","level":"warn","message":"auth.denied","event":"auth.denied","correlationId":"0f6c3d2e-6a1b-4c39-9a4e-0d7f5b2c8e11#12","requestId":"kong-request-id","outcome":"denied","durationMs":18,"coldStart":false,"reason":"blocked","functionVersion":"$LATEST","env":"staging"}
```

| Evento | Nível | Quando | Campos de diagnóstico |
|---|---|---|---|
| `auth.attempt` | info | Toda invocação, antes de qualquer regra | `coldStart` |
| `auth.success` | info | Token emitido | `durationMs` |
| `auth.invalid_cpf` | warn | 400 | `reason`: `invalid_cpf` ou `malformed_json` |
| `auth.denied` | warn | 401 | `reason`: `not_found`, `archived`, `inactive` ou `blocked` |
| `db.error` | error | 503 por banco | `errorCode`: código do Postgres (`42P01`, `42703`, `57014`) ou `unknown` |
| `bootstrap.error` | error | 503 na montagem | `errorCode`: nome do erro (`ParameterNotFound`, `AccessDeniedException`, `Error`) |
| `db.pool_error` | error | Conexão ociosa do Pool caiu (RDS reiniciado, failover) | `errorCode` |
| `auth.error` | error | 500 inesperado | — |

O que **nunca** entra no log: o CPF (nem claro, nem mascarado, nem hash), o token, a
mensagem de erro do banco ou do SDK (que pode trazer host, path ou ARN). Os testes de
unidade e de integração verificam a ausência do CPF no log em todos os desfechos.

### Correlation id

O `X-Correlation-ID` recebido — normalmente o `<uuid>#<n>` gerado pelo plugin
`correlation-id` do Kong — vai para todas as linhas de log da invocação, para o header
`x-correlation-id` da resposta e para o campo `correlationId` dos corpos de erro. Valor fora
de `^[A-Za-z0-9._:#-]{1,128}$` é descartado e substituído pelo `requestId` do evento, para
evitar injeção de log e cardinalidade sem limite.

Para achar o motivo real de um 401 ou 503 a partir do `correlationId` que o cliente recebeu:

```bash
aws logs tail /aws/lambda/techchallenge-auth-staging --since 1h \
  --filter-pattern '"0f6c3d2e-6a1b-4c39-9a4e-0d7f5b2c8e11#12"'
```

### Métricas

As métricas nativas da Lambda (`Invocations`, `Duration`, `Throttles`, `ConcurrentExecutions`)
ficam no CloudWatch sem configuração. Como o handler nunca lança exceção, a métrica `Errors`
não conta 400, 401 nem 503 — só timeout ou falha do runtime —, e a taxa de erro de negócio
vem dos eventos do log. Métricas
por rota e por status do lado do gateway são do plugin `prometheus` do Kong, no repositório
da aplicação. Este repositório não cria alarmes nem dashboards.

## Custo estimado

Por ambiente, em `us-east-1`, com preços públicos sob demanda e **sem** Free Tier:

| Recurso | Premissa | ~US$/dia |
|---|---|---|
| Lambda — requisições | 1.000 autenticações/dia × US$ 0,20 por milhão | 0,0002 |
| Lambda — computação | 1.000 × 0,25 GB × 0,2 s médio = 50 GB-s × US$ 0,0000166667 | 0,0008 |
| ECR — armazenamento | Até 10 imagens × ~0,2 GB = 2 GB × US$ 0,10/GB-mês | 0,0067 |
| CloudWatch Logs | ~1 KB por invocação = ~1 MB/dia × US$ 0,50/GB de ingestão; 14 dias de retenção | 0,0005 |
| SSM Parameter Store | Parâmetros Standard e throughput padrão, sem custo; até 2 decriptações KMS por cold start (~50/dia) a US$ 0,03 por 10 mil | 0,0003 |
| **Total por ambiente** | | **~0,01** |

Com `staging` e `prod` no ar, o total fica em **~US$ 0,02/dia**, ou ~US$ 0,60/mês. O
ECR é a maior parcela, e é custo de armazenamento: existe mesmo sem tráfego.

Premissas e limites da estimativa:

- **Duração média de 0,2 s** pondera invocações aquecidas (uma consulta indexada numa conexão
  já aberta, dezenas de milissegundos) com os cold starts, que leem seis parâmetros do SSM e
  abrem a conexão TLS com o RDS.
- **Tamanho da imagem** estimado pela base `public.ecr.aws/lambda/nodejs:22` mais as
  dependências de produção; o lifecycle do ECR limita a 10 imagens. Camadas compartilhadas
  entre tags tendem a deixar o valor real abaixo disso.
- **Escala**: com 100 mil autenticações/dia, Lambda e logs somam ~US$ 0,15/dia por ambiente.
  O custo cresce linearmente com o tráfego e é zero sem ele.
- **Fora da conta**, porque pertencem a outros repositórios: NAT Gateway (por onde a função
  alcança o SSM), RDS, EKS e o NLB do Kong. A função não cria NAT, endpoint de VPC nem
  provisioned concurrency; as ENIs da Lambda na VPC não são cobradas.
- No Free Tier da Lambda (1 milhão de requisições e 400 mil GB-s por mês), a parcela da
  Lambda é zero.

## Dívidas conscientes

| Dívida | Por que foi aceita | Quando deixa de ser aceitável |
|---|---|---|
| Credenciais do lab coladas como secret a cada sessão | O AWS Academy não deixa criar a role do OIDC | Fora do Academy: aí só `AWS_DEPLOY_ROLE` |
| O gateway não consulta o status do cliente | O plugin `jwt` do Kong valida só o token; consultar o banco a cada requisição protegida multiplicaria conexões no RDS | Quando bloquear um cliente precisar valer em menos de 1 h (o `exp` do token) |
| Kong invoca a função com a LabRole do nó | O AWS Academy não permite criar roles, então não há IRSA | Fora do Academy: qualquer pod do nó poderia invocar a função |
| Segredo HS256 compartilhado com a aplicação principal | Mesmo algoritmo e segredo que a aplicação já valida, sem mudança do lado de lá | Quando um terceiro precisar validar tokens: aí o caminho é RS256 com JWKS |
| Sem RDS Proxy | `max: 1` por container e tráfego acadêmico; o alarme de conexões do repositório de banco é o gatilho | Quando o alarme `rds-conexoes` disparar |

## Documentação

- [QUICKSTART.md](QUICKSTART.md) — passo a passo local e AWS, e o que fazer quando der errado
- [ADRs](docs/ADRs) — decisões arquiteturais permanentes
- [RFCs](docs/RFCs) — propostas técnicas
- [C4 Model](docs/C4Model/README.md) — contexto, container e componentes
- [Diagramas](docs/diagrams) — arquitetura, sequência e deploy
- [OpenAPI](docs/api/openapi.yaml) e [coleção Postman](docs/postman/techchallenge-auth.postman_collection.json) — contrato do `POST /auth`
- [CONTRIBUTING.md](CONTRIBUTING.md) — commits, branches, merge e revisão
