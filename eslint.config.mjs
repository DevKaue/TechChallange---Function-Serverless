import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // R5 do CONTRIBUTING vira regra aplicada, não desejo. `domain/` é o núcleo:
    // não conhece framework, SDK nem driver de banco. Quando alguém importar
    // `pg` numa entidade para "resolver rápido", o lint reprova no PR em vez de
    // a violação aparecer meses depois numa refatoração.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['pg', 'pg-*'], message: 'domain/ não acessa banco. O driver vive em infra/repositories.' },
          { group: ['@aws-sdk/*', 'aws-lambda'], message: 'domain/ não conhece AWS. Adaptadores ficam em infra/.' },
          { group: ['jsonwebtoken'], message: 'domain/ define o contrato do token; a implementação fica em infra/security.' },
          { group: ['../infra/*', '../../infra/*', '../../../infra/*'], message: 'domain/ não importa de infra/ — a dependência aponta para dentro.' },
        ],
      }],
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: { '@typescript-eslint/unbound-method': 'off' },
  },
);
