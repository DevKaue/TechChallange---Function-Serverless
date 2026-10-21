import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../domain/contracts/id-generator.interface';

/** Adapter do gerador criptograficamente seguro do runtime Node.js. */
export class RandomUuidGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
