terraform {
  required_version = "~> 1.10"

  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.90" }
  }

  # Key LITERAL por ambiente, como no repositório de banco: o ambiente aparece no
  # path do state e no diff do PR, e um workspace esquecido não faz o deploy de
  # staging planejar contra o state de prod.
  #
  # O bucket NÃO está aqui: vem no init, por configuração parcial do backend
  # (`-backend-config="bucket=..."`, da variável TF_STATE_BUCKET no deploy). Nome
  # de bucket é global e cada conta do AWS Academy precisa do seu; com o nome
  # fixo, o init de outra conta falha com AccessDenied num bucket que ela não
  # pode recriar. É o bucket do bootstrap da infra Kubernetes, compartilhado
  # pelos quatro repositórios, cada um com a sua key.
  backend "s3" {
    key          = "lambda/staging/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
