import { Cpf } from './cpf.vo';
import { InvalidCpfError } from '../errors/invalid-cpf.error';

// Massa sintética. Aviso que precisa estar escrito: NÃO existe faixa de CPF
// oficialmente reservada para teste — qualquer número com dígito verificador
// válido pode, por coincidência, pertencer a alguém. A mitigação não é o número,
// é nunca associá-lo a nome, e-mail ou telefone reais. Nenhum CPF aqui pertence
// a alguém do grupo, a familiar ou a colega.
//
// Todos conferidos executando o algoritmo do repositório-base antes de virarem
// asserção: 18 números, 0 divergências.
const VALIDOS = [
  '11144477735', // cliente ativo principal — o "feliz" da demonstração
  '22233344405', // arquivado (deleted_at)
  '33322211169', // status INACTIVE
  '44455566619', // status BLOCKED
  '55566677720', // válido e nunca cadastrado
  '77788899941', // cadastrado com document_type diferente de CPF
  '88899900078', // cadastrado duas vezes: (doc, CPF) e (doc, RNE)
  '10101010133',
  '20202020266',
  '00000000191', // zeros à esquerda
  '52998224725', // já existe no seed do repositório-base
  '98765432100', // idem
];

const DV_INVALIDO = [
  '11144477734',
  '52998224724',
  '12345678900',
  '98765432101',
  '22233344400',
  '10010010016',
];

describe('Cpf', () => {
  describe('aceita', () => {
    it.each(VALIDOS)('%s sem máscara', (cpf) => {
      expect(Cpf.create(cpf).value).toBe(cpf);
    });

    it.each(VALIDOS)('%s com máscara', (cpf) => {
      const comMascara = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
      expect(Cpf.create(comMascara).value).toBe(cpf);
    });

    it('resolve com e sem máscara para o MESMO valor normalizado', () => {
      expect(Cpf.create('111.444.777-35').value).toBe(Cpf.create('11144477735').value);
    });

    it('tolera espaço nas pontas, que vem de copiar e colar', () => {
      expect(Cpf.create('  11144477735  ').value).toBe('11144477735');
    });

    it('preserva zeros à esquerda', () => {
      expect(Cpf.create('00000000191').value).toBe('00000000191');
    });
  });

  describe('recusa por dígito verificador', () => {
    it.each(DV_INVALIDO)('%s', (cpf) => {
      expect(() => Cpf.create(cpf)).toThrow(InvalidCpfError);
    });
  });

  describe('recusa dígitos repetidos', () => {
    // Passam nos dois verificadores por construção matemática — sem a guarda
    // explícita, '00000000000' seria aceito como CPF válido.
    it.each(['00000000000', '11111111111', '22222222222', '33333333333', '99999999999'])(
      '%s',
      (cpf) => {
        expect(() => Cpf.create(cpf)).toThrow(InvalidCpfError);
      },
    );
  });

  describe('recusa formato', () => {
    // O CORAÇÃO DA REGRA NOVA. Estes dois normalizam para um CPF válido e seriam
    // ACEITOS pelo validador do repositório-base, que limpa antes de conferir o
    // formato. Validar o formato primeiro é o que os barra.
    it.each([
      ['lixo antes', 'CPF: 111.444.777-35'],
      ['lixo em volta', 'abc11144477735xyz'],
      ['separador por espaço', '111 444 777 35'],
      ['separador misto', '111-444-777.35'],
      ['máscara incompleta', '111.444.77735'],
      ['ponto no lugar do traço', '111.444.777.35'],
    ])('%s: %s', (_titulo, entrada) => {
      expect(() => Cpf.create(entrada)).toThrow(InvalidCpfError);
    });

    it.each([
      ['dez dígitos', '1114447773'],
      ['doze dígitos', '111444777350'],
      ['três dígitos', '123'],
      ['vazio', ''],
      ['só espaços', '   '],
    ])('%s: "%s"', (_titulo, entrada) => {
      expect(() => Cpf.create(entrada)).toThrow(InvalidCpfError);
    });

    it('recusa dígitos árabe-índicos, que o \\D limpa até sobrar string vazia', () => {
      expect(() => Cpf.create('١١١٤٤٤٧٧٧٣٥')).toThrow(InvalidCpfError);
    });

    it('recusa payload grande sem estourar', () => {
      expect(() => Cpf.create('1'.repeat(1_000_000))).toThrow(InvalidCpfError);
    });
  });

  describe('recusa tipo', () => {
    // `{"cpf": 191}` é o caso perigoso: 00000000191 é DV-válido, mas como número
    // JSON vira "191" e perde os zeros à esquerda.
    it.each([
      ['número', 191],
      ['número de 11 dígitos', 11144477735],
      ['nulo', null],
      ['indefinido', undefined],
      ['array', []],
      ['objeto', {}],
      ['booleano', true],
    ])('%s', (_titulo, entrada) => {
      expect(() => Cpf.create(entrada)).toThrow(InvalidCpfError);
    });

    it('a mensagem de tipo é distinta da de formato, para o suporte', () => {
      expect(() => Cpf.create(191)).toThrow(/precisa ser uma string/);
    });
  });

  describe('mensagens', () => {
    it('nunca revelam se o CPF existiria na base', () => {
      const mensagens = [...DV_INVALIDO, 'abc', '123'].map((entrada) => {
        try {
          Cpf.create(entrada);
          return '';
        } catch (erro) {
          return (erro as Error).message;
        }
      });

      for (const mensagem of mensagens) {
        expect(mensagem).not.toMatch(/cadastr|exist|encontr|client/i);
      }
    });
  });

  describe('toMasked', () => {
    it('formata para exibição', () => {
      expect(Cpf.create('11144477735').toMasked()).toBe('111.444.777-35');
    });
  });
});
