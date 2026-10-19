// Dados fictícios de demonstração do TFD: laudos em todas as etapas do fluxo, com trâmites,
// complementos, acompanhantes e ajudas de custo.
import type pg from 'pg';
import { registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { garantirLocaisDestino } from '../transporte/carga.js';

const um = async (c: pg.PoolClient, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0]?.id as number | undefined;

// [CID, procedimento, especialidade, local de tratamento, etapa, dias atrás, diagnóstico, histórico, razões]
type Laudo = [string, string, string | null, string | null, string, number, string, string, string];
const LAUDOS: Laudo[] = [
  ['C509', '0301010072', null, 'INSTITUTO DO CÂNCER DO ESTADO DE SÃO PAULO (ICESP)', 'TRATAMENTO', 60, 'Nódulo mamário à direita BI-RADS 5.', 'Paciente com nódulo palpável há 4 meses, biópsia confirmou carcinoma ductal invasivo.', 'O município não dispõe de serviço de oncologia (quimioterapia e radioterapia).'],
  ['N180', '0301010072', null, 'HOSPITAL DAS CLÍNICAS DA FMUSP', 'TRATAMENTO', 45, 'Doença renal crônica estágio 5.', 'Hipertenso e diabético de longa data com piora progressiva da função renal.', 'Ausência de serviço de nefrologia e de avaliação para transplante renal no município.'],
  ['C61', '0205020046', 'UROLOGIA', 'HOSPITAL DE AMOR (BARRETOS)', 'TRATAMENTO', 30, 'Neoplasia de próstata em investigação.', 'PSA elevado (18 ng/mL) e toque retal alterado.', 'Necessidade de serviço de referência em oncologia de alta complexidade.'],
  ['H251', '0301010072', 'OFTALMOLOGIA', 'HOSPITAL DE CLÍNICAS DA UNICAMP', 'AUTORIZADO', 25, 'Catarata senil bilateral.', 'Baixa acuidade visual progressiva há 2 anos.', 'Cirurgia oftalmológica não ofertada pela rede municipal.'],
  ['G35', '0301010072', null, null, 'APROVADO', 15, 'Esclerose múltipla remitente-recorrente.', 'Surtos de paresia em membro inferior esquerdo.', 'Necessidade de acompanhamento em centro de referência em neurologia.'],
  ['M170', '0301010072', null, null, 'ABERTO', 5, 'Gonartrose bilateral grau IV.', 'Dor e limitação funcional importante, falha do tratamento conservador.', 'Indicação de artroplastia, não realizada no município.'],
  ['I251', '0301010072', null, null, 'ABERTO', 2, 'Doença arterial coronariana.', 'Angina estável classe III, teste ergométrico positivo.', 'Necessidade de cateterismo cardíaco em serviço de alta complexidade.'],
  ['C189', '0204030188', null, null, 'GLOSADO', 20, 'Neoplasia de cólon.', 'Alteração do hábito intestinal e anemia.', 'Necessidade de cirurgia oncológica.'],
  ['N18', '0301010072', null, null, 'NEGADO', 40, 'Insuficiência renal crônica.', 'Encaminhado para avaliação nefrológica.', 'Sem serviço de nefrologia no município.'],
  ['C50', '0301010072', null, null, 'ARQUIVADO', 90, 'Nódulo mamário.', 'Investigação de nódulo mamário.', 'Sem mastologia no município.'],
];

registrarCargaDemonstracao('Tratamento fora do domicílio (laudos e trâmites)', async (c, ctx) => {
  if ((await c.query(`select 1 from tfd.laudo limit 1`)).rowCount) return;
  await garantirLocaisDestino(c);
  const operador = (await c.query(`select id from seg.operador where login = 'gestor'`)).rows[0]?.id ?? (await c.query(`select id from seg.operador where login = 'admin'`)).rows[0]?.id ?? null;
  const unidade = ctx.unidades.usf ?? ctx.unidades.cem;
  const medico = ctx.profissionais.medico ?? Object.values(ctx.profissionais)[0];
  const tramite = (laudo: number, quando: Date, acao: string, descricao: string | null, situacao: string | null) =>
    c.query(`insert into tfd.laudo_tramite (laudo_id, data_hora, acao, descricao, situacao, operador_id) values ($1,$2,$3,$4,$5,$6)`, [laudo, quando, acao, descricao, situacao, operador]);
  let seq = 0;
  for (const [cid, proc, esp, local, etapa, dias, diag, hist, razoes] of LAUDOS) {
    const abertura = new Date(Date.now() - dias * 86_400_000);
    const data = abertura.toISOString().slice(0, 10);
    const paciente = ctx.pacientes[(seq * 5 + 11) % ctx.pacientes.length];
    const acompanhante = seq % 3 === 0;
    const situacao = etapa === 'TRATAMENTO' ? 'AUTORIZADO' : etapa;
    const localId = local ? await um(c, `select id from tra.local_destino where nome = $1`, [local]) : null;
    const tratamento = etapa === 'TRATAMENTO' ? 'AUTORIZADO' : 'PENDENTE';
    const dAprov = new Date(abertura.getTime() + 2 * 86_400_000);
    const dAut = new Date(abertura.getTime() + 4 * 86_400_000);
    const id = (
      await c.query(
        `insert into tfd.laudo (numero, data_abertura, unidade_solicitante_id, profissional_solicitante_id, paciente_id, carater, especialidade_id, cid_id, procedimento_id,
            diagnostico_inicial, diagnostico_provavel, historico_doenca, exame_fisico, exames_complementares, tratamentos_realizados, razoes_impossibilidade,
            tipo_transporte, necessita_acompanhante, justificativa_acompanhante, situacao, situacao_tratamento, local_tratamento_id, motivo_tratamento, agendamento_data_hora,
            motivo_decisao, aprovado_em, aprovado_por, autorizado_em, autorizado_por, tratamento_autorizado_em, tratamento_autorizado_por)
         values ($1,$2,$3,$4,$5,'ELETIVO',(select id from cad.especialidade where nome = $6),(select id from cad.cid where codigo = $7),(select id from cad.procedimento where codigo = $8),
            $9,$9,$10,'Bom estado geral, lúcido e orientado.','Exames anexos ao processo.','Tratamento clínico na atenção básica.',$11,
            'VEICULO_MUNICIPAL',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) returning id`,
        [
          `${data.slice(0, 4)}/${String(++seq).padStart(5, '0')}`,
          data,
          unidade,
          medico,
          paciente,
          esp,
          cid,
          proc,
          diag,
          hist,
          razoes,
          acompanhante,
          acompanhante ? 'Paciente idoso(a) com limitação de locomoção e necessidade de auxílio.' : null,
          situacao,
          tratamento,
          etapa === 'TRATAMENTO' ? localId : null,
          etapa === 'TRATAMENTO' ? 'Serviço de referência pactuado na PPI.' : null,
          etapa === 'TRATAMENTO' ? new Date(Date.now() + (7 + seq) * 86_400_000) : null,
          ['GLOSADO', 'NEGADO', 'ARQUIVADO'].includes(etapa) ? { GLOSADO: 'Ausência de exames complementares obrigatórios.', NEGADO: 'Tratamento disponível na rede regional sem necessidade de TFD.', ARQUIVADO: 'Paciente mudou de município.' }[etapa] : null,
          ['APROVADO', 'AUTORIZADO', 'TRATAMENTO', 'NEGADO'].includes(etapa) ? dAprov : null,
          ['APROVADO', 'AUTORIZADO', 'TRATAMENTO', 'NEGADO'].includes(etapa) ? operador : null,
          ['AUTORIZADO', 'TRATAMENTO'].includes(etapa) ? dAut : null,
          ['AUTORIZADO', 'TRATAMENTO'].includes(etapa) ? operador : null,
          etapa === 'TRATAMENTO' ? dAut : null,
          etapa === 'TRATAMENTO' ? operador : null,
        ],
      )
    ).rows[0].id;
    await tramite(id, abertura, 'Laudo incluído', `Laudo aberto pela unidade solicitante.`, 'ABERTO');
    if (acompanhante) await c.query(`insert into tfd.laudo_acompanhante (laudo_id, nome, parentesco) values ($1, 'MARIA APARECIDA DOS SANTOS', 'FILHA')`, [id]);
    if (['APROVADO', 'AUTORIZADO', 'TRATAMENTO', 'NEGADO'].includes(etapa)) await tramite(id, dAprov, 'Laudo aprovado', null, 'APROVADO');
    if (['AUTORIZADO', 'TRATAMENTO'].includes(etapa)) await tramite(id, dAut, 'Laudo autorizado (pedido de TFD liberado para impressão)', null, 'AUTORIZADO');
    if (etapa === 'TRATAMENTO') {
      await tramite(id, new Date(dAut.getTime() + 3_600_000), 'Tratamento autorizado', `Local: ${local}. Motivo: Serviço de referência pactuado na PPI.`, 'TRATAMENTO AUTORIZADO');
      await c.query(`insert into tfd.ajuda_custo (laudo_id, data, tipo, beneficiario, quantidade, valor_unitario, valor, situacao) values ($1,$2,'ALIMENTACAO','PACIENTE',2,25,50,'PAGO')`, [id, data]);
      // Transporte agendado para o local de tratamento autorizado (integração TR 1.2.35.17).
      const viagem = (
        await c.query(
          `select v.id, v.data_saida::text data, v.hora_saida, v.motivo_id, v.local_embarque_id from tra.viagem v join tra.local_destino ld on ld.id = $1
            where v.situacao = 'ABERTA' and v.municipio_destino_id = ld.municipio_id and v.data_saida > current_date
              and not exists (select 1 from tra.viagem_passageiro vp where vp.viagem_id = v.id and vp.paciente_id = $2) order by v.data_saida limit 1`,
          [localId, paciente],
        )
      ).rows[0];
      if (viagem) {
        const vp = (
          await c.query(
            `insert into tra.viagem_passageiro (viagem_id, paciente_id, municipio_destino_id, local_destino_id, local_destino, motivo_id, local_embarque_id, hora_saida, tipo_viagem, ocupa_vaga, tfd_laudo_id, situacao, agendado_por)
             select $1, $2, ld.municipio_id, ld.id, ld.nome, $3, $4, $5, 'IDA_VOLTA', true, $6, 'AGENDADO', $7 from tra.local_destino ld where ld.id = $8 returning id`,
            [viagem.id, paciente, viagem.motivo_id, viagem.local_embarque_id, viagem.hora_saida, id, operador, localId],
          )
        ).rows[0].id;
        await c.query(`update tra.viagem_passageiro set protocolo = $2 where id = $1`, [vp, `TR${viagem.data.slice(2, 4)}${String(vp).padStart(6, '0')}`]);
        await tramite(id, new Date(dAut.getTime() + 7_200_000), 'Transporte agendado', `Viagem de ${viagem.data.split('-').reverse().join('/')} - protocolo TR${viagem.data.slice(2, 4)}${String(vp).padStart(6, '0')}.`, null);
      }
    }
    if (etapa === 'GLOSADO') await tramite(id, new Date(abertura.getTime() + 86_400_000), 'Laudo glosado', 'Ausência de exames complementares obrigatórios.', 'GLOSADO');
    if (etapa === 'NEGADO') await tramite(id, new Date(dAprov.getTime() + 86_400_000), 'Laudo negado', 'Tratamento disponível na rede regional sem necessidade de TFD.', 'NEGADO');
    if (etapa === 'ARQUIVADO') await tramite(id, new Date(abertura.getTime() + 5 * 86_400_000), 'Laudo arquivado', 'Paciente mudou de município.', 'ARQUIVADO');
    if (seq === 1) {
      await c.query(`insert into tfd.laudo_complemento (laudo_id, data_hora, texto, operador_id) values ($1,$2,$3,$4)`, [id, new Date(abertura.getTime() + 86_400_000), 'Anexado resultado de biópsia e imuno-histoquímica.', operador]);
      await tramite(id, new Date(abertura.getTime() + 86_400_000), 'Complemento incluído', 'Anexado resultado de biópsia e imuno-histoquímica.', null);
    }
  }
});
