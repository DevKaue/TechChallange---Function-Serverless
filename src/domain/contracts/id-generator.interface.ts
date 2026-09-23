/**
 * Gera identificadores opacos para claims como `jti`.
 *
 * O caso de uso depende deste contrato, e não de `crypto.randomUUID()`
 * diretamente, por uma razão testável: duas autenticações no mesmo segundo
 * precisam produzir tokens diferentes. Com o gerador injetado, o teste prova o
 * valor entregue ao assinador sem mockar módulo nativo nem relógio global.
 */
export interface IdGenerator {
  generate(): string;
}
