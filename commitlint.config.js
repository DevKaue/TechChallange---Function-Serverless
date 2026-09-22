// Tipo em inglês, descrição em pt-BR. Os tipos proibidos (refact, refator,
// config, merge) aparecem no histórico do repositório-base e não se repetem aqui
// — ver R1 do CONTRIBUTING.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'chore', 'refactor', 'style', 'test', 'perf', 'build', 'ci', 'revert']],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 72],
  },
};
