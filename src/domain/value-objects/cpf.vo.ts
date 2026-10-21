import { InvalidCpfError } from '../errors/invalid-cpf.error';

// Os DOIS únicos formatos aceitos. O desafio fala em "autenticação via CPF" e
// não define formato, então ele é fechado aqui de propósito.
//
// POR QUE VALIDAR O FORMATO ANTES DE NORMALIZAR: o validador do repositório-base
// começa por `value.replace(/\D/g, '')`, e limpar antes de conferir faz a regra
// aceitar lixo ao redor. Verificado executando o algoritmo de lá:
//
//     "CPF: 111.444.777-35"  → 11144477735 → ACEITO
//     "abc11144477735xyz"    → 11144477735 → ACEITO
//
// Os dois passariam como CPF válido. É bug de regra de negócio, não detalhe de
// implementação — e a correção correspondente na aplicação principal está
// registrada como item do card dela.
const SEM_MASCARA = /^\d{11}$/;
const COM_MASCARA = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;

// Onze dígitos iguais passam nos dois verificadores por construção matemática,
// então precisam de recusa explícita — a mesma guarda do repositório-base.
const DIGITOS_REPETIDOS = /^(\d)\1{10}$/;

/**
 * CPF válido, já normalizado para 11 dígitos.
 *
 * Só existe instância se o documento passou pelo formato e pelos dois dígitos
 * verificadores — não há como construir um CPF inválido e carregá-lo adiante.
 */
export class Cpf {
  private constructor(readonly value: string) {}

  /**
   * @throws {InvalidCpfError} formato, tipo ou dígito verificador inválidos.
   */
  static create(input: unknown): Cpf {
    // `typeof` explícito porque JSON aceita número, e aí o dano é silencioso:
    // `{"cpf": 191}` vira a string "191" e perde os zeros à esquerda do CPF
    // 00000000191, que é DV-válido. O resultado seria um 400 correto pelo motivo
    // errado — e um CPF legítimo recusado se alguém mandar sem aspas.
    if (typeof input !== 'string') {
      throw new InvalidCpfError('O campo cpf precisa ser uma string.');
    }

    const trimmed = input.trim();

    if (!SEM_MASCARA.test(trimmed) && !COM_MASCARA.test(trimmed)) {
      throw new InvalidCpfError(
        'Formato de CPF inválido. Use 11 dígitos ou 000.000.000-00.',
      );
    }

    const digits = trimmed.replace(/\D/g, '');

    if (DIGITOS_REPETIDOS.test(digits)) {
      throw new InvalidCpfError('CPF inválido.');
    }

    if (!Cpf.hasValidCheckDigits(digits)) {
      throw new InvalidCpfError('CPF inválido.');
    }

    return new Cpf(digits);
  }

  /**
   * Portado linha a linha de `isValidCpf` em
   * `src/common/infra/validators/document.validator.ts` do repositório-base.
   *
   * A fidelidade é o ponto: esta mesma regra continua rodando na aplicação
   * principal, no cadastro do cliente. Duas implementações que precisam
   * concordar divergem cedo ou tarde — e a divergência só apareceria num CPF de
   * borda, em produção, com o cliente cadastrado e o login recusado.
   */
  private static hasValidCheckDigits(digits: string): boolean {
    let sum = 0;
    let remainder: number;

    for (let i = 1; i <= 9; i++) {
      sum += parseInt(digits.substring(i - 1, i)) * (11 - i);
    }
    remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(digits.substring(9, 10))) return false;

    sum = 0;
    for (let i = 1; i <= 10; i++) {
      sum += parseInt(digits.substring(i - 1, i)) * (12 - i);
    }
    remainder = (sum * 10) % 11;
    if (remainder === 10 || remainder === 11) remainder = 0;
    if (remainder !== parseInt(digits.substring(10, 11))) return false;

    return true;
  }

  /** Máscara para exibição. Nunca usar em log: CPF não vai para log. */
  toMasked(): string {
    return `${this.value.slice(0, 3)}.${this.value.slice(3, 6)}.${this.value.slice(6, 9)}-${this.value.slice(9)}`;
  }
}
