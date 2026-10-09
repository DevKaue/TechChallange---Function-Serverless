terraform {
  required_version = "~> 1.10"

  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.90" }
  }

  # Key LITERAL por ambiente, como no repositório de banco: o ambiente aparece no
  # path do state e no diff do PR, e um workspace esquecido não faz o deploy de
  # staging planejar contra o state de prod.
  backend "s3" {
    bucket       = "techchallenge-fiap-v1"
    key          = "lambda/staging/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
