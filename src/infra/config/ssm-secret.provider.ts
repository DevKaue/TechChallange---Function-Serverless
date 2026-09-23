import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { SecretProvider } from '../../domain/contracts/secret-provider.interface';

interface ParameterClient {
  send(command: GetParameterCommand): Promise<{ Parameter?: { Value?: string } }>;
}

/**
 * Provider com cache por path e deduplicação de leituras concorrentes. Assim,
 * cada container consulta um parâmetro uma vez e duas invocações simultâneas no
 * primeiro cold start não duplicam chamadas ao SSM.
 */
export class SsmSecretProvider implements SecretProvider {
  private readonly cache = new Map<string, Promise<string>>();

  constructor(private readonly client: ParameterClient = new SSMClient({})) {}

  get(path: string): Promise<string> {
    const cached = this.cache.get(path);
    if (cached !== undefined) return cached;

    const pending = this.load(path).catch((error: unknown) => {
      // Falha transitória não é cacheada para sempre no container aquecido.
      this.cache.delete(path);
      throw error;
    });
    this.cache.set(path, pending);
    return pending;
  }

  private async load(path: string): Promise<string> {
    const result = await this.client.send(
      new GetParameterCommand({ Name: path, WithDecryption: true }),
    );
    const value = result.Parameter?.Value;
    if (value === undefined || value.length === 0) {
      throw new Error(`Parâmetro SSM sem valor: ${path}`);
    }
    return value;
  }
}
