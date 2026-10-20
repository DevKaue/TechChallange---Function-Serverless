# Quickstart — rodar e publicar a função

Passo a passo direto. O porquê de cada decisão está comentado no próprio arquivo — em
`src/`, no [`Dockerfile`](Dockerfile), em [`infra/terraform`](infra/terraform) e nos
workflows — e resumido no [README.md](README.md).

- [Local](#local) — sua máquina, ~10 min, sem AWS
- [AWS](#aws) — staging ou prod de verdade, ~15 min depois que os outros repositórios
  estiverem no ar, **~US$ 0,01/dia** por ambiente para esta função

Todos os CPFs deste guia são **sintéticos**, da massa de teste do repositório
(`src/domain/value-objects/cpf.vo.spec.ts`). Nunca use um CPF real em teste, log ou print.

---

## Local

### Pré-requisitos

| Ferramenta | Para quê |
|---|---|
| Node.js 22 (`nvm use` lê o `.nvmrc`) | Build e testes |
| Docker | Postgres da integração e a imagem da função |
| `jq` | Ler as respostas (opcional) |
| Terraform ≥ 1.10 | Só para os testes do módulo da função |

> No Windows, use WSL ou Git Bash: os comandos e o smoke são bash.

### Passo 1 — dependências e checagens

```bash
nvm use
npm ci
npm run typecheck
npm run lint
npm test            # unitários + contratos, com cobertura mínima global
```

`npm run test:ci` roda a mesma suíte do CI, com cobertura em `coverage/`.

### Passo 2 — integração contra Postgres real

```bash
npm run db:it:up            # postgres:15.19-alpine na porta 5432
npm run test:integration
npm run db:it:down
```

Cada arquivo de teste cria um schema próprio, com a tabela `customers` espelhando a da
aplicação principal, e semeia a massa sintética. Os casos cobrem cliente ativo, arquivado,
inativo, bloqueado, nunca cadastrado, outro tipo de documento, tabela ausente (`42P01`),
coluna `status` ausente (`42703`) e statement timeout (`57014`).

> **Porta 5432 ocupada?** Suba o container em outra porta e aponte a suíte para ela:
> ```bash
> docker run -d --rm --name techchallenge-pg-it -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:15.19-alpine
> DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres npm run test:integration
> ```

### Passo 3 — a imagem real, com o Runtime Interface Emulator

```bash
docker build --provenance=false -t techchallenge-auth:local .

docker run -d --name fn -p 9000:8080 \
  -e APP_ENV=local \
  -e JWT_SECRET_SSM_PATH=/techchallenge/staging/auth/jwt-secret \
  -e DB_SSM_PREFIX=/techchallenge/staging/db \
  -e AWS_REGION=us-east-1 -e AWS_EC2_METADATA_DISABLED=true \
  techchallenge-auth:local
```

> **Mac com Apple Silicon:** acrescente `--platform linux/amd64` ao `docker build`. A
> função roda em `x86_64`, e é essa a imagem que vai para o ECR.

Invoque com um evento v1.0, igual ao que o plugin `aws-lambda` do Kong envia (body em
base64):

```bash
body=$(printf '{"cpf":"11144477735"}' | base64 | tr -d '\n')
curl -s localhost:9000/2015-03-31/functions/function/invocations \
  -d "{\"httpMethod\":\"POST\",\"path\":\"/auth\",\"headers\":{\"x-correlation-id\":\"local-kong#1\"},\"body\":\"${body}\",\"isBase64Encoded\":true,\"requestContext\":{\"requestId\":\"local-req\"}}" | jq
```

Sem credencial da AWS, a resposta esperada é o **503 de bootstrap**, no contrato e com o
correlation id que você mandou:

```json
{
  "statusCode": 503,
  "headers": {
    "content-type": "application/json; charset=utf-8",
    "x-correlation-id": "local-kong#1"
  },
  "body": "{\"error\":\"service_unavailable\",\"message\":\"Serviço temporariamente indisponível\",\"correlationId\":\"local-kong#1\"}"
}
```

É exatamente o que o job `imagem` do CI confere. Prova que o handler está no `CMD` certo, que
o bundle de CAs do RDS está na imagem e que o evento v1.0 é aceito. O log mostra o motivo:

```bash
docker logs fn 2>&1 | grep bootstrap.error
docker rm -f fn
```

> Um 200 local não é possível: o RDS é privado na VPC do ambiente. Mesmo com credenciais
> reais da AWS no container, o SSM responde e a conexão com o banco estoura em 3 s, com
> `db.error` no log e o mesmo 503.

A coleção Postman ([docs/postman](docs/postman/techchallenge-auth.postman_collection.json))
tem esta mesma chamada na pasta **Local - imagem com RIE**.

### Passo 4 — testes do Terraform

```bash
cd infra/terraform/modules/function
terraform init -backend=false
terraform test
cd -
```

O provider é mockado: não precisa de credencial e não cria nada. Os testes provam o nome da
função, a LabRole, os paths do SSM e a rede — o que o Kong e os outros repositórios esperam.

---

## AWS

> Esta função custa **~US$ 0,01/dia** por ambiente (ver
> [Custo estimado](README.md#custo-estimado)). O que custa de verdade são os outros
> repositórios — EKS, NAT e RDS. Faça o [teardown](#derrubar) ao terminar.

### Pré-requisitos na AWS

- AWS CLI v2 respondendo `aws sts get-caller-identity`, `gh` autenticado no repositório e
  Terraform ≥ 1.10.
- **Os outros repositórios aplicados no mesmo ambiente, nesta ordem:**
  1. [Infraestrutura Kubernetes](https://github.com/DevKaue/TechChallenge---Infraestrutura-Kubernetes-com-Terraform):
     VPC com as tags `Project=techchallenge`, `Environment=<env>` e `ManagedBy=terraform`,
     subnets privadas com `kubernetes.io/role/internal-elb=1`, NAT, Kong e o parâmetro
     `/techchallenge/<env>/auth/jwt-secret`.
  2. [Banco de dados](https://github.com/DevKaue/tech-challenge-database-infra): RDS e os
     parâmetros `/techchallenge/<env>/db/{host,port,name,username,password,client-sg-id}`.
     **Sem o banco aplicado, o plan desta função falha**: o Terraform lê o
     `client-sg-id` do SSM para anexar o SG de cliente à função.
  3. [Aplicação](https://github.com/DevKaue/tech-challenge-app-): migrations aplicadas (a
     tabela `customers` com a coluna `status`) e um cliente sintético `ACTIVE` no seed, para
     o smoke.

Confira sem imprimir nenhum valor secreto:

```bash
ENV=staging
aws ssm get-parameter --name /techchallenge/$ENV/auth/jwt-secret --query Parameter.Name --output text
aws ssm get-parameters-by-path --path /techchallenge/$ENV/db --query 'Parameters[].Name' --output text
aws ec2 describe-vpcs --filters Name=tag:Project,Values=techchallenge Name=tag:Environment,Values=$ENV \
  --query 'Vpcs[].VpcId' --output text
```

Precisa listar o segredo JWT, os parâmetros do banco (entre eles `host`, `port`, `name`,
`username`, `password` e `client-sg-id`) e **uma** VPC.

### Passo 1 — bucket do state (uma vez por conta AWS)

O bucket é criado pelo bootstrap da infraestrutura Kubernetes e compartilhado pelos
quatro repositórios; esta função usa as keys `lambda/staging/terraform.tfstate` e
`lambda/prod/terraform.tfstate`. O nome **não** está no código: nome de bucket é global, e
cada conta do AWS Academy precisa do seu. Ele entra no `init` por configuração parcial do
backend:

```bash
export TF_STATE_BUCKET=<nome do bucket do bootstrap>
aws s3api head-bucket --bucket "$TF_STATE_BUCKET"   # precisa responder sem erro
```

Rodando este repositório sozinho, crie um com nome único:

```bash
aws s3api create-bucket --bucket "$TF_STATE_BUCKET" --region us-east-1
aws s3api put-bucket-versioning --bucket "$TF_STATE_BUCKET" --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket "$TF_STATE_BUCKET" \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### Passo 2 — secrets e variáveis nos environments do GitHub

Crie os environments `staging` e `production` (Settings → Environments). No `production`,
configure o revisor obrigatório e deixe **"Prevent self-review" desligado**
([ADR-000](docs/ADRs/ADR-000-bootstrap-do-repositorio.md)).

Credenciais — **um** dos dois conjuntos por environment, nunca os dois:

| Conjunto | Secrets | Quando |
|---|---|---|
| OIDC | `AWS_DEPLOY_ROLE` (ARN da role) | Conta em que é possível criar a role e o provider OIDC |
| AWS Academy | `AWS_LAB_ACCESS_KEY_ID`, `AWS_LAB_SECRET_ACCESS_KEY`, `AWS_LAB_SESSION_TOKEN` | Learner Lab: copie de **AWS Details → AWS CLI**. Expiram com a sessão |

Bucket do state: variável `TF_STATE_BUCKET` (no repositório ou no environment), com o
nome do Passo 1. Sem ela, o deploy para antes do `init` dizendo o que configurar.

Smoke pelo Kong (opcional; sem `KONG_URL`, o deploy pula o smoke):

| Nome | Tipo | Valor |
|---|---|---|
| `KONG_URL` | variável | `http://<nlb-do-kong>`, preenchida **à mão** depois que a infra Kubernetes sobe. O hostname do NLB muda a cada criação do cluster: recriou o cluster, atualize a variável |
| `SMOKE_CPF_ATIVO` | secret | CPF sintético `ACTIVE` do seed do ambiente |
| `SMOKE_PROTECTED_URL` | variável | `http://<nlb-do-kong>/api/<rota de cliente>` (opcional) |

Pelo `gh`, sem `--body` nos secrets, para o valor não ficar no histórico do shell:

```bash
gh secret set AWS_LAB_ACCESS_KEY_ID --env staging
gh secret set AWS_LAB_SECRET_ACCESS_KEY --env staging
gh secret set AWS_LAB_SESSION_TOKEN --env staging
gh secret set SMOKE_CPF_ATIVO --env staging
gh variable set TF_STATE_BUCKET --body "$TF_STATE_BUCKET"
gh variable set KONG_URL --env staging --body "http://<nlb-do-kong>"
```

> **No AWS Academy, atualize os três `AWS_LAB_*` antes de cada deploy.** A sessão do lab
> expira, e o deploy falha logo nas credenciais com `ExpiredToken`.

### Passo 3 — primeiro deploy

O deploy de staging dispara sozinho no merge para `develop`; o de prod, no
merge para `main`, parando no gate do environment `production`. Para disparar à mão:

```bash
gh workflow run deploy.yml --ref develop
gh run watch
```

O workflow cria o repositório ECR, publica a imagem `v<run_number>`, aplica o Terraform com
essa tag, espera a função ficar ativa e roda o smoke, se configurado.

<details>
<summary>Sem GitHub Actions: o mesmo deploy à mão</summary>

```bash
ENV=staging
TAG=manual-$(date +%Y%m%d%H%M)   # fora da sequência v<N> do CI: a tag é imutável no ECR

cd infra/terraform/envs/$ENV
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
terraform apply -var "image_tag=$TAG" \
  -target=module.function.aws_ecr_repository.this \
  -target=module.function.aws_ecr_lifecycle_policy.this

ECR=$(aws ecr describe-repositories --repository-names techchallenge-auth-$ENV \
  --query 'repositories[0].repositoryUri' --output text)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin "${ECR%%/*}"
docker build --provenance=false --platform linux/amd64 -t "$ECR:$TAG" ../../../..
docker push "$ECR:$TAG"

terraform plan -var "image_tag=$TAG" -out=tfplan    # LEIA o plano
terraform apply tfplan
aws lambda wait function-updated-v2 --function-name techchallenge-auth-$ENV
cd -
```

> Não use `v1`, `v2`… à mão: o CI publica exatamente essas tags, e com tag imutável o push
> do workflow falharia com `ImageTagAlreadyExistsException`. `tfplan` é gitignored e nunca
> vai para o git.

</details>

### Passo 4 — conferir a função

```bash
aws lambda get-function-configuration --function-name techchallenge-auth-staging \
  --query '{estado:State,atualizacao:LastUpdateStatus,memoria:MemorySize,timeout:Timeout}'
```

Precisa sair `Active`, `Successful`, `256` e `9`.

Invoque direto, sem passar pelo Kong, com um CPF válido e **nunca cadastrado**:

```bash
aws lambda invoke --function-name techchallenge-auth-staging \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod":"POST","path":"/auth","headers":{"x-correlation-id":"quickstart-1"},"body":"{\"cpf\":\"55566677720\"}","isBase64Encoded":false,"requestContext":{"requestId":"quickstart"}}' \
  resposta.json && jq . resposta.json
```

Precisa sair `"statusCode": 401`. Esse 401 prova a cadeia inteira — SSM lido, conexão TLS
com o RDS aberta e tabela consultada. Um 503 aqui significa que alguma dependência falhou:
veja [Se der errado](#se-der-errado).

### Passo 5 — smoke pelo Kong

```bash
API_URL=http://<nlb-do-kong> \
CPF_ATIVO=<cpf sintético ACTIVE do seed> \
PROTECTED_URL=http://<nlb-do-kong>/api/<rota de cliente> \
test/e2e/smoke-auth.sh
```

Confere 400 para DV inválido e JSON malformado, 401 genérico para CPF nunca cadastrado, 200
no contrato para o cliente ativo, JWT sem dado pessoal e com `type`/`iss` esperados e, com
`PROTECTED_URL`, a rota protegida recusando token ausente ou adulterado. Termina com
`Smoke verde.`

> São 4 chamadas ao `/auth`, dentro do rate limit de 10/min por IP do Kong. Rodar em loop
> começa a devolver **429**, que não é falha da função.

A mesma bateria, interativa, está na coleção Postman: importe
[`docs/postman/techchallenge-auth.postman_collection.json`](docs/postman/techchallenge-auth.postman_collection.json)
e ajuste as variáveis `baseUrl` e `cpf`.

### Logs

```bash
aws logs tail /aws/lambda/techchallenge-auth-staging --since 15m --follow
aws logs tail /aws/lambda/techchallenge-auth-staging --since 1h --filter-pattern '"quickstart-1"'
```

Com o `correlationId` que o cliente recebeu no corpo do erro, o segundo comando mostra o
motivo real (`reason`, `errorCode`).

### Rollback

```bash
aws ecr describe-images --repository-name techchallenge-auth-staging \
  --query 'sort_by(imageDetails,&imagePushedAt)[-5:].imageTags' --output text
gh workflow run deploy.yml --ref develop -f image_tag=v12
```

Com `image_tag`, o workflow pula o build e só aplica o Terraform apontando para a imagem que
já está no ECR. O ambiente sai do branch: `--ref main` volta prod.

---

## Derrubar

**Nesta ordem: esta função primeiro**, depois o banco e por último a infra Kubernetes. As
ENIs da função na VPC e o SG de cliente do banco anexado a ela travam a remoção da rede e
do banco se a ordem for invertida.

```bash
ENV=staging
REPO=techchallenge-auth-$ENV
TAG=$(aws lambda get-function --function-name "$REPO" --query 'Code.ImageUri' --output text | sed 's/.*://')

# O ECR não tem force_delete: com imagem dentro, o destroy falha com RepositoryNotEmptyException.
aws ecr list-images --repository-name "$REPO" --query 'imageIds[*]' --output json > /tmp/ids.json
aws ecr batch-delete-image --repository-name "$REPO" --image-ids file:///tmp/ids.json

cd infra/terraform/envs/$ENV
terraform plan -destroy -var "image_tag=$TAG" -out=tfdestroy    # LEIA o que será apagado
terraform apply tfdestroy
cd -
```

> O destroy do security group da função pode ficar alguns minutos esperando a AWS liberar as
> ENIs da Lambda. É esperado; não interrompa.

> `terraform destroy` não apaga o bucket de state, de propósito: ele é compartilhado e o
> versionamento é o que permite recuperar um state apagado por engano.

---

## Se der errado

| Sintoma | O que fazer |
|---|---|
| 503 com `bootstrap.error` e `errorCode: ParameterNotFound` | Parâmetro do SSM ainda não publicado: o banco ou a infra Kubernetes do ambiente não foi aplicado. Confira com os comandos dos [pré-requisitos](#pré-requisitos-na-aws) |
| 503 com `bootstrap.error` e `errorCode: AccessDeniedException` | A role de execução não lê o parâmetro ou não decripta com a chave KMS dele |
| 503 com `bootstrap.error` e `errorCode: Error` | Configuração: variável de ambiente ausente, segredo JWT com menos de 32 caracteres ou bundle de CA inválido |
| Primeiro request morre em ~9 s com `Task timed out` no log, sem `bootstrap.error` | A função não alcança o SSM: subnet sem rota para o NAT, ou SG sem saída 443. O SDK fica esperando a conexão até o timeout da função, e o Kong devolve erro sem corpo |
| 503 com `db.error` e `errorCode: 42P01` | A tabela `customers` não existe: aplique as migrations da aplicação no banco do ambiente |
| 503 com `db.error` e `errorCode: 42703` | Falta a coluna `status` em `customers`: migration da Fase 3 da aplicação não aplicada |
| 503 com `db.error` e `errorCode: 57014`, `unknown` ou um código de rede (`ECONNREFUSED`, `ENOTFOUND`) | Statement timeout ou banco inalcançável: RDS parado, SG de cliente do banco ausente ou conexões esgotadas (alarme `rds-conexoes`) |
| 401 para um CPF que deveria estar ativo | Busque o `correlationId` no log: `reason` diz `not_found`, `archived`, `inactive` ou `blocked`. Lembre que a busca é só por `document_type = 'CPF'` |
| 429 no `/auth` | Rate limit do Kong (10/min por IP). Espere um minuto |
| 502/504 sem corpo vindo do Kong | O Kong não conseguiu invocar a função (credencial do nó, nome da função diferente de `techchallenge-auth-<env>`) ou a invocação passou de 10 s. Veja os logs do pod do Kong |
| `terraform plan` falha em `client-sg-id` | O repositório de banco não foi aplicado neste ambiente |
| `Subnets privadas nao encontradas para Project=...` | A VPC do ambiente não existe ou está sem as tags: aplique a infra Kubernetes antes |
| `image manifest media type not supported` | A imagem foi publicada com attestation. Refaça o build com `--provenance=false` |
| `Runtime.InvalidEntrypoint` ou `exec format error` | Imagem arm64 numa função `x86_64`: refaça com `--platform linux/amd64` |
| Push falha com `ImageTagAlreadyExistsException` | A tag já existe e é imutável. *Re-run* de um workflow mantém o mesmo `run_number`: dispare um run novo, ou use `image_tag` para reimplantar a imagem existente |
| Deploy falha em "Credenciais AWS" com `ExpiredToken` | Sessão do AWS Academy expirou: atualize os três `AWS_LAB_*` do environment |
| Deploy tenta assumir role com as chaves do lab | Os dois conjuntos de credenciais estão preenchidos. Deixe só um |
| Deploy de prod parado em "Waiting" | É o gate do environment `production`: aprove em **Review deployments** |

Diagnóstico geral:

```bash
aws lambda get-function-configuration --function-name techchallenge-auth-staging \
  --query '{estado:State,motivo:StateReason,atualizacao:LastUpdateStatus,imagem:ImageUri}'
aws logs tail /aws/lambda/techchallenge-auth-staging --since 30m | grep -E '"level":"(warn|error)"'
```
