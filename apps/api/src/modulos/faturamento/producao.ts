// Lançamento automático da produção ambulatorial a partir dos atendimentos, sem
// redigitação, com validação das regras da tabela SIGTAP (TR 1.2.13.1.35, 1.2.32.19).
import type pg from 'pg';
import { consultarUm } from '../../db/pool.js';

export interface LancamentoProducao {
  data: string | Date;
  unidadeId: number;
  profissionalId?: number | null;
  procedimentoId?: number;
  procedimentoCodigo?: string;
  pacienteId?: number | null;
  quantidade?: number;
  cidCodigo?: string | null;
  carater?: string;
  origem: string;
  referencia?: string;
}

export interface ResultadoValidacao {
  valido: boolean;
  criticas: string[];
}

function idadeMeses(nascimento: string, data: Date) {
  const n = new Date(nascimento + 'T00:00:00');
  return (data.getFullYear() - n.getFullYear()) * 12 + (data.getMonth() - n.getMonth()) - (data.getDate() < n.getDate() ? 1 : 0);
}

/** Valida o procedimento para o paciente e o profissional conforme o SIGTAP. */
export async function validarProcedimento(
  c: pg.PoolClient | pg.Pool,
  procedimento: any,
  paciente: { sexo?: string; data_nascimento?: string } | null,
  cboCodigo: string | null,
  data: Date,
): Promise<ResultadoValidacao> {
  const criticas: string[] = [];
  if (!procedimento.ativo) criticas.push('Procedimento inativo na tabela SIGTAP vigente.');
  if (paciente?.sexo && procedimento.sexo && ['M', 'F'].includes(procedimento.sexo) && paciente.sexo !== procedimento.sexo) {
    criticas.push(`Procedimento permitido somente para o sexo ${procedimento.sexo === 'F' ? 'feminino' : 'masculino'}.`);
  }
  if (paciente?.data_nascimento) {
    const meses = idadeMeses(paciente.data_nascimento, data);
    if (procedimento.idade_minima_meses != null && procedimento.idade_minima_meses < 9999 && meses < procedimento.idade_minima_meses)
      criticas.push(`Idade abaixo da mínima do procedimento (${Math.floor(procedimento.idade_minima_meses / 12)} anos).`);
    if (procedimento.idade_maxima_meses != null && procedimento.idade_maxima_meses < 9999 && meses > procedimento.idade_maxima_meses)
      criticas.push(`Idade acima da máxima do procedimento (${Math.floor(procedimento.idade_maxima_meses / 12)} anos).`);
  }
  if (cboCodigo) {
    const regras = await c.query(
      `select count(*)::int total, count(*) filter (where cb.codigo = $2)::int compativel
         from cad.procedimento_cbo pc join cad.cbo cb on cb.id = pc.cbo_id where pc.procedimento_id = $1`,
      [procedimento.id, cboCodigo],
    );
    const r = regras.rows[0];
    if (r.total > 0 && r.compativel === 0) criticas.push(`CBO ${cboCodigo} não habilitado para o procedimento.`);
  }
  return { valido: criticas.length === 0, criticas };
}

/** Produção de competência já fechada/enviada é apresentada na próxima competência aberta (TR 1.2.13.1.34). */
export async function competenciaDeApresentacao(c: pg.PoolClient, competencia: string) {
  const fechada = await c.query(`select 1 from fat.competencia where competencia = $1 and situacao <> 'ABERTA'`, [competencia]);
  if (!fechada.rowCount) return competencia;
  const aberta = (await c.query(`select competencia from fat.competencia where situacao = 'ABERTA' and competencia > $1 order by competencia limit 1`, [competencia])).rows[0];
  if (aberta) return aberta.competencia as string;
  let [a, m] = [Number(competencia.slice(0, 4)), Number(competencia.slice(4))];
  for (;;) {
    if (++m > 12) (m = 1), a++;
    const cand = `${a}${String(m).padStart(2, '0')}`;
    if (!(await c.query(`select 1 from fat.competencia where competencia = $1 and situacao <> 'ABERTA'`, [cand])).rowCount) return cand;
  }
}

export async function lancarProducao(c: pg.PoolClient, l: LancamentoProducao) {
  const proc = l.procedimentoId
    ? (await c.query(`select * from cad.procedimento where id = $1`, [l.procedimentoId])).rows[0]
    : (await c.query(`select * from cad.procedimento where codigo = $1`, [l.procedimentoCodigo])).rows[0];
  if (!proc) return null;
  const data = new Date(typeof l.data === 'string' ? l.data + (l.data.length === 10 ? 'T12:00:00' : '') : l.data);
  const paciente = l.pacienteId
    ? (await c.query(`select sexo, data_nascimento from cad.pessoa where id = $1`, [l.pacienteId])).rows[0]
    : null;
  const vinculo = l.profissionalId
    ? (
        await c.query(
          `select cb.codigo, v.ine from cad.vinculo v join cad.cbo cb on cb.id = v.cbo_id
            where v.profissional_id = $1 and v.ativo order by (v.unidade_id = $2) desc limit 1`,
          [l.profissionalId, l.unidadeId],
        )
      ).rows[0]
    : null;
  const cbo = vinculo?.codigo ?? null;
  const val = await validarProcedimento(c, proc, paciente, cbo, data);
  const instrumentos: string[] = proc.instrumentos ?? [];
  const individualizado = !!l.pacienteId && (instrumentos.includes('02') || !instrumentos.includes('01'));
  const competencia = await competenciaDeApresentacao(c, `${data.getFullYear()}${String(data.getMonth() + 1).padStart(2, '0')}`);
  const idade = paciente?.data_nascimento ? Math.floor(idadeMeses(paciente.data_nascimento, data) / 12) : null;
  const valor = Number(proc.valor_municipal ?? proc.valor_sa ?? 0) * (l.quantidade ?? 1);
  const r = await c.query(
    `insert into fat.producao (competencia, data, unidade_id, profissional_id, cbo_codigo, procedimento_id, quantidade, paciente_id, idade,
                               cid_codigo, carater, instrumento, origem, referencia, ine, situacao, critica, valor)
     values ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [
      competencia,
      data.toISOString().slice(0, 10),
      l.unidadeId,
      l.profissionalId ?? null,
      cbo,
      proc.id,
      l.quantidade ?? 1,
      l.pacienteId ?? null,
      idade,
      l.cidCodigo ?? null,
      l.carater ?? '01',
      individualizado ? 'BPA_I' : 'BPA_C',
      l.origem,
      l.referencia ?? null,
      vinculo?.ine ?? null,
      val.valido ? 'VALIDO' : 'CRITICA',
      val.criticas.join(' ') || null,
      valor,
    ],
  );
  return { id: r.rows[0].id, ...val };
}

/** Validação prévia (antes de gravar) para alertar o profissional na tela. */
export async function preValidarProcedimento(procedimentoId: number, pacienteId: number | null, profissionalId: number | null, unidadeId: number | null) {
  const proc = await consultarUm(`select * from cad.procedimento where id = $1`, [procedimentoId]);
  if (!proc) return { valido: false, criticas: ['Procedimento inexistente.'] };
  const paciente = pacienteId ? await consultarUm(`select sexo, data_nascimento from cad.pessoa where id = $1`, [pacienteId]) : null;
  const vinc = profissionalId
    ? await consultarUm(
        `select cb.codigo from cad.vinculo v join cad.cbo cb on cb.id = v.cbo_id where v.profissional_id = $1 and v.ativo order by (v.unidade_id = $2) desc limit 1`,
        [profissionalId, unidadeId],
      )
    : null;
  const { pool } = await import('../../db/pool.js');
  return validarProcedimento(pool, proc, paciente ?? null, vinc?.codigo ?? null, new Date());
}
