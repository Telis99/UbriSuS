// Demonstração do ambulatório de saúde mental (CAPS): locais, programas, oficinas, agenda, inscrições,
// acolhimento, atendimentos (com ações no RAAS psicossocial) e PTS.
import { registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { faturarAtendimento, sincronizarAgendaPrograma } from './servico.js';

registrarCargaDemonstracao('Saúde mental (CAPS)', async (c, ctx) => {
  // Perfis clínicos com acesso aos dados sigilosos e aos medicamentos da saúde mental.
  await c.query(
    `update seg.perfil set permissoes = permissoes || '["caps_prontuario:consultar","caps_medicamentos:consultar"]'::jsonb
      where nome = 'Médico' and jsonb_typeof(permissoes) = 'array' and not permissoes ? 'caps_prontuario:consultar'`,
  );
  const caps = ctx.unidades.caps;
  if (!caps || (await c.query(`select 1 from caps.programa limit 1`)).rowCount) return;
  const psi = ctx.profissionais.psicologa ?? ctx.profissionais.medico;
  const proc = async (codigo: string) => (await c.query(`select id from cad.procedimento where codigo = $1`, [codigo])).rows[0]?.id ?? null;
  const local = async (nome: string, tipo: string, capacidade: number) =>
    (await c.query(`insert into caps.local (nome, unidade_id, tipo, capacidade, ativo) values ($1,$2,$3,$4,true) returning id`, [nome, caps, tipo, capacidade])).rows[0].id;
  const salaGrupos = await local('SALA DE OFICINAS', 'OFICINA', 15);
  await local('CONSULTÓRIO 1', 'SALA', 3);
  const praca = await local('PRAÇA DA MATRIZ (TERRITÓRIO)', 'TERRITORIO', 30);
  const programa = async (nome: string, publico: string, vagas: number) =>
    (await c.query(`insert into caps.programa (nome, unidade_id, publico, responsavel_id, vigencia_inicio, vagas, ativo, descricao) values ($1,$2,$3,$4,date_trunc('year', current_date),$5,true,$6) returning id`, [nome, caps, publico, psi, vagas, `Programa ${nome.toLowerCase()} do CAPS.`])).rows[0].id;
  const pAdulto = await programa('CUIDADO INTENSIVO ADULTO', 'ADULTO', 40);
  const pAd = await programa('ÁLCOOL E OUTRAS DROGAS', 'AD', 30);
  const oficina = async (nome: string, prog: number, loc: number, codigo: string, vagas: number) =>
    (await c.query(`insert into caps.oficina (nome, programa_id, local_id, profissional_id, procedimento_id, vagas, ativo) values ($1,$2,$3,$4,$5,$6,true) returning id`, [nome, prog, loc, psi, await proc(codigo), vagas])).rows[0].id;
  const oArte = await oficina('OFICINA DE ARTETERAPIA', pAdulto, salaGrupos, '0301080283', 12);
  const oCaminhada = await oficina('GRUPO DE CAMINHADA', pAdulto, praca, '0301080275', 20);
  const oRd = await oficina('GRUPO DE REDUÇÃO DE DANOS', pAd, salaGrupos, '0301080216', 12);
  await c.query(
    `insert into caps.agenda (programa_id, oficina_id, local_id, profissional_id, dias_semana, hora_inicio, hora_fim, vagas, vigencia_inicio, ativo)
     values ($1,$2,$3,$4,array['2','4'],'14:00','16:00',12,current_date,true), ($5,$6,$7,$4,array['3'],'09:00','10:30',12,current_date,true)`,
    [pAdulto, oArte, salaGrupos, psi, pAd, oRd, salaGrupos],
  );
  for (const { id } of (await c.query(`select id from caps.agenda order by id`)).rows) await sincronizarAgendaPrograma(c, id, undefined);
  const pacientes = (await c.query(`select id from cad.pessoa where id = any($1) and situacao = 'ATIVO' and data_nascimento between current_date - interval '65 years' and current_date - interval '18 years' order by id desc limit 5`, [ctx.pacientes])).rows.map((r) => r.id);
  const cids = (await c.query(`select id, codigo from cad.cid where codigo in ('F200','F322','F102')`)).rows;
  const cid = (k: string) => cids.find((x) => x.codigo === k)?.id ?? null;
  for (const [i, p] of pacientes.entries()) {
    const prog = i === 4 ? pAd : pAdulto;
    const of = i === 4 ? oRd : i % 2 ? oCaminhada : oArte;
    await c.query(`insert into caps.inscricao (paciente_id, programa_id, oficina_id, profissional_referencia_id, data_inicio, situacao) values ($1,$2,$3,$4,current_date - 40,'ATIVO')`, [p, prog, of, psi]);
    const acol = (
      await c.query(
        `insert into caps.acolhimento (paciente_id, unidade_id, data_hora, profissional_id, demanda, motivo, escuta, risco, cid_id, conduta, programa_id)
         values ($1,$2,now() - interval '40 days',$3,$4,'Sofrimento psíquico intenso','Escuta qualificada registrada no acolhimento.',$5,$6,'INSERCAO',$7) returning id`,
        [p, caps, psi, i % 2 ? 'ATENCAO_BASICA' : 'ESPONTANEA', i === 0 ? 'ALTO' : 'MODERADO', cid(i === 4 ? 'F102' : i % 2 ? 'F322' : 'F200'), prog],
      )
    ).rows[0];
    await faturarAtendimento(c, { id: acol.id, paciente_id: p, unidade_id: caps, data: new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10), profissional_id: psi, procedimento_id: await proc('0301080232') }, `caps_acolhimento:${acol.id}`);
    await c.query(
      `insert into caps.pts (paciente_id, unidade_id, profissional_referencia_id, data_elaboracao, data_reavaliacao, situacao, objetivos, intervencoes, frequencia, cid_id)
       values ($1,$2,$3,current_date - 35,current_date + 55,'VIGENTE','Reduzir crises; retomar vínculos familiares e atividades ocupacionais.','Atendimento individual semanal, oficina terapêutica, apoio familiar mensal.','SEMI',$4)`,
      [p, caps, psi, cid(i === 4 ? 'F102' : 'F200')],
    );
    for (let s = 0; s < 3; s++) {
      const tipo = s === 1 ? 'GRUPO' : 'INDIVIDUAL';
      const data = new Date(Date.now() - (2 + s * 6 + i) * 86_400_000).toISOString().slice(0, 10);
      const procId = tipo === 'GRUPO' ? (await c.query(`select procedimento_id from caps.oficina where id = $1`, [of])).rows[0].procedimento_id : await proc('0301080208');
      const at = (
        await c.query(
          `insert into caps.atendimento (paciente_id, unidade_id, data, hora, profissional_id, tipo, programa_id, oficina_id, local_realizacao, procedimento_id, evolucao)
           values ($1,$2,$3,'14:00',$4,$5,$6,$7,'C',$8,'Usuário participativo, humor estável.') returning *`,
          [p, caps, data, psi, tipo, prog, tipo === 'GRUPO' ? of : null, procId],
        )
      ).rows[0];
      const f = await faturarAtendimento(c, { ...at, data }, `caps_atendimento:${at.id}`);
      await c.query(`update caps.atendimento set raas_acao_id = $2, producao_id = $3 where id = $1`, [at.id, f.raasAcaoId ?? null, f.producaoId ?? null]);
    }
  }
});
