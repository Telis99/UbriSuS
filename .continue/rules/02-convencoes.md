---
name: Convenções do código UbriSUS
alwaysApply: true
---

- Leia `docs/desenvolvimento/CONVENCOES.md` antes de criar ou alterar módulos.
- API: `apps/api/src/modulos/<modulo>/` com `entidades.ts` (definirEntidade), `rotas.ts` (`export default async function (app)`), `relatorios.ts` (registrarRelatorio), `carga.ts`. Imports ESM com sufixo `.js`.
- Interface: `apps/web/src/telas/modulos/<Modulo>.tsx` com `registrarTela`, Mantine 7, textos em português.
- Cite os itens atendidos: `tr: ['1.2.x.y']` ou comentário `(TR 1.2.x.y)`. Para consultar um item, procure o id em `docs/requisitos/requisitos.json` ou o texto em `docs/edital/anexo-i-termo-de-referencia.txt` (use @Files ou @Codebase).
- Depois de alterar: `npm run typecheck` e `npm run requisitos:cobertura`.
- Para tarefas grandes, use o super agente no terminal: `npm run agente`.
