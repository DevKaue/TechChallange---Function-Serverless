variable "project" {
  description = "Prefixo de nome e valor da tag Project. É por esta tag que a VPC é descoberta."
  type        = string
  default     = "techchallenge"
}

variable "environment" {
  description = "Ambiente lógico: staging (branch develop) ou prod (branch main)."
  type        = string

  validation {
    # Os mesmos nomes do Kong e da infra Kubernetes (ADR-005 do repositório da
    # aplicação). O nome da função sai daqui, e o Kong só pode invocar
    # techchallenge-auth-staging e techchallenge-auth-prod.
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment precisa ser staging ou prod."
  }
}

variable "image_tag" {
  description = "Tag da imagem no ECR. O workflow de deploy publica a imagem antes do apply da função."
  type        = string

  validation {
    # `latest` some com o próximo push e torna impossível saber o que está no ar.
    condition     = length(var.image_tag) > 0 && var.image_tag != "latest"
    error_message = "image_tag precisa identificar um artefato: use a tag da versão, nunca latest."
  }
}

variable "execution_role_name" {
  description = "Role de execução EXISTENTE. No AWS Academy a conta não permite criar roles, então é a LabRole."
  type        = string
  default     = "LabRole"
}

variable "timeout_seconds" {
  description = "Timeout da função. Fica abaixo do timeout de 10 s do plugin aws-lambda do Kong."
  type        = number
  default     = 9

  validation {
    # Acima do timeout do Kong, o cliente recebe erro do gateway sem corpo
    # enquanto a função ainda roda; o contrato é o 503 com correlationId.
    condition     = var.timeout_seconds >= 5 && var.timeout_seconds < 10
    error_message = "timeout_seconds precisa ficar entre 5 e 9: abaixo do timeout de 10 s do Kong e acima do statement_timeout do banco."
  }
}

variable "memory_mb" {
  description = "Memória da função. Na Lambda, CPU é proporcional à memória."
  type        = number
  default     = 256
}

variable "log_retention_days" {
  description = "Retenção dos logs no CloudWatch."
  type        = number
  default     = 14
}
