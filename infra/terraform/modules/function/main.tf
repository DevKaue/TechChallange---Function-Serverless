locals {
  # Nome fixo por contrato: é o function_name do KongPlugin aws-lambda do
  # repositório da aplicação e o ARN que a infra Kubernetes autoriza a invocar.
  function_name = "${var.project}-auth-${var.environment}"

  # Os paths que a função lê em runtime. O segredo JWT é criado pela infra
  # Kubernetes; o prefixo do banco, pelo repositório de banco.
  jwt_secret_ssm_path = "/${var.project}/${var.environment}/auth/jwt-secret"
  db_ssm_prefix       = "/${var.project}/${var.environment}/db"

  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    Component   = "auth-lambda"
  }
}

# Lida, nunca criada: no AWS Academy a conta não tem iam:CreateRole. A LabRole já
# traz as permissões de que a função precisa (logs, ENI na VPC, SSM, KMS).
data "aws_iam_role" "execution" {
  name = var.execution_role_name
}
