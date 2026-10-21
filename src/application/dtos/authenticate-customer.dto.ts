export interface AuthenticateCustomerInput {
  /**
   * `unknown` é deliberado: o JSON chega sem garantia de tipo. Converter para
   * string aqui esconderia payload numérico e perderia zeros à esquerda.
   */
  cpf: unknown;
}

export interface AuthenticateCustomerOutput {
  access_token: string;
  token_type: 'Bearer';
  expires_in: 3600;
}
