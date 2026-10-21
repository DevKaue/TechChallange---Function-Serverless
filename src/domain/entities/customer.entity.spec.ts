import { Customer } from './customer.entity';
import { CustomerStatus } from '../enums/customer-status.enum';
import { CustomerNotAuthorizedError } from '../errors/customer-not-authorized.error';

const ID = '3f2a1c8e-0d4b-4f6a-9c1e-2b7d8a5f4e30';

describe('Customer', () => {
  describe('isEligible', () => {
    it('é elegível quando ativo e não arquivado', () => {
      expect(new Customer(ID, CustomerStatus.ACTIVE, null).isEligible()).toBe(true);
    });

    it('não é elegível quando arquivado, mesmo com status ACTIVE', () => {
      // O soft delete vence o status: arquivar é exclusão lógica.
      const arquivado = new Customer(ID, CustomerStatus.ACTIVE, new Date('2026-01-01'));
      expect(arquivado.isEligible()).toBe(false);
    });

    it.each([CustomerStatus.INACTIVE, CustomerStatus.BLOCKED])(
      'não é elegível com status %s',
      (status) => {
        expect(new Customer(ID, status, null).isEligible()).toBe(false);
      },
    );
  });

  describe('notAuthorizedReason', () => {
    it('arquivado tem precedência sobre o status', () => {
      const arquivado = new Customer(ID, CustomerStatus.BLOCKED, new Date('2026-01-01'));
      expect(arquivado.notAuthorizedReason()).toBe('archived');
    });

    it.each([
      [CustomerStatus.INACTIVE, 'inactive'],
      [CustomerStatus.BLOCKED, 'blocked'],
    ])('%s vira %s', (status, esperado) => {
      expect(new Customer(ID, status, null).notAuthorizedReason()).toBe(esperado);
    });

    it('falha alto se chamado num cliente elegível, em vez de inventar motivo', () => {
      const elegivel = new Customer(ID, CustomerStatus.ACTIVE, null);
      expect(() => elegivel.notAuthorizedReason()).toThrow(CustomerNotAuthorizedError);
    });
  });
});
