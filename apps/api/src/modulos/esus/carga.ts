// Parâmetros, critérios de indicadores (carga inicial) e dados de demonstração do e-SUS AB.
import { registrarCarga, registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { gerarCronograma } from './servico.js';

registrarParametro(
  'esus.instalacao',
  { contraChave: 'UBRISUS', uuidInstalacao: '00000000-0000-0000-0000-000000000000', cpfOuCnpj: '46634432000155', nomeOuRazaoSocial: 'SECRETARIA MUNICIPAL DE SAUDE DE CABREUVA', fone: '', email: '', versaoSistema: 'UBRISUS 1.0', nomeBancoDados: 'PostgreSQL' },
  'Dados da instalação (remetente/originadora) nos arquivos LEDI do e-SUS AB (TR 1.2.13.1.2)',
  'ESUS',
);
registrarParametro('esus.teleconsulta', { servidor: 'https://meet.jit.si' }, 'Servidor de videoconferência das teleconsultas (Jitsi Meet ou servidor próprio) (TR 1.2.36.11)', 'ESUS');

// Critérios de indicadores da APS com exame solicitado automaticamente pela guia (TR 1.2.36.12).
registrarCarga('Critérios de indicadores de saúde (e-SUS AB)', async (c) => {
  const criterios: [string, string, string, number][] = [
    ['Pessoas com diabetes com hemoglobina glicada solicitada/realizada', 'DIABETICOS', '0202010503', 6],
    ['Pessoas com hipertensão com creatinina solicitada/realizada', 'HIPERTENSOS', '0202010317', 12],
    ['Mulheres de 25 a 64 anos com citopatológico', 'MULHERES_25_64', '0203010019', 36],
    ['Mulheres de 50 a 69 anos com mamografia de rastreamento', 'MULHERES_50_69', '0204030188', 24],
    ['Gestantes com exames de sífilis e HIV', 'GESTANTES', '0214010074,0214010082,0202031179,0202030300', 10],
  ];
  for (const [nome, publico, procs, meses] of criterios)
    await c.query(`insert into esus.indicador (nome, publico, procedimentos, periodo_meses, ativo) select $1::varchar, $2::varchar, $3::varchar, $4::int, true where not exists (select 1 from esus.indicador where nome = $1)`, [nome, publico, procs, meses]);
});

registrarCargaDemonstracao('e-SUS AB', async (c, ctx) => {
  if ((await c.query(`select 1 from esus.acao_programatica limit 1`)).rowCount) return;
  const ano = new Date().getFullYear();
  const acao = (
    await c.query(
      `insert into esus.acao_programatica (nome, descricao, data_inicio, data_fim, max_inscricoes, concede_beneficio, tipo_beneficio, ativo)
       values ('PROGRAMA LEITE DAS CRIANÇAS', 'Suplementação de leite para crianças de 6 a 36 meses em vulnerabilidade, com acompanhamento do crescimento.', $1, $2, 100, true, 'LEITE', true) returning id`,
      [`${ano}-01-01`, `${ano}-12-31`],
    )
  ).rows[0].id;
  await c.query(`insert into esus.acao_local (acao_id, unidade_id, observacao) values ($1, $2, 'Terças-feiras, 8h às 11h'), ($1, $3, 'Quintas-feiras, 13h às 16h')`, [acao, ctx.unidades.usf, ctx.unidades.usf2]);
  const antropo = (await c.query(`select id from cad.procedimento where codigo = '0101040024'`)).rows[0]?.id ?? null;
  await c.query(`insert into esus.acao_procedimento (acao_id, tipo, procedimento_id, descricao, quantidade, periodicidade_dias) values ($1,'PROCEDIMENTO',$2,'Avaliação antropométrica',1,30)`, [acao, antropo]);
  const leite = (await c.query(`insert into esus.acao_procedimento (acao_id, tipo, descricao, quantidade, periodicidade_dias) values ($1,'SUBSIDIO','Leite integral em pó 800 g',4,30) returning id`, [acao])).rows[0].id;
  await c.query(`insert into esus.acao_evento (acao_id, nome, periodicidade_dias, prazo_dias, obrigatorio) values ($1,'Pesagem e medição',30,7,true), ($1,'Consulta de puericultura',90,15,true), ($1,'Grupo de orientação nutricional',60,10,false)`, [acao]);
  const criancas = (await c.query(`select id from cad.pessoa where id = any($1) and situacao = 'ATIVO' and data_nascimento > current_date - interval '4 years' order by id limit 4`, [ctx.pacientes])).rows;
  for (const [i, p] of criancas.entries()) {
    const ins = (
      await c.query(`insert into esus.inscricao (acao_id, paciente_id, unidade_id, data_inicial, recebe_beneficio, situacao) values ($1,$2,$3,current_date - $4::int,true,$5) returning id`, [
        acao,
        p.id,
        ctx.unidades.usf,
        60 - i * 10,
        i === 3 ? 'DESISTENTE' : 'ATIVO',
      ])
    ).rows[0].id;
    await gerarCronograma(c, ins);
    if (i < 3) {
      await c.query(`insert into esus.inscricao_beneficio (inscricao_id, data, acao_procedimento_id, descricao, quantidade, proxima_concessao, profissional_id) values ($1, current_date - 20, $2, 'Leite integral em pó 800 g', 4, current_date + 10, $3)`, [ins, leite, ctx.profissionais.enfermeira]);
      await c.query(`update esus.inscricao_evento set situacao = 'REALIZADO', data_realizacao = data_prevista where inscricao_id = $1 and data_prevista < current_date - 15`, [ins]);
    }
  }
  // Reuniões de equipe do mês.
  const profs = [ctx.profissionais.medico, ctx.profissionais.enfermeira, ctx.profissionais.acs, ctx.profissionais.dentista].filter(Boolean);
  await c.query(
    `insert into esus.reuniao (unidade_id, equipe, data, hora_inicio, hora_fim, local, tipo, pauta, participantes, ata, situacao) values
       ($1, 'ESF 1', current_date - 7, '14:00', '16:00', 'Sala de reuniões', '01', 'Planejamento das visitas e busca ativa de gestantes', $2, 'Definidas as prioridades de busca ativa da microárea 02.', 'REALIZADA'),
       ($1, 'ESF 1', current_date + 7, '14:00', '16:00', 'Sala de reuniões', '08', 'Discussão de casos com a equipe multiprofissional', $2, null, 'AGENDADA'),
       ($1, 'ESF 1', current_date + 14, '08:00', '09:00', 'Auditório', '09', 'Educação permanente: hipertensão e diabetes', $2, null, 'AGENDADA')`,
    [ctx.unidades.usf, JSON.stringify(profs)],
  );
  const adultos = (await c.query(`select id from cad.pessoa where id = any($1) and situacao = 'ATIVO' and data_nascimento < current_date - interval '18 years' order by id limit 6`, [ctx.pacientes])).rows.map((r) => r.id);
  await c.query(
    `insert into esus.atividade_coletiva (unidade_id, profissional_id, data, turno, tipo_atividade, tema, publico, local, participantes, participantes_ids, avaliacoes_alteradas)
     values ($1,$2,current_date - 3,'2','04','Alimentação saudável e controle da pressão arterial',array['12','10'],'Salão da igreja do bairro',$3,$4,1)`,
    [ctx.unidades.usf, ctx.profissionais.enfermeira, adultos.length, JSON.stringify(adultos)],
  );
  if (criancas[0])
    await c.query(
      `insert into esus.marcador_consumo (paciente_id, unidade_id, profissional_id, data, local_atendimento, faixa, refeicoes_tv, refeicoes, consumo_ontem) values ($1,$2,$3,current_date - 2,'1','2MAIS','2',array['1','3','5'],array['FEIJAO','FRUTAS','VERDURAS','BEBIDAS_ADOCADAS'])`,
      [criancas[0].id, ctx.unidades.usf, ctx.profissionais.enfermeira],
    );
  const sad = (await c.query(`select id from cad.unidade where nome ilike 'MELHOR EM CASA%' limit 1`)).rows[0]?.id ?? ctx.unidades.usf;
  if (adultos[0]) {
    await c.query(
      `insert into esus.elegibilidade (paciente_id, unidade_id, profissional_id, data, turno, procedencia, condicoes, conclusao, modalidade, cuidador, cuidador_relacao) values ($1,$2,$3,current_date - 10,'1','3',array['ACAMADO','ULCERA'],'ELEGIVEL','AD2','FILHA CUIDADORA','2')`,
      [adultos[0], sad, ctx.profissionais.medico],
    );
    await c.query(
      `insert into esus.atendimento_domiciliar (paciente_id, unidade_id, profissional_id, data, turno, modalidade, tipo_atendimento, condicoes, conduta, observacao) values ($1,$2,$3,current_date - 5,'1','AD2','7',array['ACAMADO','ULCERA'],'1','Curativo realizado; orientação ao cuidador.')`,
      [adultos[0], sad, ctx.profissionais.enfermeira],
    );
  }
  if (adultos[1] && ctx.profissionais.medico)
    await c.query(
      `insert into esus.teleconsulta (paciente_id, profissional_id, unidade_id, data_hora, modalidade, sala, token, situacao) values ($1,$2,$3,now() + interval '1 day','TELECONSULTA','ubrisus-demo-' || md5(random()::text), md5(random()::text) || md5(random()::text),'AGENDADA')`,
      [adultos[1], ctx.profissionais.medico, ctx.unidades.usf],
    );
});
