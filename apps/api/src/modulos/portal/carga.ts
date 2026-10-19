// Parâmetros do aplicativo do cidadão e dados fictícios de demonstração: conta liberada para o
// responsável de uma família com dependentes, solicitação aguardando liberação, histórico clínico,
// teleconsulta e coordenadas das unidades para o mapa.
import { randomInt } from 'node:crypto';
import type pg from 'pg';
import { registrarParametro } from '../../db/carga/configuracao.js';
import { registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { gerarHashSenha } from '../../seguranca/senha.js';
import { agendar, gerarHorarios, incluirListaEspera } from '../agendamento/servico.js';
import { lancarProducao } from '../faturamento/producao.js';
import { usuarioAplicativo } from './servico.js';

export const SENHA_DEMO_CIDADAO = 'Cidadao@2026';

registrarParametro('portal.agendamento_modo', 'AGENDA', 'Modo de agendamento pelo aplicativo: AGENDA, DIRETO ou SOLICITACAO', 'APP');
registrarParametro('portal.antecedencia_agendamento', { quantidade: 24, unidade: 'HORAS' }, 'Antecedência mínima para marcar consultas pelo aplicativo', 'APP');
registrarParametro('portal.antecedencia_cancelamento', { quantidade: 24, unidade: 'HORAS' }, 'Antecedência mínima para cancelar ou transferir consultas pelo aplicativo', 'APP');
registrarParametro('portal.vaga_para_lista_espera', true, 'Oferecer automaticamente a vaga cancelada ao primeiro da lista de espera', 'APP');
registrarParametro('portal.aviso_meios', { app: true, sms: true, email: true }, 'Meios de aviso da confirmação do agendamento', 'APP');
registrarParametro('portal.max_tentativas', 3, 'Tentativas de login inválidas antes do bloqueio da conta do cidadão', 'APP');
registrarParametro('portal.sessao_inatividade_min', 30, 'Minutos de inatividade para encerrar a sessão do cidadão', 'APP');
registrarParametro('portal.exibir_quantidade_estoque', false, 'Exibir a quantidade em estoque dos medicamentos no aplicativo', 'APP');
registrarParametro('portal.exibir_evolucao_clinica', false, 'Exibir a evolução clínica (SOAP) no histórico de atendimentos do aplicativo', 'APP');
registrarParametro('portal.video_url_base', 'https://meet.jit.si/', 'Endereço base das salas de videochamada do teleatendimento', 'APP');

// Coordenadas aproximadas das unidades da rede (Cabreúva/SP) para o mapa do aplicativo.
const COORDENADAS: [string, number, number][] = [
  ['USF HERMÓGENES', -23.3071, -47.1335],
  ['USF IRMÃO BRUNO', -23.2602, -47.0833],
  ['USF EMÍLIA', -23.2872, -47.1117],
  ['USF DARIO', -23.3251, -47.1573],
  ['USF CONRADO', -23.2735, -47.0618],
  ['UBS ANNITA', -23.2668, -47.0791],
  ['POLICLÍNICA MILENA', -23.3089, -47.1301],
  ['POLICLÍNICA WILSON', -23.2611, -47.0850],
  ['CEO', -23.3060, -47.1318],
  ['UPA', -23.2958, -47.1201],
  ['CEM', -23.3082, -47.1290],
  ['CER', -23.3095, -47.1350],
  ['CAPS', -23.3049, -47.1311],
  ['CRICA', -23.3101, -47.1322],
  ['ALMOXARIFADO', -23.3066, -47.1277],
];

export async function demonstracaoPortal(c: pg.PoolClient, ctx: { pacientes: number[]; profissionais: Record<string, number>; unidades: Record<string, number> }) {
  for (const [prefixo, lat, lng] of COORDENADAS) {
    await c.query(`update cad.unidade set latitude = $2, longitude = $3 where nome like $1 || '%' and latitude is null`, [prefixo, lat, lng]);
  }
  if ((await c.query(`select 1 from portal.conta limit 1`)).rowCount) return;
  const { usf, ceo } = ctx.unidades;
  const { medico, enfermeira, dentista } = ctx.profissionais;

  // Titular: responsável familiar da primeira família do território (ou primeiro adulto da demonstração).
  const titular = (
    await c.query(
      `select p.* from cad.pessoa p left join cad.familia f on f.responsavel_id = p.id
        where p.id = any($1) and p.situacao = 'ATIVO' and p.cns is not null and extract(year from age(p.data_nascimento)) >= 18
        order by (f.codigo = 'MA01-001') desc nulls last, (f.id is not null) desc, p.id limit 1`,
      [ctx.pacientes],
    )
  ).rows[0];
  if (!titular) return;
  await c.query(`update cad.pessoa set email = coalesce(email, 'cidadao.demo@exemplo.gov.br'), notificar_app = true where id = $1`, [titular.id]);
  const hash = await gerarHashSenha(SENHA_DEMO_CIDADAO);
  await c.query(
    `insert into portal.conta (pessoa_id, cns, cpf, nome_informado, nascimento_informado, mae_informada, email, celular, unidade_id, situacao, solicitado_em, liberado_em,
                               senha_hash, senha_alterada_em, tentativas_invalidas, termos_versao, termos_aceitos_em)
     values ($1,$2,$3,$4,$5,$6,'cidadao.demo@exemplo.gov.br',$7,$8,'ATIVA',now() - interval '20 days',now() - interval '19 days',$9,now(),0,'2026.1',now() - interval '20 days')`,
    [titular.id, titular.cns, titular.cpf, titular.nome, titular.data_nascimento, titular.nome_mae, titular.celular, titular.unidade_referencia_id ?? usf, hash],
  );
  await c.query(`insert into sis.aceite (tipo, versao, cidadao_id, ip, agente) values ('termos_app','2026.1',$1,'127.0.0.1','demonstração')`, [titular.id]);

  // Solicitação de acesso aguardando liberação da unidade.
  const solicitante = (
    await c.query(
      `select * from cad.pessoa where id = any($1) and id <> $2 and cns is not null and extract(year from age(data_nascimento)) >= 18 and situacao = 'ATIVO' order by id desc limit 1`,
      [ctx.pacientes, titular.id],
    )
  ).rows[0];
  if (solicitante) {
    await c.query(
      `insert into portal.conta (pessoa_id, cns, cpf, nome_informado, nascimento_informado, mae_informada, celular, unidade_id, situacao, solicitado_em, senha_hash, termos_versao, termos_aceitos_em, tentativas_invalidas)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'SOLICITADA',now() - interval '2 hours',$9,'2026.1',now(),0)`,
      [solicitante.id, solicitante.cns, solicitante.cpf, solicitante.nome, solicitante.data_nascimento, solicitante.nome_mae, solicitante.celular, solicitante.unidade_referencia_id ?? usf, hash],
    );
  }

  // Histórico clínico: consulta médica com triagem, prescrição e exames; atendimento odontológico com odontograma; atendimento de enfermagem.
  const esp = async (sql: string) => (await c.query(sql)).rows[0]?.id ?? null;
  const espMedica = await esp(`select id from cad.especialidade where nome = 'MEDICINA DE FAMÍLIA'`);
  const espOdonto = await esp(`select id from cad.especialidade where tipo = 'ODONTOLOGICA' order by id limit 1`);
  const espEnf = await esp(`select id from cad.especialidade where tipo = 'ENFERMAGEM' order by id limit 1`);
  const cid = async (codigo: string) => (await c.query(`select id from cad.cid where codigo = $1`, [codigo])).rows[0]?.id ?? null;
  const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  const at = (
    await c.query(
      `insert into amb.atendimento (paciente_id, unidade_id, entrada_em, triagem_em, inicio_em, fim_em, situacao, especialidade_id, profissional_id, profissional_triagem_id,
                                    classificacao_risco, subjetivo, avaliacao, plano, cid_id, desfecho, tipo_unidade, tipo_atendimento_sia)
       values ($1,$2,$3,$3,$3,$3,'FINALIZADO',$4,$5,$6,'VERDE','Cefaleia ocasional, sem outras queixas.','Hipertensão arterial sistêmica em acompanhamento.','Manter losartana, retorno em 90 dias.',$7,'ALTA','AMBULATORIO','01') returning id`,
      [titular.id, usf, dias(12), espMedica, medico, enfermeira, await cid('I10')],
    )
  ).rows[0].id;
  await c.query(
    `insert into amb.sinais_vitais (paciente_id, atendimento_id, data_hora, profissional_id, peso, altura, imc, cintura, abdomen, quadril, pa_sistolica, pa_diastolica,
                                    temperatura, frequencia_cardiaca, frequencia_respiratoria, saturacao, glicemia, glicemia_momento)
     values ($1,$2,$3,$4,72.4,164,26.92,88,92,101,138,88,36.6,78,16,98,104,'JEJUM')`,
    [titular.id, at, dias(12), enfermeira],
  );
  await lancarProducao(c, { data: dias(12).slice(0, 10), unidadeId: usf, profissionalId: medico, pacienteId: titular.id, procedimentoCodigo: '0301010064', origem: 'ATENDIMENTO', referencia: `atendimento:${at}` });
  const pr = (await c.query(`insert into amb.prescricao (numero, paciente_id, atendimento_id, profissional_id, unidade_id, data, validade, situacao, orientacoes) values ($1,$2,$3,$4,$5,$6::date,$6::date + 180,'DISPENSADA','Reduzir o sal da alimentação e caminhar 30 minutos por dia.') returning id`, [`APP${at}`, titular.id, at, medico, usf, dias(12).slice(0, 10)])).rows[0].id;
  const prod = async (nome: string) => (await c.query(`select id from far.produto where nome = $1`, [nome])).rows[0]?.id ?? null;
  await c.query(`insert into amb.prescricao_item (prescricao_id, produto_id, descricao, quantidade, posologia, via, uso_continuo, duracao_dias, quantidade_dispensada) values ($1,$2,'Losartana potássica 50 mg',60,'1 comprimido de 12 em 12 horas','ORAL',true,null,60)`, [pr, await prod('LOSARTANA POTÁSSICA')]);
  await c.query(`insert into amb.prescricao_item (prescricao_id, produto_id, descricao, quantidade, posologia, via, uso_continuo, duracao_dias, quantidade_dispensada) values ($1,$2,'Paracetamol 500 mg',10,'1 comprimido de 6 em 6 horas se dor','ORAL',false,5,10)`, [pr, await prod('PARACETAMOL')]);
  const sx = (await c.query(`insert into amb.solicitacao_exame (numero, paciente_id, atendimento_id, profissional_id, unidade_id, data, situacao, dados_clinicos) values ($1,$2,$3,$4,$5,$6,'REALIZADO','Controle de HAS') returning id`, [`EXA${at}`, titular.id, at, medico, usf, dias(12).slice(0, 10)])).rows[0].id;
  const proc = async (codigo: string) => (await c.query(`select id from cad.procedimento where codigo = $1`, [codigo])).rows[0]?.id ?? null;
  const hemograma = await proc('0202020380');
  const glicose = await proc('0202010473');
  const colesterol = await proc('0202010295');
  if (glicose) await c.query(`update cad.procedimento set preparo = coalesce(preparo, 'Jejum de 8 horas. Trazer documento com foto e o pedido médico. Coleta das 7h às 9h.') where id = $1`, [glicose]);
  if (hemograma) {
    await c.query(
      `insert into amb.solicitacao_exame_item (solicitacao_id, procedimento_id, material, situacao, resultado_texto, resultado_liberado_em) values ($1,$2,'Sangue','REALIZADO',$3,$4)`,
      [sx, hemograma, 'Hemácias: 4,6 milhões/mm³ (VR 4,0-5,4)\nHemoglobina: 13,8 g/dL (VR 12,0-16,0)\nHematócrito: 41% (VR 36-46)\nLeucócitos: 6.900/mm³ (VR 4.000-10.000)\nPlaquetas: 245.000/mm³ (VR 150.000-450.000)\nConclusão: hemograma dentro dos valores de referência.', dias(8)],
    );
  }
  if (colesterol) await c.query(`insert into amb.solicitacao_exame_item (solicitacao_id, procedimento_id, material, situacao, resultado_texto, resultado_liberado_em) values ($1,$2,'Sangue','REALIZADO','Colesterol total: 212 mg/dL (desejável < 190 mg/dL).',$3)`, [sx, colesterol, dias(8)]);
  if (glicose) {
    const sx2 = (await c.query(`insert into amb.solicitacao_exame (numero, paciente_id, atendimento_id, profissional_id, unidade_id, data, situacao) values ($1,$2,$3,$4,$5,$6,'AGENDADO') returning id`, [`EXB${at}`, titular.id, at, medico, usf, dias(12).slice(0, 10)])).rows[0].id;
    await c.query(`insert into amb.solicitacao_exame_item (solicitacao_id, procedimento_id, material, situacao) values ($1,$2,'Sangue','AGENDADO')`, [sx2, glicose]);
  }

  if (dentista && espOdonto) {
    const odonto = { '16': { situacao: 'CARIADO', faces: ['O'] }, '26': { situacao: 'RESTAURADO', faces: ['O', 'M'] }, '36': { situacao: 'AUSENTE' }, '46': { situacao: 'RESTAURADO', faces: ['O'] } };
    const ao = (
      await c.query(
        `insert into amb.atendimento (paciente_id, unidade_id, entrada_em, inicio_em, fim_em, situacao, especialidade_id, profissional_id, cid_id, desfecho, tipo_unidade, odontograma)
         values ($1,$2,$3,$3,$3,'FINALIZADO',$4,$5,$6,'CUIDADO_CONTINUADO','ODONTOLOGIA',$7) returning id`,
        [titular.id, ceo ?? usf, dias(30), espOdonto, dentista, await cid('K021'), JSON.stringify(odonto)],
      )
    ).rows[0].id;
    await lancarProducao(c, { data: dias(30).slice(0, 10), unidadeId: ceo ?? usf, profissionalId: dentista, pacienteId: titular.id, procedimentoCodigo: '0101020066', origem: 'ODONTOLOGIA', referencia: `atendimento:${ao}` });
  }
  if (enfermeira) {
    const ae = (
      await c.query(
        `insert into amb.atendimento (paciente_id, unidade_id, entrada_em, triagem_em, inicio_em, fim_em, situacao, especialidade_id, profissional_id, profissional_triagem_id, cid_id, desfecho, tipo_unidade)
         values ($1,$2,$3,$3,$3,$3,'FINALIZADO',$4,$5,$5,$6,'ALTA','AMBULATORIO') returning id`,
        [titular.id, usf, dias(45), espEnf, enfermeira, await cid('Z000')],
      )
    ).rows[0].id;
    await c.query(`insert into amb.sinais_vitais (paciente_id, atendimento_id, data_hora, profissional_id, peso, altura, pa_sistolica, pa_diastolica, temperatura, frequencia_cardiaca, saturacao, glicemia) values ($1,$2,$3,$4,73.1,164,142,90,36.4,80,97,110)`, [titular.id, ae, dias(45), enfermeira]);
    await lancarProducao(c, { data: dias(45).slice(0, 10), unidadeId: usf, profissionalId: enfermeira, pacienteId: titular.id, procedimentoCodigo: '0301010030', origem: 'ATENDIMENTO', referencia: `atendimento:${ae}` });
  }

  // Lista de espera em especialidade e teleconsulta com sala virtual.
  const especializada = await esp(`select id from cad.especialidade where atencao = 'ESPECIALIZADA' and ativo order by nome limit 1`);
  if (especializada) {
    for (const p of ctx.pacientes.slice(0, 4)) await incluirListaEspera(c, { pacienteId: p, especialidadeId: especializada, unidadeSolicitanteId: usf, origem: 'ENCAMINHAMENTO', justificativa: 'Encaminhamento da atenção básica (demonstração)' });
    await incluirListaEspera(c, { pacienteId: titular.id, especialidadeId: especializada, unidadeSolicitanteId: usf, profissionalSolicitanteId: medico, origem: 'ENCAMINHAMENTO', justificativa: 'Avaliação especializada (demonstração)' });
  }
  if (medico && espMedica) {
    const agenda = (
      await c.query(
        `insert into age.agenda (nome, tipo, unidade_id, profissional_id, especialidade_id, vigencia_inicio, dias_semana, intervalo_semanas, hora_inicio, hora_fim, vagas,
                                 disponivel_web, web_modo, antecedencia_agendar_horas, antecedencia_cancelar_horas, cor, ativo)
         values ('TELECONSULTA - MEDICINA DE FAMÍLIA','TELECONSULTA',$1,$2,$3,current_date,array['1','2','3','4','5'],1,'14:00','16:00',4,true,'DIRETO',2,2,'#0ca678',true) returning id`,
        [usf, medico, espMedica],
      )
    ).rows[0].id;
    await gerarHorarios(c, agenda);
    const h = (await c.query(`select id from age.horario where agenda_id = $1 and situacao = 'LIVRE' and data > current_date order by data, hora limit 1`, [agenda])).rows[0];
    if (h) await agendar(c, { horarioId: h.id, pacienteId: titular.id, tipo: 'TELECONSULTA', origem: 'APLICATIVO', confirmarAvisos: true }, usuarioAplicativo(usf));
  }
  await c.query(
    `insert into sis.mensagem (paciente_id, meio, destinatario, assunto, texto, evento, situacao) values ($1,'push',$2,'Bem-vindo ao aplicativo da saúde',$3,'boas_vindas','enviada')`,
    [titular.id, `paciente:${titular.id}`, 'Seu acesso foi liberado. Pelo aplicativo você agenda consultas, acompanha exames, vacinas e medicamentos da sua família.'],
  );
  void randomInt;
}

registrarCargaDemonstracao('Aplicativo do cidadão', demonstracaoPortal);
