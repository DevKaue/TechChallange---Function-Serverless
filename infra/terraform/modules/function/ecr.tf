resource "aws_ecr_repository" "this" {
  name = local.function_name

  # Tag imutável: a tag da versão é o que permite voltar para a anterior.
  # Com tag mutável, um push repetido trocaria em silêncio o que está no ar.
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name

  # Guarda as 10 últimas: espaço para rollback sem acumular custo de storage.
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Mantem as 10 imagens mais recentes"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
