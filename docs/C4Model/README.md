# C4 Model - Function Serverless de autenticação por CPF

Este documento reúne os diagramas C4 em Mermaid para visualização direta no GitHub. O
sistema em foco é a função `techchallenge-auth-<env>` deste repositório; Kong, aplicação
principal, banco e SSM aparecem como sistemas externos porque são provisionados e mantidos
pelos outros repositórios da Fase 3.

Arquivos-fonte:

- [context.mmd](context.mmd)
- [container.mmd](container.mmd)
- [components.mmd](components.mmd)

## Nível 1 - Contexto

O cliente da oficina nunca chama a função diretamente: o único ponto de entrada é o Kong,
que invoca a função no `POST /auth` e valida o token emitido por ela nas rotas protegidas.

```mermaid
graph TD
    %% Estilos das Classes
    classDef person fill:#084298,stroke:#052c65,stroke-width:2px,color:#ffffff,rx:10px,ry:10px;
    classDef system fill:#1168bd,stroke:#0b4884,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;
    classDef extSystem fill:#999999,stroke:#666666,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;

    %% Atores (Personas)
    C["👤 <b>Cliente da oficina</b><br/><i>[Person]</i><br/>Identifica-se pelo CPF para acompanhar e aprovar os próprios serviços"]:::person

    %% Sistema em foco
    S["🔐 <b>Autenticação de cliente por CPF</b><br/><i>[Software System]</i><br/>Valida o CPF, consulta existência e status do cliente e emite JWT HS256 de 1 h"]:::system

    %% Sistemas externos
    K["🚪 <b>Kong API Gateway</b><br/><i>[Software System]</i><br/>Roteia o POST /auth para a função e valida o JWT nas rotas protegidas"]:::extSystem
    APP["🏢 <b>Aplicação principal</b><br/><i>[Software System]</i><br/>API da oficina no EKS; revalida o token e autoriza"]:::extSystem
    DB["🗄️ <b>Banco de dados gerenciado</b><br/><i>[Software System]</i><br/>RDS PostgreSQL com a tabela customers (repositório de banco)"]:::extSystem
    SSM["🔑 <b>AWS SSM Parameter Store</b><br/><i>[Software System]</i><br/>Segredo JWT e contrato de descoberta do banco"]:::extSystem

    %% Relacionamentos
    C -->|"POST /auth com o CPF e, depois, chamadas com Bearer JWT"| K
    K -->|"Invoca a função (evento v1.0)"| S
    K -->|"Encaminha rotas protegidas com token válido"| APP
    S -->|"Consulta id, status e deleted_at do cliente"| DB
    S -->|"Lê o segredo JWT e os parâmetros do banco"| SSM
    APP -->|"Lê e grava os dados da oficina"| DB
```

## Nível 2 - Container

Este repositório entrega três containers: a função em si (imagem de container), o
repositório ECR que guarda as versões da imagem e o log group com retenção definida. Não há
API Gateway, Lambda Authorizer nem permissão de invocação criados aqui
([ADR-002](../ADRs/ADR-002-kong-invoca-a-funcao-sem-api-gateway.md)).

```mermaid
graph TD
    %% Estilos das Classes (mantendo identidade visual do diagrama de contexto)
    classDef person fill:#084298,stroke:#052c65,stroke-width:2px,color:#ffffff,rx:10px,ry:10px;
    classDef systemBoundary fill:#e7f1ff,stroke:#0b4884,stroke-width:2px,color:#052c65,rx:10px,ry:10px;
    classDef container fill:#1168bd,stroke:#0b4884,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;
    classDef database fill:#0b4884,stroke:#052c65,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;
    classDef extSystem fill:#999999,stroke:#666666,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;

    %% Atores (Personas)
    C["👤 <b>Cliente da oficina</b><br/><i>[Person]</i><br/>Autentica-se pelo CPF"]:::person

    %% Sistemas externos
    K["🚪 <b>Kong API Gateway</b><br/><i>[Software System: EKS]</i><br/>Plugins aws-lambda, jwt, rate-limiting e correlation-id"]:::extSystem
    APP["🏢 <b>Aplicação principal</b><br/><i>[Software System: EKS]</i><br/>Revalida o JWT e autoriza"]:::extSystem
    SSM["🔑 <b>SSM Parameter Store</b><br/><i>[Software System]</i><br/>/techchallenge/&lt;env&gt;/auth/jwt-secret e /techchallenge/&lt;env&gt;/db/*"]:::extSystem
    DB[("🗄️ <b>RDS PostgreSQL</b><br/><i>[Container: Database, repositório de banco]</i><br/>Tabela customers")]:::database
    GHA["⚙️ <b>GitHub Actions</b><br/><i>[Software System]</i><br/>ci.yml e deploy.yml"]:::extSystem

    %% Fronteira do sistema (este repositório)
    subgraph SB["🔐 Autenticação de cliente por CPF (este repositório)"]
        direction TB
        FN["⚡ <b>Função techchallenge-auth-&lt;env&gt;</b><br/><i>[Container: AWS Lambda, container image]</i><br/><b>Tecnologias:</b> Node.js 22, TypeScript, pg, jsonwebtoken, AWS SDK v3<br/>Handler handler.handler, 256 MB, timeout 9 s, subnets privadas, LabRole"]:::container
        ECR[("📦 <b>Repositório de imagem</b><br/><i>[Container: Amazon ECR]</i><br/>techchallenge-auth-&lt;env&gt;, tag imutável, scan no push, 10 últimas imagens")]:::database
        LOG[("📜 <b>Log group</b><br/><i>[Container: CloudWatch Logs]</i><br/>/aws/lambda/techchallenge-auth-&lt;env&gt;, retenção de 14 dias")]:::database
    end
    class SB systemBoundary

    %% Relacionamentos
    C -->|"HTTP + JSON: POST /auth"| K
    K -->|"lambda:InvokeFunction, evento v1.0, timeout 10 s"| FN
    K -->|"HTTP + Bearer JWT validado"| APP
    FN -->|"HTTPS 443 pelo NAT: GetParameter"| SSM
    FN -->|"SQL/TLS 5432, SG de cliente do banco"| DB
    FN -->|"Uma linha JSON por evento"| LOG
    ECR -.->|"Imagem da versão (image_uri)"| FN
    GHA -->|"docker push da tag v&lt;run_number&gt;"| ECR
    GHA -->|"terraform apply"| FN
    APP -->|"SQL/TCP 5432"| DB
```

## Nível 3 - Components

A função segue três camadas — `domain/`, `application/` e `infra/`. Só `infra/` e o
`handler.ts` importam `aws-lambda`, `@aws-sdk/*`, `pg` ou `jsonwebtoken`, e o ESLint
reprova esses imports dentro de `domain/` (`no-restricted-imports`). A montagem das dependências
acontece na primeira invocação de cada container, e uma falha nessa etapa vira 503 no
contrato, nunca 502 ([ADR-001](../ADRs/ADR-001-composicao-no-primeiro-request-e-authorizer-sem-banco.md)).

```mermaid
graph TD
    %% Estilos visuais
    classDef person fill:#084298,stroke:#052c65,stroke-width:2px,color:#ffffff,rx:10px,ry:10px;
    classDef systemBoundary fill:#e7f1ff,stroke:#0b4884,stroke-width:2px,color:#052c65,rx:10px,ry:10px;
    classDef container fill:#1168bd,stroke:#0b4884,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;
    classDef component fill:#1f78d1,stroke:#0b4884,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;
    classDef sharedKernel fill:#0d5ca6,stroke:#083b6c,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;
    classDef infra fill:#0a4f92,stroke:#063867,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;
    classDef database fill:#0b4884,stroke:#052c65,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;
    classDef extSystem fill:#999999,stroke:#666666,stroke-width:2px,color:#ffffff,rx:8px,ry:8px;

    %% Externos
    K["🚪 <b>Kong API Gateway</b><br/><i>[Software System]</i><br/>Plugin aws-lambda"]:::extSystem
    SSM["🔑 <b>SSM Parameter Store</b><br/><i>[Software System]</i>"]:::extSystem
    DB[("🗄️ <b>RDS PostgreSQL</b><br/><i>[Container: Database]</i><br/>Tabela customers")]:::database
    LOG[("📜 <b>CloudWatch Logs</b><br/><i>[Container]</i>")]:::database

    %% Fronteira do sistema e container em foco
    subgraph SB["🔐 Autenticação de cliente por CPF"]
        direction TB
        subgraph FNB["⚡ Função techchallenge-auth-env [Container: AWS Lambda, Node.js 22 + TypeScript]"]
            direction TB

            H["🧷 <b>handler.ts</b><br/><i>[Composition root]</i><br/>Instâncias concretas: Pool pg, SsmSecretProvider, logger"]:::infra
            LZ["⏳ <b>createLazyHandler</b><br/><i>[Component: infra/http]</i><br/>Monta no primeiro request; falha vira 503, com nova tentativa"]:::component
            CMP["🧩 <b>composeAuthHandler</b><br/><i>[Component: infra/composition]</i><br/>Lê config, SSM e CA e monta o caso de uso"]:::component
            HTTP["🌐 <b>createAuthHttpHandler</b><br/><i>[Component: infra/http]</i><br/>Evento v1.0/v2.0, correlation id, mapeia erros para 400/401/503"]:::component

            UC["🎯 <b>AuthenticateCustomerUseCase</b><br/><i>[Component: application]</i><br/>Valida CPF, busca cliente, checa elegibilidade, pede o token"]:::component
            DOM["📐 <b>Domínio</b><br/><i>[Component: domain]</i><br/>Cpf (value object), Customer, CustomerStatus, erros e contratos"]:::sharedKernel

            CFG["⚙️ <b>runtime-config + database-settings</b><br/><i>[Infrastructure Component]</i><br/>Paths SSM obrigatórios e Pool com TLS, max 1"]:::infra
            SEC["🔑 <b>SsmSecretProvider</b><br/><i>[Infrastructure Component]</i><br/>GetParameter com decriptação, cache por path"]:::infra
            REPO["🗃️ <b>PgCustomerRepository</b><br/><i>[Infrastructure Component]</i><br/>SELECT por document e document_type CPF"]:::infra
            JWT["✍️ <b>JsonWebTokenService</b><br/><i>[Infrastructure Component]</i><br/>HS256, exp 3600 s, segredo com 32+ caracteres"]:::infra
            UUID["🎲 <b>RandomUuidGenerator</b><br/><i>[Infrastructure Component]</i><br/>jti com crypto.randomUUID"]:::infra
            LG["📝 <b>ConsoleJsonLogger</b><br/><i>[Infrastructure Component]</i><br/>Uma linha JSON por evento, sem CPF nem token"]:::infra
        end
    end
    class SB systemBoundary
    class FNB container

    %% Entrada
    K -->|"Invoke, evento v1.0"| H
    H --> LZ
    LZ -->|"primeira invocação"| CMP
    LZ -->|"invocações seguintes"| HTTP

    %% Montagem
    CMP --> CFG
    CMP --> SEC
    CMP -->|"cria"| HTTP

    %% Fluxo da requisição
    HTTP -->|"execute(cpf)"| UC
    UC -. "In-process" .-> DOM
    UC -->|"findByCpf"| REPO
    UC -->|"sign"| JWT
    UC -->|"generate"| UUID
    HTTP -->|"write"| LG
    LZ -->|"bootstrap.error"| LG

    %% Saídas
    SEC -->|"HTTPS 443"| SSM
    REPO -->|"SQL/TLS 5432"| DB
    LG -->|"stdout"| LOG
```
