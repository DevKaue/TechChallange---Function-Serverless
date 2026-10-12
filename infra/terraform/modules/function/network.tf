# Rede descoberta por tag, como no repositório de banco: a VPC é da infra
# Kubernetes, uma por ambiente, todas com Project=techchallenge. O filtro por
# Environment é o que impede a função de staging de nascer na VPC de prod.
data "aws_vpc" "this" {
  filter {
    name   = "tag:Project"
    values = [var.project]
  }

  filter {
    name   = "tag:Environment"
    values = [var.environment]
  }

  filter {
    name   = "tag:ManagedBy"
    values = ["terraform"]
  }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.this.id]
  }

  # Só as privadas: a saída para o SSM é pelo NAT da VPC. Numa subnet pública a
  # ENI da Lambda não recebe IP público e o cold start morre em timeout no SSM.
  filter {
    name   = "tag:kubernetes.io/role/internal-elb"
    values = ["1"]
  }
}

# SG de cliente publicado pelo repositório de banco: quem o carrega alcança o
# Postgres na 5432, e só isso.
data "aws_ssm_parameter" "db_client_sg_id" {
  name = "${local.db_ssm_prefix}/client-sg-id"
}

resource "aws_security_group" "function" {
  name        = "${local.function_name}-egress"
  description = "Saida HTTPS da funcao de autenticacao (SSM)"
  vpc_id      = data.aws_vpc.this.id

  tags = local.tags
}

# Sem regra de egress a Lambda não sai: o sintoma é o primeiro request de cada
# container estourar o timeout lendo o SSM, com 503 de bootstrap no log.
resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.function.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "SSM pelo NAT"

  tags = local.tags
}

check "rede_provisionada_pela_infra_kubernetes" {
  assert {
    condition     = length(data.aws_subnets.private.ids) >= 2
    error_message = "Subnets privadas nao encontradas para Project=${var.project}, Environment=${var.environment}. Aplique antes a infra Kubernetes e o banco deste ambiente."
  }
}
