# Convenções de desenvolvimento

Guia para criar ou estender módulos do sistema. Todo o código, textos de tela, nomes de tabelas,
campos e mensagens são em **português do Brasil**. Siga o estilo do código existente (TypeScript
estrito, ESM com sufixo `.js` nos imports da API, comentários curtos citando os itens do TR).

## Estrutura

```
apps/api/src/modulos/<modulo>/
  entidades.ts   definições de cadastro (geram tabela, API CRUD, telas genéricas e menu)
  servico.ts     regras de negócio (funções puras que recebem o cliente da transação)
  rotas.ts       export default async function (app: FastifyInstance) { ... }
  relatorios.ts  relatórios do catálogo (importado pelo rotas.ts)
  carga.ts       carga inicial (tabelas de apoio) e dados fictícios de demonstração
apps/web/src/telas/modulos/<Modulo>.tsx   telas especializadas (registradas automaticamente)
```

Módulos novos são **descobertos automaticamente** (`modulos/descoberta.ts` e
`import.meta.glob` em `telas/index.ts`): não é preciso editar arquivos compartilhados.

## Rastreabilidade com o Termo de Referência

Cada funcionalidade cita os itens do TR atendidos — é assim que a matriz de rastreabilidade
(`npm run requisitos:cobertura`) mede a cobertura:

- entidades e relatórios: `tr: ['1.2.40.3', '1.2.40.8']`
- código: comentário `// Bloqueia rotas afetadas por feriado (TR 1.2.40.28).`
- intervalos: `(TR 1.2.40.29.1 a 1.2.40.29.9)`

Os requisitos estão em `docs/requisitos/requisitos.json` (`id`, `texto`, `moduloNome`). Use
`node scripts/cobertura-requisitos.mjs --faltantes 1.2.40` para listar os pendentes de uma seção.
**Só cite um item quando ele estiver de fato atendido.**

## Entidades (API: `meta/registro.ts`)

```ts
import { campoAtivo, campoNome, definirEntidade } from '../../meta/registro.js';

definirEntidade({
  nome: 'veiculo',                 // /api/e/veiculo e /e/veiculo na interface
  tabela: 'tra.veiculo',           // esquema criado automaticamente
  titulo: 'Veículos',
  tituloSingular: 'Veículo',
  modulo: 'TRA',                   // sigla do módulo (seguranca/entidades.ts: MODULOS_SISTEMA)
  menu: 'Transporte/Cadastros',    // caminho no menu (vazio = fora do menu)
  rotulo: ['placa', 'modelo'],     // descrição do registro em listas e campos de referência
  ordemPadrao: 'placa',
  tr: ['1.2.40.3'],
  abas: ['Identificação', 'Capacidade'],
  campos: [
    { nome: 'placa', tipo: 'texto', rotulo: 'Placa', max: 8, obrigatorio: true, unico: true, lista: true, busca: true, maiusculo: true },
    { nome: 'tipo_id', tipo: 'ref', ref: 'tipo_veiculo', rotulo: 'Tipo', lista: true },
    { nome: 'passageiros', tipo: 'inteiro', rotulo: 'Passageiros', aba: 'Capacidade' },
    { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação', opcoes: [['ATIVO', 'Ativo'], ['MANUTENCAO', 'Em manutenção']], padrao: 'ATIVO' },
    campoAtivo,
  ],
  filhos: [{ entidade: 'veiculo_documento', campo: 'veiculo_id', titulo: 'Documentos' }],
});
```

Tipos de campo: texto, texto_longo, inteiro, decimal (casas), moeda, data, data_hora, hora,
booleano, opcao, multi_opcao, ref, cpf, cnpj, cns, cep, telefone, email, cor, json, arquivo,
segredo. Colunas `id`, `criado_em/por`, `atualizado_em/por`, auditoria e chaves estrangeiras
são criadas automaticamente. Referências a cadastros existentes: `paciente` (cad.pessoa),
`unidade`, `profissional`, `procedimento`, `cid`, `cbo`, `municipio`, `bairro`, `logradouro`,
`especialidade`, `produto`, `operador`, `convenio`.

Regras ao gravar pelo cadastro genérico:

```ts
import { registrarGanchos } from '../../meta/crud.js';
registrarGanchos('viagem', {
  async antesSalvar(dados, { cliente, atual, usuario }) { /* valida/ajusta; lance ErroHttp */ },
  async depoisSalvar(registro, { cliente, atual, usuario }) { /* efeitos */ },
  async antesExcluir(registro, { cliente }) {},
});
```

Permissões: cada entidade gera `<nome>:consultar|incluir|alterar|excluir|exportar`. Rotinas
especiais: `registrarPermissao('regulacao', 'Regular solicitações', 'REG', ['executar'])`
(`meta/rotas.js`).

## Rotas

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, transacao } from '../../db/pool.js';
import { contextoDe, ErroHttp, exigirPermissao, exigirUsuario } from '../../seguranca/usuario.js';

export default async function rotasTransporte(app: FastifyInstance) {
  app.post('/api/transporte/viagens/:id/fechar', async (req) => {
    const u = exigirPermissao(req, 'viagem:alterar');           // 401/403 automáticos
    const b = z.object({ kmFinal: z.number() }).parse(req.body);  // 422 com detalhes
    return transacao(contextoDe(req, 'viagem:fechar'), async (c) => {   // auditoria com operador/IP/rotina
      const v = (await c.query(`select * from tra.viagem where id = $1 for update`, [(req.params as any).id])).rows[0];
      if (!v) throw new ErroHttp(404, 'Viagem não encontrada.');
      ...
    });
  });
}
```

- Erros de regra: `throw new ErroHttp(422, 'Mensagem para o operador.')`.
- Aviso que pede confirmação: `throw new ErroHttp(409, msg, { exigeConfirmacao: true })` e o
  cliente reenvia com `confirmarAvisos: true` (no front: `comConfirmacao`).
- Usuário: `u.id`, `u.nome`, `u.unidadeAtual`, `u.unidades`, `u.profissionalId`, `u.administrador`.
- Parâmetros: `parametro<T>(chave, padrao)` (`modulos/cadastros/alertas.js`) e, no `carga.ts`,
  `registrarParametro(chave, valor, descricao, modulo)` (`db/carga/configuracao.js`).
- Alertas exibidos no cabeçalho do paciente: `registrarProvedorAlerta(async (pessoa, ctx) => [...])`.
- Produção para faturamento (BPA): `lancarProducao(c, { data, unidadeId, profissionalId, procedimentoCodigo, pacienteId, quantidade, origem, referencia })` (`modulos/faturamento/producao.js`).
- Estoque: `baixarFefo`, `movimentar`, `loteNaUnidade`, `lotesDisponiveis` (`modulos/farmacia/servico.js`).
- Mensagens ao cidadão (SMS/e-mail/push): `enfileirarMensagem({ pacienteId, meio: 'sms'|'email'|'push', destinatario, assunto, texto, evento, referencia }, c)` (`servicos/mensageria.js`).
- Datas: use `::text` no SQL para receber `AAAA-MM-DD` como string.

## Documentos e relatórios

PDF com cabeçalho da entidade, código de validação e QR (`servicos/relatorios.js`):

```ts
const r = await emitirDocumento({ relatorio: 'transporte:ordem-trafego', titulo: 'Ordem de tráfego', filtros: { viagem: id } },
  [{ text: 'Conteúdo pdfmake' }, { table: { body: [...] } }], { orientacao: 'landscape' }, u);
return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);
```

Relatórios tabulares entram no catálogo e ganham tela de filtros, visualização com gráfico e
exportação em PDF/DOCX/XLSX/CSV/HTML/XML/TXT automaticamente:

```ts
import { PERIODO, registrarRelatorio } from '../../servicos/catalogo.js';
registrarRelatorio({
  id: 'tra-viagens-motivo', modulo: 'TRA', grupo: 'Viagens', permissao: 'viagem:exportar',
  titulo: 'Viagens por motivo', tr: ['1.2.40.29.4'],
  filtros: [...PERIODO, { nome: 'veiculoId', rotulo: 'Veículo', tipo: 'ref', ref: 'veiculo' }],
  async gerar(f) {
    const linhas = await consultar(`select ...`, [f.de, f.ate, f.veiculoId ?? null]);
    return { linhas, agrupar: ['motivo'], grafico: { tipo: 'barra', x: 'motivo', y: 'viagens' },
             colunas: [{ campo: 'motivo', titulo: 'Motivo' }, { campo: 'viagens', titulo: 'Viagens', formato: 'inteiro', total: true }] };
  },
});
```

## Carga inicial e demonstração (`carga.ts`)

```ts
import { registrarCarga, registrarCargaDemonstracao } from '../../db/carga/modulos.js';
registrarCarga('Tipos de veículos', async (c) => { /* idempotente: insert ... where not exists */ });
registrarCargaDemonstracao('Transporte', async (c, ctx) => {
  // ctx.pacientes (ids), ctx.profissionais (medico, enfermeira, ...), ctx.unidades { usf, usf2, upa, cem, ceo, almox, sms, caps }
});
```

Recriar o banco de desenvolvimento:
`psql postgres://postgres:postgres@localhost:5432/postgres -c "drop database ubrisus with (force)" -c "create database ubrisus"`
e `cd apps/api && ADMIN_SENHA_INICIAL='Admin@2026forte' npx tsx src/db/cli-seed.ts --demo`.
Usuários de demonstração: `admin` / `Admin@2026forte`; demais (`medico`, `enfermeira`,
`recepcao`, `farmaceutica`, `dentista`, `acs`, `psicologa`, `gestor`...) com senha `Saude@2026`.
A API em desenvolvimento (`npx tsx watch src/server.ts`, porta 3333) sincroniza o esquema na subida.

## Interface web (`apps/web/src/telas/modulos/<Modulo>.tsx`)

```tsx
import { registrarTela } from '../registro';
import { useTituloJanela } from '@/shell/Janelas';
import { api } from '@/api';
import { abrirPdf, comConfirmacao, fmtData, notificarErro, notificarOk, SelecaoRef, Situacao, TabelaSimples } from '@/componentes/comum';
import { BuscaPaciente, CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { registrarExtensaoFormulario } from '@/genericos/Formulario';
import { registrarMenuRelatorios } from '../Relatorios';

function TelaViagens() {
  useTituloJanela('Agendamento de viagens');
  ...
}
registrarTela({ id: 'transporte-agendamento', titulo: 'Agendar viagem', menu: 'Transporte', padrao: '/t/transporte/agendamento',
  permissao: 'viagem:incluir', modulo: 'TRA', palavras: ['viagem', 'rota'], ordem: 1, render: ({ params, query }) => <TelaViagens /> });
registrarMenuRelatorios('TRA', 'Transporte', 'viagem:exportar');
// Ações extras no formulário genérico de uma entidade:
registrarExtensaoFormulario('viagem', { acoes: (registro, recarregar) => <Button .../> });
```

Componentes: Mantine 7 (`@mantine/core`, `@mantine/dates`), ícones `@tabler/icons-react`,
gráficos `recharts`, datas `dayjs` (pt-br). `api.get/post/put/patch/delete`, `api.arquivo(url, corpo, 'abrir'|'baixar', metodo)`.
`SelecaoRef({ entidade, rotulo, valor, aoMudar, filtro })` seleciona qualquer entidade com busca.
Tela de paciente: `BuscaPaciente` (pesquisa com pré-cadastro e CADSUS) + `CabecalhoPaciente` (foto, idade, alergias, alertas).
Verificação: `npx tsc -p tsconfig.json --noEmit` em `apps/api` e em `apps/web`.
