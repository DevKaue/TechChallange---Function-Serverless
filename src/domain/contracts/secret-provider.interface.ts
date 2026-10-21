/**
 * Leitura de segredo em runtime, por PATH.
 *
 * A função recebe apenas paths como variável de ambiente, nunca valores. O
 * motivo é estrutural: `data "aws_ssm_parameter"` grava o valor NO STATE de quem
 * lê — se o Terraform desta função resolvesse o JWT_SECRET para injetá-lo como
 * variável, o segredo passaria a existir em três states e ficaria visível em
 * `aws lambda get-function-configuration`.
 *
 * A implementação cacheia no escopo do módulo: uma chamada por container, não
 * por invocação.
 */
export interface SecretProvider {
  get(path: string): Promise<string>;
}
