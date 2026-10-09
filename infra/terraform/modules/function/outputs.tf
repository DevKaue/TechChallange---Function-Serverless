output "function_name" {
  description = "Nome da função. É o function_name do KongPlugin aws-lambda."
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "ARN da função."
  value       = aws_lambda_function.this.arn
}

output "ecr_repository_url" {
  description = "Repositório onde o workflow de deploy publica a imagem."
  value       = aws_ecr_repository.this.repository_url
}

output "jwt_secret_ssm_path" {
  description = "Path do segredo JWT lido pela função."
  value       = local.jwt_secret_ssm_path
}
