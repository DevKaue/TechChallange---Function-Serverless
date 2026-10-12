# Criado antes da função para a retenção valer desde a primeira invocação. Se a
# Lambda criar o grupo sozinha, ele nasce com retenção infinita.
resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_lambda_function" "this" {
  function_name = local.function_name
  description   = "Autenticacao de cliente por CPF, invocada pelo plugin aws-lambda do Kong"
  role          = data.aws_iam_role.execution.arn

  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.this.repository_url}:${var.image_tag}"
  architectures = ["x86_64"]

  timeout     = var.timeout_seconds
  memory_size = var.memory_mb

  vpc_config {
    subnet_ids = data.aws_subnets.private.ids
    security_group_ids = [
      aws_security_group.function.id,
      nonsensitive(data.aws_ssm_parameter.db_client_sg_id.value),
    ]
  }

  # Só paths do SSM, nunca valores: segredo em variável de ambiente aparece no
  # console da Lambda e no state para quem tiver lambda:GetFunctionConfiguration.
  environment {
    variables = {
      APP_ENV             = var.environment
      JWT_SECRET_SSM_PATH = local.jwt_secret_ssm_path
      DB_SSM_PREFIX       = local.db_ssm_prefix
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.this.name
  }

  tags = local.tags
}
