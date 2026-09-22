# Function Serverless de Autenticação — Tech Challenge Fase 3

Function Serverless (AWS Lambda) que autentica o **cliente da oficina pelo CPF**: valida o
documento, consulta a existência e o status do cliente na base gerenciada e devolve um
**JWT** válido para consumo das APIs protegidas. O mesmo repositório entrega o **Lambda
Authorizer** que protege as rotas sensíveis na borda do API Gateway.

É um dos quatro repositórios da Fase 3:

| Repositório | Papel |
|---|---|
| [TechChallange](https://github.com/DevKaue/TechChallange) | Aplicação principal em Kubernetes (Fases 1 e 2) |
| **TechChallange---Function-Serverless** (este) | **Function Serverless de autenticação por CPF** |
| [tech-challenge-database-infra](https://github.com/DevKaue/tech-challenge-database-infra) | Banco de dados gerenciado (Terraform) |
| _(a definir)_ | Infraestrutura Kubernetes (Terraform) |

> **Status: bootstrap.** Este repositório acabou de ser criado. As seções abaixo existem
> porque são entregáveis obrigatórios do desafio e vão ser preenchidas nos marcos M2 e M5
> do plano de execução. O que já vale: o fluxo de contribuição em
> [CONTRIBUTING.md](CONTRIBUTING.md) e a decisão de bootstrap em
> [ADR-000](docs/ADRs/ADR-000-bootstrap-do-repositorio.md).

## Propósito

<!-- M2 -->

## Tecnologias utilizadas

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Runtime | Node.js 22 + TypeScript | O validador de CPF é portado linha a linha da aplicação principal; duas implementações da mesma regra divergiriam num caso de borda, em produção |
| Empacotamento | Container image no ECR | Atende ao entregável de Dockerfile e permite embutir o bundle de CAs do RDS, fechando a dívida de TLS declarada no repositório-base |
| Banco | `pg` (driver direto), sem ORM | O schema pertence a outro repositório; um `schema.prisma` copiado seria uma segunda fonte de verdade que compila mesmo divergente |
| Token | `jsonwebtoken`, HS256 | Mesmo segredo e mesmo algoritmo da aplicação principal |
| Testes | Jest + Postgres em service container | Mesma estratégia do repositório-base |
| IaC | Terraform `~> 1.10` | Função, alias, role de execução e observabilidade |
| CI/CD | GitHub Actions com OIDC | Sem chave estática em secret de repositório |

## Passos para execução e deploy

<!-- M2 / M3 — inclui o ambiente local com Runtime Interface Emulator e o deploy por
     alias, com rollback para a versão anterior -->

## Diagrama da arquitetura deste repositório

<!-- M2 — bloco ```mermaid INLINE. O GitHub não renderiza .mmd linkado, e quem avalia não
     clona o repositório para ver desenho. A fonte fica em docs/diagrams/ -->

## Contrato da API

<!-- M2 — a função NÃO é NestJS, então o OpenAPI não é gerado automaticamente:
     docs/api/openapi.yaml é escrito à mão e a coleção Postman é versionada em
     docs/postman/ -->

| Status | Quando |
|---|---|
| 200 | CPF válido, cliente existente e elegível |
| 400 | Formato ou dígito verificador inválido — sem tocar no banco |
| 401 | Cliente não cadastrado **ou** não elegível, indistinguíveis |
| 503 | Banco indisponível |

O 401 é deliberadamente indistinguível entre "não existe" e "não elegível": diferenciar
permitiria enumeração de CPF a partir de listas vazadas. O motivo real fica no log
estruturado, correlacionado pelo `correlationId` devolvido no corpo.

## Custo estimado

<!-- M2 — tabela em US$/dia -->

## Dívidas conscientes

<!-- M2 — cada dívida com o critério que a tornaria inaceitável -->

## Documentação

- [ADRs](docs/ADRs) — decisões arquiteturais permanentes
- [RFCs](docs/RFCs) — propostas técnicas em discussão
- [CONTRIBUTING.md](CONTRIBUTING.md) — commits, branches, merge e revisão
