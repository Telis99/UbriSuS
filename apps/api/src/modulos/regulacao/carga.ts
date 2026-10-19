// Demonstração da regulação: solicitações reguladas classificadas por cores na fila da especialidade.
import { registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { incluirListaEspera } from '../agendamento/servico.js';

registrarCargaDemonstracao('Regulação', async (c, ctx) => {
  if ((await c.query(`select 1 from reg.historico limit 1`)).rowCount) return;
  const esp = (await c.query(`select id from cad.especialidade where nome = 'GINECOLOGIA E OBSTETRÍCIA'`)).rows[0];
  const usg = (await c.query(`select id from cad.procedimento where codigo = '0205020186'`)).rows[0];
  const mulheres = (await c.query(`select id from cad.pessoa where id = any($1) and sexo = 'F' and situacao = 'ATIVO' and data_nascimento < current_date - interval '16 years' order by id limit 6`, [ctx.pacientes])).rows;
  const prioridades = ['AZUL', 'VERMELHO', 'AMARELO', 'AZUL', 'AMARELO', 'AZUL'];
  for (const [i, p] of mulheres.entries()) {
    const id = await incluirListaEspera(c, {
      pacienteId: p.id,
      especialidadeId: i < 4 ? esp?.id : null,
      procedimentoId: i >= 4 ? usg?.id : null,
      unidadeSolicitanteId: ctx.unidades.usf,
      profissionalSolicitanteId: ctx.profissionais.medico,
      origem: i % 2 ? 'ENCAMINHAMENTO' : 'SOLICITACAO',
      justificativa: ['Dor pélvica crônica a esclarecer.', 'Sangramento uterino anormal com anemia.', 'Gestação de alto risco - hipertensão.', 'Rotina ginecológica alterada.', 'Massa anexial em exame físico.', 'Investigação de infertilidade.'][i],
      regulada: true,
      prioridade: prioridades[i],
    });
    await c.query(`update age.lista_espera set incluido_em = now() - ($2 || ' days')::interval where id = $1`, [id, String(20 - i * 3)]);
    await c.query(`insert into reg.historico (paciente_id, lista_espera_id, acao, para, justificativa) values ($1,$2,'INCLUSAO',$3,'Solicitação de demonstração')`, [p.id, id, prioridades[i]]);
  }
});
