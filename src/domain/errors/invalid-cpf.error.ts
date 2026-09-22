/**
 * CPF sintaticamente inválido: formato fora do aceito, tipo errado, dígito
 * verificador incorreto ou sequência de dígitos repetidos.
 *
 * Nunca revela se o CPF existiria na base — a validação acontece ANTES de
 * qualquer consulta, e é por isso que este erro pode ser específico sem vazar
 * nada: quem tem o algoritmo (é público) chega à mesma conclusão offline.
 */
export class InvalidCpfError extends Error {
  readonly code = 'invalid_request';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidCpfError';
  }
}
