# Testes do módulo da função com provider mockado: rodam sem credencial da AWS e
# sem criar nada (`plan`, ou `apply` contra o provider mockado). Provam o que o Kong e os outros
# repositórios esperam desta função: nome, role, paths do SSM e rede.
#
# Rodar: cd infra/terraform/modules/function && terraform init -backend=false && terraform test

mock_provider "aws" {}

override_data {
  target = data.aws_iam_role.execution
  values = {
    arn = "arn:aws:iam::111111111111:role/LabRole"
  }
}

override_data {
  target = data.aws_vpc.this
  values = {
    id = "vpc-0a1b2c3d4e5f60718"
  }
}

override_data {
  target = data.aws_subnets.private
  values = {
    ids = ["subnet-0aaa1111aaaa1111a", "subnet-0bbb2222bbbb2222b"]
  }
}

override_data {
  target = data.aws_ssm_parameter.db_client_sg_id
  values = {
    insecure_value = "sg-0c1i3n7e0000000aa"
  }
}

override_resource {
  target = aws_ecr_repository.this
  values = {
    repository_url = "111111111111.dkr.ecr.us-east-1.amazonaws.com/techchallenge-auth-staging"
  }
}

variables {
  environment = "staging"
  image_tag   = "v7"
}

run "nome_que_o_kong_invoca" {
  command = plan

  assert {
    condition     = aws_lambda_function.this.function_name == "techchallenge-auth-staging"
    error_message = "O Kong só tem permissão de invocar techchallenge-auth-<env>."
  }

  assert {
    condition     = aws_ecr_repository.this.name == "techchallenge-auth-staging"
    error_message = "Repositório da imagem fora da convenção de nome."
  }
}

run "role_de_execucao_e_a_labrole" {
  command = plan

  assert {
    condition     = aws_lambda_function.this.role == "arn:aws:iam::111111111111:role/LabRole"
    error_message = "No AWS Academy a função precisa rodar com a LabRole existente."
  }

  assert {
    condition     = data.aws_iam_role.execution.name == "LabRole"
    error_message = "A role padrão precisa ser a LabRole."
  }
}

run "contrato_dos_paths_do_ssm" {
  command = plan

  assert {
    condition = aws_lambda_function.this.environment[0].variables == tomap({
      APP_ENV             = "staging"
      JWT_SECRET_SSM_PATH = "/techchallenge/staging/auth/jwt-secret"
      DB_SSM_PREFIX       = "/techchallenge/staging/db"
    })
    error_message = "As variáveis precisam ser exatamente os paths publicados pela infra Kubernetes e pelo banco, sem valor de segredo."
  }
}

run "imagem_pela_tag_da_versao" {
  # apply contra o provider mockado: a URL do repositório e o id do SG só
  # existem depois do apply, e nada é criado de verdade.
  command = apply

  assert {
    condition     = aws_lambda_function.this.image_uri == "111111111111.dkr.ecr.us-east-1.amazonaws.com/techchallenge-auth-staging:v7"
    error_message = "A função precisa apontar para a tag publicada pelo deploy."
  }

  assert {
    condition     = aws_lambda_function.this.package_type == "Image"
    error_message = "A função é publicada como imagem de container."
  }
}

run "rede_com_sg_do_banco" {
  # apply contra o provider mockado: a URL do repositório e o id do SG só
  # existem depois do apply, e nada é criado de verdade.
  command = apply

  assert {
    condition     = contains(aws_lambda_function.this.vpc_config[0].security_group_ids, "sg-0c1i3n7e0000000aa")
    error_message = "Sem o SG de cliente publicado pelo banco, a função não alcança o Postgres."
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.https.from_port == 443 && aws_vpc_security_group_egress_rule.https.to_port == 443
    error_message = "A saída da função é só HTTPS para o SSM; o Postgres sai pelo SG de cliente."
  }
}

run "timeout_abaixo_do_kong" {
  command = plan

  assert {
    condition     = aws_lambda_function.this.timeout < 10
    error_message = "O timeout precisa ficar abaixo dos 10 s do plugin aws-lambda do Kong."
  }
}

run "nomes_de_producao" {
  command = plan

  variables {
    environment = "prod"
  }

  assert {
    condition     = aws_lambda_function.this.function_name == "techchallenge-auth-prod"
    error_message = "Produção precisa do próprio nome de função."
  }

  assert {
    condition     = aws_lambda_function.this.environment[0].variables["JWT_SECRET_SSM_PATH"] == "/techchallenge/prod/auth/jwt-secret"
    error_message = "Produção não pode ler o segredo de staging."
  }
}

run "recusa_homolog" {
  command = plan

  variables {
    environment = "homolog"
  }

  expect_failures = [var.environment]
}

run "recusa_tag_latest" {
  command = plan

  variables {
    image_tag = "latest"
  }

  expect_failures = [var.image_tag]
}

run "recusa_timeout_acima_do_kong" {
  command = plan

  variables {
    timeout_seconds = 10
  }

  expect_failures = [var.timeout_seconds]
}

run "sem_rede_o_check_explica_a_ordem_de_apply" {
  command = plan

  override_data {
    target = data.aws_subnets.private
    values = {
      ids = []
    }
  }

  expect_failures = [check.rede_provisionada_pela_infra_kubernetes]
}
