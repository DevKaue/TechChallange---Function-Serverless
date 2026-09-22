# Como contribuir

Este documento é a regra aplicável do repositório. Ele substitui "seguir o padrão do
repositório-base": o que vale é o que está aqui.

> **Nota sobre o repositório-base.** Estes repositórios espelham
> [DevKaue/TechChallange](https://github.com/DevKaue/TechChallange) (Fases 1 e 2) em
> estrutura, arquitetura e documentação. Espelham o **alvo** daquele repositório, não a
> prática dele: dos 196 commits do base, 112 (57%) conformam Conventional Commits. Aqui a
> convenção nasce automatizada no CI.

## R1 · Commits

Conventional Commits, com **tipo em inglês e descrição em pt-BR**: imperativo, minúscula,
sem ponto final, assunto de no máximo 72 caracteres.

```
feat: valida o formato do CPF antes de normalizar
fix: trata relation inexistente como 503 em vez de 500
docs: registra o ADR de descoberta de rede por tag
```

Tipos permitidos: `feat` `fix` `docs` `chore` `refactor` `style` `test` `perf` `build`
`ci` `revert`.

**Proibidos** (aparecem no histórico do base e não se repetem aqui): `refact:`,
`refator:`, `config:`, `merge:`.

O CI valida **os commits e o título do PR**. O título importa porque, com squash merge,
é ele que vira a mensagem final no `develop`.

## R2 · Branches

`<tipo>/<descricao-em-kebab-case>`, com os tipos `feat` `fix` `chore` `refactor` `docs`
`hotfix`. Branch de trabalho nasce de `develop`; `hotfix/*` nasce de `main`.

`feature/` **não** é usado — o base mistura `feat/` e `feature/`, e aqui é só `feat/`.

## R3 · Merge — é o que impede divergência permanente

| PR | Método |
|---|---|
| `feat/* → develop` | **Squash**, mensagem = título do PR |
| `develop → homolog` | **Merge commit** |
| `homolog → main` | **Merge commit** |
| `hotfix/* → main` | **Merge commit** + dois back-merges no mesmo dia (`main → homolog`, `homolog → develop`) |

Squash numa promoção faz as branches divergirem para sempre, e toda promoção seguinte vira
conflito ou diff espúrio. Hotfix sem os dois back-merges reintroduz o bug em silêncio na
próxima promoção.

## R6 · Comentários

Comentário explica o **porquê** e a **armadilha concreta e observável**: sintoma → causa →
o que fazer. Comentário que descreve o que a linha faz é **removido** no review.

Comentário de trade-off aceito precisa dizer **o que o tornaria inaceitável**:

```hcl
# 0 = sem backup automático. NÃO é escolha de engenharia: contas no Free Tier recusam
# retenção > 0 com FreeTierRestrictionError. Num plano pago, volte para 7.
```

## R7 · `.trivyignore`

Uma entrada = um parágrafo de justificativa + critério de revalidação ("revisar quando o
banco tiver dado real"). Entrada **sem justificativa** reprova o PR. Entrada **sem achado
correspondente** também: ignore órfão é ruído e enfraquece o arquivo.

## R8 · Versões

- `required_version = "~> 1.10"` (o `use_lockfile` do backend S3 exige 1.10+)
- Providers com `~>`; **módulos com versão exata** — o `.terraform.lock.hcl` trava
  provider, **não** módulo
- `.terraform.lock.hcl` versionado
- **Toda action de terceiro pinada por SHA.** O base usa `aquasecurity/trivy-action@master`;
  um check novo do Trivy publicado entre o desenvolvimento e a entrega deixa o CI vermelho
  sozinho, sem ninguém ter mudado nada

## R10 · Documentação

- **ADR** registra decisão permanente, depois de tomada → `docs/ADRs/ADR-NNN-<kebab>.md`
- **RFC** propõe e pede comentário, antes de decidir → `docs/RFCs/RFC-NNN-<kebab>.md`
- O campo `Status` do ADR é mecanismo, não enfeite: `Proposto` enquanto a decisão depende
  de algo externo, `Aceito` quando fecha
- Diagramas em `docs/diagrams/NN-<nome>.mmd`, **e o README carrega o bloco ```mermaid
  inline**. O GitHub **não** renderiza `.mmd` linkado, e quem avalia não clona o
  repositório para ver desenho
- Todo bullet do desafio que não se aplica a este repositório aparece como
  **"não se aplica, porque X"** — omitir em silêncio lê-se como item faltante

## R12 · O que não se copia do repositório-base

- **`continue-on-error: true` no lint.** Lá existe para carregar um baseline datado de 136
  erros e 460 avisos. Aqui o repositório nasce limpo, então copiar isso seria regressão
  deliberada no primeiro commit. Lint é **bloqueante**, com `--max-warnings=0` — mantendo o
  acerto do base de rodar **sem `--fix`** no CI, porque `--fix` num runner descartável
  corrige em silêncio e joga o problema fora junto com o container
- **Threshold de cobertura por pasta** (o base tem 12 blocos, de 50% a 80%): aquilo é mapa
  de dívida, não padrão. Aqui, um threshold global
- Configuração de Jest dentro do `package.json` → arquivo próprio
- Linha comentada de histórico (`#terraform_version: 1.9.8`)
- `environment = "prod"` como default e key de state `prod/terraform.tfstate` — num
  repositório com dois ambientes, é armadilha de apply no lugar errado
- Entradas pessoais do `.gitignore` e README com identidade de Fase 1

## Fluxo, do começo ao fim

1. `git switch develop && git pull`
2. `git switch -c feat/descricao-curta`
3. Commits conformes ao R1; teste ao lado do código
4. PR para `develop`, preenchendo o template — inclusive o impacto de custo
5. Checks verdes; **squash** no merge
6. Promoção `develop → homolog` (merge commit) dispara o deploy de homologação
7. Promoção `homolog → main` (merge commit) para no gate de produção e espera aprovação

Nada entra direto em `main`, `homolog` ou `develop`. O único commit direto da história
deste repositório é o inicial, e ele está documentado em
[`docs/ADRs/ADR-000-bootstrap-do-repositorio.md`](docs/ADRs/ADR-000-bootstrap-do-repositorio.md).

---

## R4 · Nome de arquivo (específico deste repositório)

`kebab-case` com sufixo semântico, como no repositório-base:

`*.usecase.ts` · `*.entity.ts` · `*.vo.ts` · `*.enum.ts` · `*-repository.interface.ts` ·
`*.repository.ts` · `*.service.ts` · `*.provider.ts` · `*.adapter.ts` · `*.map.ts` ·
`*.error.ts` · `*.dto.ts` · `*.handler.ts`

**Teste unitário `*.spec.ts` fica ao lado do código.** Integração, contrato e e2e ficam em
`test/`.

Isso é aplicado pela estrutura, não por vigilância: o Jest usa `rootDir: src` e
`testRegex: .*\.spec\.ts$`, então spec fora de `src` simplesmente não roda na suíte
unitária.

## R5 · Camadas — três, não quatro

- `domain/` não importa de `infra/`
- `application/` não importa framework nem SDK
- `infra/` concentra os adapters

**Nenhum import de `aws-lambda`, `@aws-sdk/*` ou `pg` fora de `src/infra/`** — exceto
`src/handler.ts` e `src/authorizer.handler.ts`, que são adaptadores por definição. A regra
é aplicada por `no-restricted-imports` no ESLint.

O base tem `presentation/` porque lá convivem controllers, guards, strategies e decorators
do NestJS ao lado dos adapters de `infra/`. Numa função de uma rota, "presentation" seria
`handler.ts` mais o adapter — uma pasta de duas peças. A ausência dela é **decisão
registrada em ADR**, não simplificação silenciosa.
