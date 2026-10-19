// Exportação das AIHs para o SISAIH01 (interface texto de importação: um registro de largura fixa por AIH,
// agrupado em lotes) e dos atendimentos não SUS para o CIHA01, a partir dos dados do sistema, sem
// digitação complementar (TR 1.2.13.1.15, 1.2.13.1.16, 1.2.13.1.17, 1.2.13.1.21, 1.2.13.1.23).
import type pg from 'pg';
import { ErroHttp } from '../../seguranca/usuario.js';
import { aaaammdd, digitos, montarLinha, tamanhoLayout, type CampoLayout } from './layout.js';

const MAX_PROCEDIMENTOS = 10;

/** Bloco de procedimento realizado (repetido 10 vezes no registro da AIH). */
const BLOCO_PROCEDIMENTO = (i: number): CampoLayout[] => [
  [`PRC${i}_IND_DOC_PROF`, 1, 'N', '1 = CPF, 2 = CNS do profissional executante'],
  [`PRC${i}_DOC_PROF`, 15, 'A', 'Documento do profissional'],
  [`PRC${i}_CBO`, 6, 'A', 'CBO do profissional'],
  [`PRC${i}_EQUIPE`, 1, 'N', 'Indicador de equipe'],
  [`PRC${i}_IND_DOC_EXEC`, 1, 'N', '3 = CNES, 5 = CNPJ do executante'],
  [`PRC${i}_DOC_EXEC`, 14, 'A', 'Documento do estabelecimento executante'],
  [`PRC${i}_CODIGO`, 10, 'N', 'Código SIGTAP do procedimento'],
  [`PRC${i}_QTD`, 3, 'N', 'Quantidade'],
  [`PRC${i}_CMPT`, 6, 'N', 'Competência de realização (AAAAMM)'],
  [`PRC${i}_SERVICO`, 3, 'A', 'Serviço especializado'],
  [`PRC${i}_CLASSIFICACAO`, 3, 'A', 'Classificação do serviço'],
];

/** Layout do registro de AIH na interface texto do SISAIH01 (posições sequenciais). */
export const LAYOUT_SISAIH01: CampoLayout[] = [
  ['NU_LOTE', 8, 'N', 'Número do lote'],
  ['QT_LOTE', 3, 'N', 'Quantidade de AIHs no lote'],
  ['APRES_LOTE', 6, 'N', 'Competência de apresentação (AAAAMM)'],
  ['SEQ_LOTE', 3, 'N', 'Sequencial da AIH no lote'],
  ['ORG_EMIS', 10, 'A', 'Órgão emissor da AIH'],
  ['CNES_HOSP', 7, 'N', 'CNES do hospital executante'],
  ['MUN_HOSP', 6, 'N', 'Município (IBGE) do hospital'],
  ['NU_AIH', 13, 'N', 'Número da AIH'],
  ['IDENT_AIH', 2, 'N', '01 = principal, 03 = continuação, 05 = longa permanência'],
  ['ESPEC_AIH', 2, 'N', 'Especialidade (clínica) do leito'],
  ['MOD_INTERN', 2, 'N', '02 = hospitalar, 03 = hospital-dia'],
  ['NU_AIH_PROX', 13, 'N', 'AIH posterior (continuação)'],
  ['NU_AIH_ANT', 13, 'N', 'AIH anterior'],
  ['DT_EMISSAO', 8, 'N', 'Data de emissão/autorização (AAAAMMDD)'],
  ['DT_INTERN', 8, 'N', 'Data de internação'],
  ['DT_SAIDA', 8, 'N', 'Data de saída'],
  ['PROC_SOLICITADO', 10, 'N', 'Procedimento solicitado'],
  ['ST_MUDAPROC', 1, 'N', '1 = houve mudança de procedimento, 2 = não'],
  ['PROC_REALIZADO', 10, 'N', 'Procedimento principal realizado'],
  ['CAR_INTERN', 2, 'N', 'Caráter da internação'],
  ['MOT_SAIDA', 2, 'N', 'Motivo de saída/permanência'],
  ['IDENT_MED_SOL', 1, 'N', '1 = CPF, 2 = CNS do médico solicitante'],
  ['DOC_MED_SOL', 15, 'A', 'Documento do médico solicitante'],
  ['IDENT_MED_RESP', 1, 'N', '1 = CPF, 2 = CNS do médico responsável'],
  ['DOC_MED_RESP', 15, 'A', 'Documento do médico responsável'],
  ['IDENT_DIR_CLINICO', 1, 'N', '1 = CPF, 2 = CNS do diretor clínico'],
  ['DOC_DIR_CLINICO', 15, 'A', 'Documento do diretor clínico'],
  ['IDENT_AUTORIZADOR', 1, 'N', '1 = CPF, 2 = CNS do autorizador'],
  ['DOC_AUTORIZADOR', 15, 'A', 'Documento do autorizador'],
  ['DIAG_PRINC', 4, 'A', 'CID-10 principal'],
  ['DIAG_SEC', 4, 'A', 'CID-10 secundário'],
  ['DIAG_COMPL', 4, 'A', 'CID-10 causa associada'],
  ['DIAG_OBITO', 4, 'A', 'CID-10 do óbito'],
  ['NOME_PAC', 70, 'A', 'Nome do paciente'],
  ['DT_NASC_PAC', 8, 'N', 'Data de nascimento'],
  ['SEXO_PAC', 1, 'A', 'M/F'],
  ['RACA_COR', 2, 'N', 'Raça/cor'],
  ['ETNIA', 4, 'A', 'Etnia indígena'],
  ['NOME_MAE_PAC', 70, 'A', 'Nome da mãe'],
  ['NOME_RESP_PAC', 70, 'A', 'Nome do responsável'],
  ['TP_DOC_PAC', 1, 'N', '1 = PIS/PASEP, 2 = RG, 3 = certidão, 4 = CPF, 5 = ignorado'],
  ['NU_DOC_PAC', 32, 'A', 'Número do documento'],
  ['NU_CNS', 15, 'A', 'CNS do paciente'],
  ['NACIONALIDADE', 3, 'N', 'Nacionalidade (código do país)'],
  ['COD_TIPO_LOGR', 3, 'A', 'Tipo de logradouro (DNE)'],
  ['LOGR_PAC', 50, 'A', 'Logradouro'],
  ['NU_LOGR_PAC', 7, 'A', 'Número'],
  ['COMPL_PAC', 15, 'A', 'Complemento'],
  ['BAIRRO_PAC', 30, 'A', 'Bairro'],
  ['MUN_PAC', 6, 'N', 'Município de residência (IBGE)'],
  ['UF_PAC', 2, 'A', 'UF'],
  ['CEP_PAC', 8, 'N', 'CEP'],
  ['NU_PRONTUARIO', 15, 'A', 'Número do prontuário'],
  ['NU_ENFERMARIA', 4, 'A', 'Enfermaria'],
  ['NU_LEITO', 4, 'A', 'Leito'],
  ...Array.from({ length: MAX_PROCEDIMENTOS }, (_, i) => BLOCO_PROCEDIMENTO(i + 1)).flat(),
  ['CNPJ_EMPREGADOR', 14, 'A', 'CNPJ da empresa (acidente de trabalho)'],
  ['CBO_PAC', 6, 'A', 'Ocupação do paciente'],
  ['CNAE_EMPRESA', 7, 'A', 'CNAE da empresa'],
  ['VINC_PREV', 1, 'A', 'Vínculo com a previdência'],
  ['CNPJ_SEGURADORA', 14, 'A', 'CNPJ da seguradora (acidente de trânsito)'],
  ['NU_BILHETE', 20, 'A', 'Número do bilhete do seguro'],
  ['VERSAO_SISTEMA', 10, 'A', 'Sistema gerador'],
];

export const TAMANHO_REGISTRO_SISAIH01 = tamanhoLayout(LAYOUT_SISAIH01);

const docProfissional = (cns: string | null, cpf: string | null) => (cns ? { ind: 2, doc: digitos(cns) } : cpf ? { ind: 1, doc: digitos(cpf) } : { ind: 0, doc: '' });
const cid4 = (c?: string | null) => (c ? String(c).replace('.', '').slice(0, 4) : '');

export interface ResultadoArquivo {
  conteudo: Buffer;
  nome: string;
  registros: number;
  ids: number[];
}

/** Gera o arquivo SISAIH01 com as AIHs autorizadas e com saída registrada na competência. */
export async function gerarSisaih01(c: pg.PoolClient, competencia: string, unidadeId: number | null, loteSeq: number, reexportar = false): Promise<ResultadoArquivo> {
  if (!/^\d{6}$/.test(competencia)) throw new ErroHttp(422, 'Competência inválida (AAAAMM).');
  const aihs = (
    await c.query(
      `select l.*, l.data_internacao::text di, l.data_saida::text ds, l.autorizado_em::date::text da,
              ue.cnes cnes_exec, ue.cpf_cnpj cnpj_exec, (select m.codigo_ibge from cad.municipio m where m.id = ue.municipio_id) mun_hosp,
              oe.codigo orgao, ps.codigo proc_sol, coalesce(pr.codigo, ps.codigo) proc_real,
              cp.codigo cid_p, cs.codigo cid_s, ca.codigo cid_a,
              (select pp.cns from cad.pessoa pp join cad.profissional x on x.pessoa_id = pp.id where x.id = l.profissional_solicitante_id) cns_sol,
              (select pp.cpf from cad.pessoa pp join cad.profissional x on x.pessoa_id = pp.id where x.id = l.profissional_solicitante_id) cpf_sol,
              (select pp.cns from cad.pessoa pp join cad.profissional x on x.pessoa_id = pp.id where x.id = coalesce(l.profissional_executante_id, l.profissional_solicitante_id)) cns_resp,
              (select pp.cpf from cad.pessoa pp join cad.profissional x on x.pessoa_id = pp.id where x.id = coalesce(l.profissional_executante_id, l.profissional_solicitante_id)) cpf_resp,
              (select pp.cns from cad.pessoa pp join cad.profissional x on x.pessoa_id = pp.id where x.id = l.autorizador_id) cns_aut,
              (select pp.cpf from cad.pessoa pp join cad.profissional x on x.pessoa_id = pp.id where x.id = l.autorizador_id) cpf_aut,
              pa.nome, pa.data_nascimento::text nasc, pa.sexo, pa.raca_cor, et.codigo etnia, pa.nome_mae, pa.cns, pa.cpf, pa.cep, pa.numero, pa.complemento,
              (select ps2.codigo from cad.pais ps2 where ps2.id = pa.pais_id) pais, tl.codigo tipo_logr, lg.nome logradouro, b.nome bairro, m.codigo_ibge mun_pac, m.uf_sigla uf,
              cb.codigo cbo_pac
         from aih.laudo l join cad.pessoa pa on pa.id = l.paciente_id
         left join cad.unidade ue on ue.id = coalesce(l.unidade_executante_id, l.unidade_solicitante_id)
         left join aih.orgao_emissor oe on oe.id = l.orgao_emissor_id
         join cad.procedimento ps on ps.id = l.procedimento_id left join cad.procedimento pr on pr.id = l.procedimento_realizado_id
         left join cad.cid cp on cp.id = l.cid_principal_id left join cad.cid cs on cs.id = l.cid_secundario_id left join cad.cid ca on ca.id = l.cid_associado1_id
         left join cad.etnia et on et.id = pa.etnia_id left join cad.logradouro lg on lg.id = pa.logradouro_id left join cad.tipo_logradouro tl on tl.id = lg.tipo_logradouro_id
         left join cad.bairro b on b.id = pa.bairro_id left join cad.municipio m on m.id = pa.municipio_id left join cad.cbo cb on cb.id = l.cbo_paciente_id
        where l.numero_aih is not null and l.situacao in ('AUTORIZADO','ARQUIVADO') and l.situacao_internacao = 'ALTA'
          and coalesce(l.competencia, to_char(l.data_saida, 'YYYYMM')) = $1 and ($2::bigint is null or l.unidade_executante_id = $2)
          and ($3 or l.lote_id is null)
        order by ue.cnes, l.numero_aih`,
      [competencia, unidadeId, reexportar],
    )
  ).rows;
  if (!aihs.length) throw new ErroHttp(422, 'Não há AIHs autorizadas com saída registrada nesta competência para exportar.');
  const linhas: string[] = [];
  for (const [i, a] of aihs.entries()) {
    const procs = (
      await c.query(
        `select p.codigo, ap.quantidade, to_char(ap.data, 'YYYYMM') cmpt, ap.cbo_codigo, pp.cns, pp.cpf
           from aih.procedimento ap join cad.procedimento p on p.id = ap.procedimento_id
           left join cad.profissional pf on pf.id = ap.profissional_id left join cad.pessoa pp on pp.id = pf.pessoa_id
          where ap.laudo_id = $1 order by (ap.tipo = 'PRINCIPAL') desc, ap.data, ap.id limit ${MAX_PROCEDIMENTOS}`,
        [a.id],
      )
    ).rows;
    const sol = docProfissional(a.cns_sol, a.cpf_sol);
    const resp = docProfissional(a.cns_resp, a.cpf_resp);
    const aut = docProfissional(a.cns_aut, a.cpf_aut);
    const v: Record<string, unknown> = {
      NU_LOTE: loteSeq,
      QT_LOTE: aihs.length,
      APRES_LOTE: competencia,
      SEQ_LOTE: i + 1,
      ORG_EMIS: a.orgao ?? '',
      CNES_HOSP: a.cnes_exec,
      MUN_HOSP: String(a.mun_hosp ?? '').slice(0, 6),
      NU_AIH: a.numero_aih,
      IDENT_AIH: '01',
      ESPEC_AIH: a.clinica,
      MOD_INTERN: ['09', '10', '13', '14'].includes(a.clinica) ? '03' : '02',
      DT_EMISSAO: aaaammdd(a.da),
      DT_INTERN: aaaammdd(a.di ?? a.da),
      DT_SAIDA: aaaammdd(a.ds),
      PROC_SOLICITADO: a.proc_sol,
      ST_MUDAPROC: a.proc_real !== a.proc_sol ? 1 : 2,
      PROC_REALIZADO: a.proc_real,
      CAR_INTERN: a.carater,
      MOT_SAIDA: a.motivo_saida,
      IDENT_MED_SOL: sol.ind,
      DOC_MED_SOL: sol.doc,
      IDENT_MED_RESP: resp.ind,
      DOC_MED_RESP: resp.doc,
      IDENT_DIR_CLINICO: resp.ind,
      DOC_DIR_CLINICO: resp.doc,
      IDENT_AUTORIZADOR: aut.ind,
      DOC_AUTORIZADOR: aut.doc,
      DIAG_PRINC: cid4(a.cid_p),
      DIAG_SEC: cid4(a.cid_s),
      DIAG_COMPL: cid4(a.cid_a),
      DIAG_OBITO: String(a.motivo_saida ?? '').startsWith('4') ? cid4(a.cid_p) : '',
      NOME_PAC: a.nome,
      DT_NASC_PAC: aaaammdd(a.nasc),
      SEXO_PAC: a.sexo,
      RACA_COR: a.raca_cor ?? '99',
      ETNIA: a.raca_cor === '05' ? (a.etnia ?? '') : '',
      NOME_MAE_PAC: a.nome_mae ?? '',
      TP_DOC_PAC: a.cpf ? 4 : 5,
      NU_DOC_PAC: digitos(a.cpf),
      NU_CNS: digitos(a.cns),
      NACIONALIDADE: a.pais ?? '010',
      COD_TIPO_LOGR: a.tipo_logr ?? '',
      LOGR_PAC: a.logradouro ?? '',
      NU_LOGR_PAC: a.numero ?? '',
      COMPL_PAC: a.complemento ?? '',
      BAIRRO_PAC: a.bairro ?? '',
      MUN_PAC: String(a.mun_pac ?? '').slice(0, 6),
      UF_PAC: a.uf ?? '',
      CEP_PAC: digitos(a.cep),
      NU_PRONTUARIO: a.prontuario ?? '',
      NU_ENFERMARIA: a.enfermaria ?? '',
      NU_LEITO: a.leito ?? '',
      CNPJ_EMPREGADOR: digitos(a.cnpj_empresa),
      CBO_PAC: a.cbo_pac ?? '',
      CNAE_EMPRESA: a.cnae_empresa ?? '',
      VINC_PREV: a.vinculo_previdencia ?? '',
      CNPJ_SEGURADORA: digitos(a.cnpj_seguradora),
      NU_BILHETE: a.numero_bilhete ?? '',
      VERSAO_SISTEMA: 'UBRISUS10',
    };
    procs.forEach((p, j) => {
      const doc = docProfissional(p.cns, p.cpf);
      const k = `PRC${j + 1}_`;
      Object.assign(v, {
        [k + 'IND_DOC_PROF']: doc.ind,
        [k + 'DOC_PROF']: doc.doc,
        [k + 'CBO']: p.cbo_codigo ?? '',
        [k + 'EQUIPE']: 0,
        [k + 'IND_DOC_EXEC']: 3,
        [k + 'DOC_EXEC']: a.cnes_exec ?? '',
        [k + 'CODIGO']: p.codigo,
        [k + 'QTD']: p.quantidade,
        [k + 'CMPT']: p.cmpt,
      });
    });
    linhas.push(montarLinha(LAYOUT_SISAIH01, v));
  }
  return {
    conteudo: Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1'),
    nome: `SISAIH01_${competencia}_L${String(loteSeq).padStart(4, '0')}.TXT`,
    registros: linhas.length,
    ids: aihs.map((a) => a.id),
  };
}

/** Layout do registro de importação do CIHA01 (um registro por atendimento/internação não SUS). */
export const LAYOUT_CIHA01: CampoLayout[] = [
  ['TP_REG', 2, 'N', '01 = registro de atendimento'],
  ['CNES', 7, 'N', 'CNES do estabelecimento'],
  ['CMPT', 6, 'N', 'Competência (AAAAMM)'],
  ['MODALIDADE', 1, 'N', '1 = internação, 2 = ambulatorial'],
  ['FONTE_REMUN', 1, 'N', 'Fonte de remuneração'],
  ['REG_ANS', 6, 'A', 'Registro ANS da operadora'],
  ['CNS_PAC', 15, 'A', 'CNS do paciente'],
  ['CPF_PAC', 11, 'A', 'CPF do paciente'],
  ['NOME_PAC', 70, 'A', 'Nome do paciente'],
  ['DT_NASC', 8, 'N', 'Data de nascimento'],
  ['SEXO', 1, 'A', 'Sexo'],
  ['RACA_COR', 2, 'N', 'Raça/cor'],
  ['MUN_RES', 6, 'N', 'Município de residência (IBGE)'],
  ['DT_INICIO', 8, 'N', 'Data do atendimento/internação'],
  ['DT_FIM', 8, 'N', 'Data da alta'],
  ['CARATER', 2, 'N', 'Caráter'],
  ['PROC', 10, 'N', 'Procedimento SIGTAP'],
  ['QTD', 4, 'N', 'Quantidade'],
  ['CID_PRINC', 4, 'A', 'CID principal'],
  ['CID_SEC', 4, 'A', 'CID secundário'],
  ['MOT_SAIDA', 2, 'N', 'Motivo de saída'],
  ['CNS_PROF', 15, 'A', 'CNS do profissional'],
];

export async function gerarCiha01(c: pg.PoolClient, competencia: string, unidadeId: number | null): Promise<ResultadoArquivo> {
  const regs = (
    await c.query(
      `select h.*, h.data_inicio::text di, h.data_fim::text df, u.cnes, pa.cns, pa.cpf, pa.nome, pa.data_nascimento::text nasc, pa.sexo, pa.raca_cor,
              (select m.codigo_ibge from cad.municipio m where m.id = pa.municipio_id) mun, p.codigo proc, cp.codigo cid_p, cs.codigo cid_s,
              (select pp.cns from cad.pessoa pp join cad.profissional x on x.pessoa_id = pp.id where x.id = h.profissional_id) cns_prof
         from aih.ciha h join cad.unidade u on u.id = h.unidade_id join cad.pessoa pa on pa.id = h.paciente_id join cad.procedimento p on p.id = h.procedimento_id
         left join cad.cid cp on cp.id = h.cid_principal_id left join cad.cid cs on cs.id = h.cid_secundario_id
        where h.competencia = $1 and ($2::bigint is null or h.unidade_id = $2) order by u.cnes, h.data_inicio, h.id`,
      [competencia, unidadeId],
    )
  ).rows;
  if (!regs.length) throw new ErroHttp(422, 'Não há registros CIHA nesta competência.');
  const linhas = regs.map((r) =>
    montarLinha(LAYOUT_CIHA01, {
      TP_REG: 1,
      CNES: r.cnes,
      CMPT: competencia,
      MODALIDADE: r.modalidade,
      FONTE_REMUN: r.fonte_remuneracao,
      REG_ANS: r.registro_ans ?? '',
      CNS_PAC: digitos(r.cns),
      CPF_PAC: digitos(r.cpf),
      NOME_PAC: r.nome,
      DT_NASC: aaaammdd(r.nasc),
      SEXO: r.sexo,
      RACA_COR: r.raca_cor ?? '99',
      MUN_RES: String(r.mun ?? '').slice(0, 6),
      DT_INICIO: aaaammdd(r.di),
      DT_FIM: aaaammdd(r.df ?? r.di),
      CARATER: r.carater ?? '01',
      PROC: r.proc,
      QTD: r.quantidade ?? 1,
      CID_PRINC: cid4(r.cid_p),
      CID_SEC: cid4(r.cid_s),
      MOT_SAIDA: r.motivo_saida ?? (r.modalidade === '1' ? '12' : ''),
      CNS_PROF: digitos(r.cns_prof),
    }),
  );
  return { conteudo: Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1'), nome: `CIHA01_${competencia}${unidadeId ? '_' + unidadeId : ''}.TXT`, registros: linhas.length, ids: regs.map((r) => r.id) };
}

/**
 * CIHA a partir dos dados do sistema: atendimentos agendados por convênio não SUS e realizados na
 * competência viram registros ambulatoriais, sem redigitação (TR 1.2.13.1.21).
 */
export async function gerarRegistrosCiha(c: pg.PoolClient, competencia: string) {
  const r = await c.query(
    `insert into aih.ciha (competencia, unidade_id, paciente_id, modalidade, fonte_remuneracao, convenio_id, data_inicio, data_fim, carater, procedimento_id, quantidade, profissional_id, origem)
     select $1::varchar, a.unidade_id, a.paciente_id, '2', '3', a.convenio_id, a.data, a.data, case when a.urgente then '02' else '01' end,
            coalesce(ap.procedimento_id, e.procedimento_id), coalesce(ap.quantidade, 1), a.profissional_id, 'agendamento:' || a.id
       from age.agendamento a join cad.convenio cv on cv.id = a.convenio_id and not cv.sus
       left join age.agendamento_procedimento ap on ap.agendamento_id = a.id left join cad.especialidade e on e.id = a.especialidade_id
      where to_char(a.data, 'YYYYMM') = $1::text and a.situacao = 'ATENDIDO' and coalesce(ap.procedimento_id, e.procedimento_id) is not null
        and not exists (select 1 from aih.ciha h where h.origem = 'agendamento:' || a.id)`,
    [competencia],
  );
  return { incluidos: r.rowCount ?? 0 };
}
