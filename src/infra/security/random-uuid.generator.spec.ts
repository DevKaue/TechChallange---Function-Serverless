import { RandomUuidGenerator } from './random-uuid.generator';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RandomUuidGenerator', () => {
  it('gera UUID válido e diferente a cada chamada', () => {
    const generator = new RandomUuidGenerator();
    const first = generator.generate();
    const second = generator.generate();

    // Regex local em vez de dependência `uuid` só para validar uma string em
    // teste. Menos pacote é menos supply chain e menos cold start para zero ganho
    // em produção.
    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });
});
