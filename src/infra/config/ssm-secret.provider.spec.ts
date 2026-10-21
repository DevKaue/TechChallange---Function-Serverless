import { GetParameterCommand } from '@aws-sdk/client-ssm';
import { SsmSecretProvider } from './ssm-secret.provider';

class ClientStub {
  commands: GetParameterCommand[] = [];
  result: { Parameter?: { Value?: string } } = { Parameter: { Value: 'segredo' } };
  failure: Error | undefined;

  send(command: GetParameterCommand): Promise<{ Parameter?: { Value?: string } }> {
    this.commands.push(command);
    return this.failure === undefined ? Promise.resolve(this.result) : Promise.reject(this.failure);
  }
}

describe('SsmSecretProvider', () => {
  it('lê com decriptação e cacheia o valor por path', async () => {
    const client = new ClientStub();
    const provider = new SsmSecretProvider(client);

    await expect(provider.get('/app/jwt')).resolves.toBe('segredo');
    await expect(provider.get('/app/jwt')).resolves.toBe('segredo');

    expect(client.commands).toHaveLength(1);
    expect(client.commands[0]?.input).toEqual({
      Name: '/app/jwt',
      WithDecryption: true,
    });
  });

  it('deduplica leituras concorrentes do mesmo path', async () => {
    const client = new ClientStub();
    const provider = new SsmSecretProvider(client);

    await Promise.all([provider.get('/app/db/password'), provider.get('/app/db/password')]);

    expect(client.commands).toHaveLength(1);
  });

  it('não mantém falha transitória no cache', async () => {
    const client = new ClientStub();
    client.failure = new Error('timeout');
    const provider = new SsmSecretProvider(client);

    await expect(provider.get('/app/jwt')).rejects.toThrow('timeout');
    client.failure = undefined;
    await expect(provider.get('/app/jwt')).resolves.toBe('segredo');

    expect(client.commands).toHaveLength(2);
  });

  it.each([{}, { Parameter: {} }, { Parameter: { Value: '' } }])(
    'falha fechada quando o SSM não devolve valor (%p)',
    async (result) => {
      const client = new ClientStub();
      client.result = result;
      const provider = new SsmSecretProvider(client);

      await expect(provider.get('/app/jwt')).rejects.toThrow(
        'Parâmetro SSM sem valor: /app/jwt',
      );
    },
  );
});
