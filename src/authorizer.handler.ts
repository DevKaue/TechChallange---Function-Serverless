import { composeAuthorizerHandler } from './infra/composition/auth-composition';
import { SsmSecretProvider } from './infra/config/ssm-secret.provider';
import { authorizerBootstrapFailure, createLazyHandler } from './infra/http/lazy-handler';
import { ConsoleJsonLogger } from './infra/logging/logger';

// Composition root do Lambda Authorizer das rotas protegidas. Mesma imagem da
// função de autenticação, outro CMD: `authorizer.handler.handler`.
//
// Não abre conexão com o banco: o Authorizer valida assinatura, emissor, tipo e
// expiração. Consultar o status do cliente a cada requisição protegida
// multiplicaria conexões no RDS pelo tráfego da aplicação inteira; o limite de
// 1 h do token é o que delimita a janela de um cliente bloqueado depois de logar.

const logger = new ConsoleJsonLogger();
const secrets = new SsmSecretProvider();

export const handler = createLazyHandler(
  () => composeAuthorizerHandler({ env: process.env, secrets, logger }),
  authorizerBootstrapFailure(logger),
);
