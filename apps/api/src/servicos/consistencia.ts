// Verificação de consistência da base em segundo plano, sem interromper a operação,
// com registro do resultado da última execução (TR 1.1.1.14).
import { validarCns, validarCpf } from '../compartilhado/validacao.js';
import { consultar, pool } from '../db/pool.js';
import { id, tabelaSql } from '../meta/esquema.js';
import { listarEntidades, obterEntidade } from '../meta/registro.js';

interface Ocorrencia {
  verificacao: string;
  tabela: string;
  quantidade: number;
  exemplos?: unknown[];
}

const verificacoesExtras: { nome: string; executar: () => Promise<Ocorrencia[]> }[] = [];
export function registrarVerificacao(nome: string, executar: () => Promise<Ocorrencia[]>) {
  verificacoesExtras.push({ nome, executar });
}

export async function executarConsistencia(execucaoId: number) {
  const ocorrencias: Ocorrencia[] = [];
  try {
    for (const e of listarEntidades()) {
      for (const c of e.campos) {
        if (c.sqlCalculado) continue;
        if (c.tipo === 'ref') {
          const alvo = obterEntidade(c.ref!)!;
          const r = await consultar(
            `select t.id from ${tabelaSql(e)} t where t.${id(c.nome)} is not null
               and not exists (select 1 from ${tabelaSql(alvo)} x where x.id = t.${id(c.nome)}) limit 20`,
          );
          if (r.length) ocorrencias.push({ verificacao: `Referência inexistente em ${c.rotulo}`, tabela: e.tabela, quantidade: r.length, exemplos: r.map((x) => x.id) });
        }
        if (c.obrigatorio) {
          const r = await consultar(`select count(*)::int n from ${tabelaSql(e)} where ${id(c.nome)} is null`);
          if (r[0].n) ocorrencias.push({ verificacao: `Campo obrigatório vazio: ${c.rotulo}`, tabela: e.tabela, quantidade: r[0].n });
        }
      }
    }

    const pessoas = await consultar(`select id, cpf, cns from cad.pessoa where cpf is not null or cns is not null`);
    const cpfInv = pessoas.filter((p) => p.cpf && !validarCpf(p.cpf)).map((p) => p.id);
    const cnsInv = pessoas.filter((p) => p.cns && !validarCns(p.cns)).map((p) => p.id);
    if (cpfInv.length) ocorrencias.push({ verificacao: 'CPF inválido', tabela: 'cad.pessoa', quantidade: cpfInv.length, exemplos: cpfInv.slice(0, 20) });
    if (cnsInv.length) ocorrencias.push({ verificacao: 'CNS inválido', tabela: 'cad.pessoa', quantidade: cnsInv.length, exemplos: cnsInv.slice(0, 20) });

    const dup = await consultar(
      `select nome_busca, data_nascimento, nome_mae_busca, array_agg(id order by id) ids from cad.pessoa
        where nome_busca is not null group by 1,2,3 having count(*) > 1 limit 50`,
    );
    if (dup.length) ocorrencias.push({ verificacao: 'Possível duplicidade de paciente (nome, nascimento e mãe)', tabela: 'cad.pessoa', quantidade: dup.length, exemplos: dup.map((d) => d.ids) });

    for (const v of verificacoesExtras) ocorrencias.push(...(await v.executar()));

    await pool.query(`update sis.consistencia_execucao set concluida_em = now(), situacao = $2, resultado = $3 where id = $1`, [
      execucaoId,
      ocorrencias.length ? 'inconsistencias' : 'consistente',
      JSON.stringify(ocorrencias),
    ]);
  } catch (e) {
    await pool.query(`update sis.consistencia_execucao set concluida_em = now(), situacao = 'erro', resultado = $2 where id = $1`, [
      execucaoId,
      JSON.stringify({ erro: (e as Error).message }),
    ]);
  }
}
