# syntax=docker/dockerfile:1

# Imagem da função techchallenge-auth-<env> (Lambda container image).
#
# Dois estágios: o de build tem devDependencies e o compilador; o final só tem o
# JavaScript compilado, as dependências de produção e o bundle de CAs do RDS.

FROM public.ecr.aws/lambda/nodejs:22 AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM public.ecr.aws/lambda/nodejs:22

# O bundle entra na imagem, e não é lido da internet no cold start: sem ele o
# `pg` cairia em `rejectUnauthorized: false` ou falharia o TLS com o RDS. É o
# caminho padrão de RDS_CA_BUNDLE_PATH (src/infra/database/database-settings.ts).
ADD --chmod=444 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem ${LAMBDA_TASK_ROOT}/certs/global-bundle.pem
# O ADD aplica o 444 também ao diretório `certs/` que ele cria, sem o bit x. A
# Lambda roda a função com usuário sem privilégio: sem o x ele não entra no
# diretório, o readFileSync do bundle devolve EACCES e todo POST /auth vira 503.
RUN chmod 755 ${LAMBDA_TASK_ROOT}/certs

COPY --from=build /build/node_modules ${LAMBDA_TASK_ROOT}/node_modules
COPY --from=build /build/dist ${LAMBDA_TASK_ROOT}/

CMD ["handler.handler"]
