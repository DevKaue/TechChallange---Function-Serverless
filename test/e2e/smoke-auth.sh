#!/usr/bin/env bash
# Smoke pós-deploy da autenticação por CPF, contra o Kong REAL (NLB do gateway).
#
# Roda no job de deploy, depois de publicar o alias, e decide se o deploy fica
# ou se o alias volta para a versão anterior. Só usa curl e jq, que já existem
# no runner do GitHub — nada de npm install para um teste de 30 segundos.
#
# Uso:
#   API_URL=http://<nlb-do-kong>.elb.us-east-1.amazonaws.com \
#   CPF_ATIVO=11144477735 \
#   [PROTECTED_URL=http://<nlb-do-kong>/api/<rota de cliente>] \
#   test/e2e/smoke-auth.sh
#
# CPF_ATIVO precisa existir, ACTIVE e não arquivado, no banco do ambiente
# (seed de homologação). A massa é sintética — ver cpf.vo.spec.ts.
#
# São 4 chamadas ao /auth: cabem no rate limit de 10/min por IP do Kong. Rodar o
# smoke em loop, do mesmo runner, começa a devolver 429 e não é falha da função.

set -euo pipefail

: "${API_URL:?defina API_URL}"
: "${CPF_ATIVO:?defina CPF_ATIVO}"
CPF_NUNCA_CADASTRADO="${CPF_NUNCA_CADASTRADO:-55566677720}"
CORRELATION_ID="smoke-$(date +%s)"

falhas=0
ok()   { printf '  ok   %s\n' "$1"; }
erro() { printf '  FALHA %s\n' "$1"; falhas=$((falhas + 1)); }

# POST /auth; imprime "<status> <corpo>" sem nunca ecoar o CPF enviado.
auth() {
  curl -sS -o /tmp/smoke-body.json -w '%{http_code}' \
    -X POST "${API_URL%/}/auth" \
    -H 'content-type: application/json' \
    -H "x-correlation-id: ${CORRELATION_ID}" \
    --data "$1"
}

echo "Smoke de autenticação em ${API_URL} (correlationId ${CORRELATION_ID})"

status=$(auth '{"cpf":"11144477734"}')
[ "$status" = 400 ] && ok "DV inválido devolve 400" || erro "DV inválido devolveu ${status}"

status=$(auth '{"cpf":')
[ "$status" = 400 ] && ok "JSON malformado devolve 400, não 502" || erro "JSON malformado devolveu ${status}"

status=$(auth "{\"cpf\":\"${CPF_NUNCA_CADASTRADO}\"}")
[ "$status" = 401 ] && ok "CPF nunca cadastrado devolve 401" || erro "CPF nunca cadastrado devolveu ${status}"
jq -e '.error == "unauthorized" and .message == "CPF não autorizado"' /tmp/smoke-body.json >/dev/null \
  && ok "401 com a mensagem genérica do contrato" || erro "corpo do 401 fora do contrato"

status=$(auth "{\"cpf\":\"${CPF_ATIVO}\"}")
if [ "$status" = 200 ]; then
  ok "cliente ativo devolve 200"
  jq -e '.token_type == "Bearer" and .expires_in == 3600 and (.access_token | length > 0) and (keys | length == 3)' \
    /tmp/smoke-body.json >/dev/null && ok "corpo do 200 no contrato" || erro "corpo do 200 fora do contrato"

  token=$(jq -r '.access_token' /tmp/smoke-body.json)
  # Payload do JWT (base64url, sem verificar assinatura — isso é papel do
  # plugin jwt do Kong e do teste unitário). Confere só que não vazou dado pessoal.
  # base64url vem sem padding, e o `base64 -d` do GNU recusa entrada sem ele.
  seg=$(printf '%s' "$token" | cut -d. -f2 | tr '_-' '/+')
  while [ $(( ${#seg} % 4 )) -ne 0 ]; do seg="${seg}="; done
  payload=$(printf '%s' "$seg" | base64 -d 2>/dev/null || true)
  printf '%s' "$payload" | jq -e 'has("cpf") or has("email") or has("name") or has("role") | not' >/dev/null \
    && ok "JWT sem cpf, email, name ou role" || erro "JWT carrega claim proibida"
  printf '%s' "$payload" | jq -e '.type == "customer" and .iss == "techchallenge-auth-lambda"' >/dev/null \
    && ok "JWT com type e iss esperados" || erro "JWT com type/iss inesperados"

  if [ -n "${PROTECTED_URL:-}" ]; then
    s=$(curl -sS -o /dev/null -w '%{http_code}' "$PROTECTED_URL")
    [ "$s" = 401 ] && ok "rota protegida sem token devolve 401" || erro "rota protegida sem token devolveu ${s}"

    s=$(curl -sS -o /dev/null -w '%{http_code}' -H "authorization: Bearer ${token}" "$PROTECTED_URL")
    case "$s" in 2??) ok "rota protegida com token devolve ${s}" ;; *) erro "rota protegida com token devolveu ${s}" ;; esac

    s=$(curl -sS -o /dev/null -w '%{http_code}' -H "authorization: Bearer ${token}x" "$PROTECTED_URL")
    [ "$s" = 401 ] || [ "$s" = 403 ] && ok "token adulterado é recusado (${s})" || erro "token adulterado devolveu ${s}"
  fi
else
  erro "cliente ativo devolveu ${status} (esperado 200) — confira o seed do ambiente"
fi

rm -f /tmp/smoke-body.json
echo
if [ "$falhas" -gt 0 ]; then
  echo "${falhas} verificação(ões) falharam. Busque ${CORRELATION_ID} nos logs para o motivo real."
  exit 1
fi
echo "Smoke verde."
