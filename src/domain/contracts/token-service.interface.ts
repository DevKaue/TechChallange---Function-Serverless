/**
 * Claims do token de CLIENTE.
 *
 * O que NÃO entra, e por quê: `email`, `name`, `phone`, `status` e o próprio CPF
 * ficam de fora porque JWT é base64, não cifrado — o token viaja em header e cai
 * no log de acesso do API Gateway com facilidade. CPF no payload é CPF no log,
 * justamente onde o desafio pede log estruturado.
 *
 * `role` também fica de fora, e isso FECHA um critério de aceite de graça: o
 * `RolesGuard` da aplicação principal faz `if (!role || ...) throw Forbidden`,
 * então um token de cliente dá 403 automático em rota administrativa, sem uma
 * linha de código nova do outro lado.
 *
 * `type` é claim separado, e `sub` é o uuid puro — não `customer:<uuid>`. O
 * `ValidateAuthenticatedUserUseCase` da aplicação passa `payload.sub` DIRETO
 * para `findById`: com prefixo, todo token de cliente dispararia uma consulta
 * inútil na tabela `users` antes de qualquer decisão. O roteamento precisa
 * acontecer em memória, antes de qualquer I/O.
 */
export interface CustomerAccessTokenPayload {
  sub: string;
  type: 'customer';
  iss: string;
  jti: string;
}

export interface SignedToken {
  accessToken: string;
  /** Sempre 3600. Número, nunca a string '1h' — ver o contrato congelado. */
  expiresIn: 3600;
}

export interface TokenService {
  sign(payload: CustomerAccessTokenPayload): SignedToken;
}
