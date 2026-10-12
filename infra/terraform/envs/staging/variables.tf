variable "region" {
  # O backend em versions.tf tem a região LITERAL (backend não aceita variável).
  # Trocar aqui sem trocar lá deixa o state numa região e a função em outra.
  description = "Região da AWS. Precisa bater com a região do backend em versions.tf."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Prefixo de nome e valor da tag Project."
  type        = string
  default     = "techchallenge"
}

variable "image_tag" {
  description = "Tag da imagem publicada no ECR pelo workflow de deploy."
  type        = string
}
