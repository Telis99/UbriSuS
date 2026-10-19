// Regras da APAC: autorização com a numeração das faixas (dígito verificador módulo 11), vigência de
// até 3 competências, vínculo da produção do paciente e arquivo de exportação no layout magnético do
// SIA/APAC: cabeçalho 01, corpo 14 (dados da APAC) e 13 (procedimentos) (TR 1.2.13.1.18 a 1.2.13.1.20).
import type pg from 'pg';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { campoControle, type OrgaoResponsavel } from '../faturamento/bpa.js';
import { aaaammdd, digitos, montarLinha, type CampoLayout } from '../aih/layout.js';
import { consumirNumero, faixaDoNumero, montarNumero, proximoNumero } from '../aih/servico.js';

export const LAYOUT_APAC_CABECALHO: CampoLayout[] = [
  ['TP_REG', 2, 'N', '01 = cabeçalho'],
  ['IDENT', 5, 'A', '#APAC'],
  ['CMPT', 6, 'N', 'Competência (AAAAMM)'],
  ['QT_LINHAS', 6, 'N', 'Quantidade de linhas'],
  ['QT_APACS', 6, 'N', 'Quantidade de APACs'],
  ['CONTROLE', 4, 'N', 'Campo de controle'],
  ['ORGAO_NOME', 30, 'A', 'Órgão responsável'],
  ['ORGAO_SIGLA', 6, 'A', 'Sigla'],
  ['ORGAO_CNPJ', 14, 'N', 'CNPJ'],
  ['DESTINO', 40, 'A', 'Órgão de destino'],
  ['INDICADOR', 1, 'A', 'M = municipal, E = estadual'],
  ['VERSAO', 15, 'A', 'Versão do sistema gerador'],
];

export const LAYOUT_APAC_CORPO: CampoLayout[] = [
  ['TP_REG', 2, 'N', '14 = dados da APAC'],
  ['CMPT', 6, 'N', 'Competência'],
  ['NU_APAC', 13, 'N', 'Número da APAC'],
  ['UF', 2, 'A', 'UF'],
  ['CNES', 7, 'N', 'CNES executante'],
  ['DT_PROCESSAMENTO', 8, 'N', 'Data de geração (AAAAMMDD)'],
  ['DT_VALIDADE_INI', 8, 'N', 'Início da validade'],
  ['DT_VALIDADE_FIM', 8, 'N', 'Fim da validade'],
  ['TP_ATENDIMENTO', 2, 'N', 'Tipo de atendimento'],
  ['TP_APAC', 1, 'N', '1 = inicial, 2 = continuidade, 3 = única'],
  ['NOME_PAC', 30, 'A', 'Nome do paciente'],
  ['NOME_MAE', 30, 'A', 'Nome da mãe'],
  ['LOGRADOURO', 30, 'A', 'Logradouro'],
  ['NUMERO', 5, 'A', 'Número'],
  ['COMPLEMENTO', 10, 'A', 'Complemento'],
  ['CEP', 8, 'N', 'CEP'],
  ['MUN_RES', 7, 'N', 'Município de residência (IBGE)'],
  ['DT_NASC', 8, 'N', 'Data de nascimento'],
  ['SEXO', 1, 'A', 'Sexo'],
  ['NOME_MED_RESP', 30, 'A', 'Médico responsável'],
  ['PROC_PRINCIPAL', 10, 'N', 'Procedimento principal'],
  ['MOT_SAIDA', 2, 'N', 'Motivo de saída/permanência'],
  ['DT_OBITO_ALTA', 8, 'N', 'Data do óbito/alta'],
  ['NOME_AUTORIZADOR', 30, 'A', 'Autorizador'],
  ['CNS_PAC', 15, 'A', 'CNS do paciente'],
  ['CNS_MED_RESP', 15, 'A', 'CNS do médico responsável'],
  ['CNS_AUTORIZADOR', 15, 'A', 'CNS do autorizador'],
  ['CID_ASSOCIADO', 4, 'A', 'CID causas associadas'],
  ['NU_PRONTUARIO', 10, 'A', 'Prontuário'],
  ['CNES_SOLICITANTE', 7, 'N', 'CNES solicitante'],
  ['DT_SOLICITACAO', 8, 'N', 'Data da solicitação'],
  ['DT_AUTORIZACAO', 8, 'N', 'Data da autorização'],
  ['COD_EMISSOR', 10, 'A', 'Órgão emissor'],
  ['CARATER', 2, 'N', 'Caráter do atendimento'],
  ['NU_APAC_ANTERIOR', 13, 'N', 'APAC anterior'],
  ['RACA_COR', 2, 'N', 'Raça/cor'],
  ['NOME_RESP', 30, 'A', 'Nome do responsável'],
  ['NACIONALIDADE', 3, 'N', 'Nacionalidade'],
  ['ETNIA', 4, 'A', 'Etnia'],
  ['COD_LOGRADOURO', 3, 'A', 'Tipo de logradouro (DNE)'],
  ['BAIRRO', 30, 'A', 'Bairro'],
  ['DDD', 2, 'A', 'DDD'],
  ['TELEFONE', 9, 'A', 'Telefone'],
  ['EMAIL', 40, 'A', 'E-mail'],
  ['CNS_EXECUTANTE', 15, 'A', 'CNS do médico executante'],
  ['CPF_PAC', 11, 'A', 'CPF do paciente'],
  ['INE', 10, 'A', 'Equipe'],
  ['SITUACAO_RUA', 1, 'A', 'S/N'],
];

export const LAYOUT_APAC_PROCEDIMENTO: CampoLayout[] = [
  ['TP_REG', 2, 'N', '13 = procedimento realizado'],
  ['CMPT', 6, 'N', 'Competência'],
  ['NU_APAC', 13, 'N', 'Número da APAC'],
  ['PROC', 10, 'N', 'Procedimento'],
  ['CBO', 6, 'A', 'CBO do executante'],
  ['QTD', 7, 'N', 'Quantidade'],
  ['CNPJ_CESSAO', 14, 'A', 'CNPJ cessão de crédito'],
  ['NU_NF', 6, 'A', 'Nota fiscal'],
  ['CID_PRINC', 4, 'A', 'CID principal'],
  ['CID_SEC', 4, 'A', 'CID secundário'],
  ['SERVICO', 3, 'A', 'Serviço'],
  ['CLASSIFICACAO', 3, 'A', 'Classificação'],
  ['SEQ_EQUIPE', 8, 'A', 'Sequência da equipe'],
  ['AREA_EQUIPE', 4, 'A', 'Área da equipe'],
  ['CNPJ_EMPRESA', 14, 'A', 'CNPJ da empresa'],
  ['INE', 10, 'A', 'Equipe'],
];

const somaMeses = (data: string, meses: number) => {
  const d = new Date(data + 'T12:00:00');
  d.setMonth(d.getMonth() + meses, 0);
  return d.toISOString().slice(0, 10);
};

/** Autoriza a APAC com o número informado ou o próximo livre; validade de até 3 competências (inicial). */
export async function autorizarApac(c: pg.PoolClient, id: number, d: { numero?: string | null; autorizadorId: number; data?: string | null }, u: Usuario) {
  const l = (await c.query(`select *, data_solicitacao::text ds from apac.laudo where id = $1 for update`, [id])).rows[0];
  if (!l) throw new ErroHttp(404, 'Laudo de APAC não encontrado.');
  if (l.situacao !== 'SOLICITADO') throw new ErroHttp(409, `APAC na situação ${l.situacao} não pode ser autorizada.`);
  const aut = (await c.query(`select autorizador_aih, ativo, nome from cad.profissional where id = $1`, [d.autorizadorId])).rows[0];
  if (!aut?.autorizador_aih || !aut.ativo) throw new ErroHttp(422, 'Profissional não habilitado como autorizador no cadastro de profissionais.');
  const data = d.data ?? new Date().toISOString().slice(0, 10);
  let numero = d.numero ? d.numero.replace(/\D/g, '') : null;
  let faixa: { id: number; orgao_emissor_id: number };
  if (numero) {
    if (numero.length === 12) numero = montarNumero(numero);
    faixa = await faixaDoNumero(c, 'APAC', numero, data);
  } else {
    const p = await proximoNumero(c, { tipo: 'APAC', unidadeId: l.unidade_executante_id, data });
    if (!p) throw new ErroHttp(422, 'Não há números de APAC disponíveis em faixa válida. Cadastre a faixa em AIH > Cadastros > Faixas numéricas.');
    numero = p.numero;
    faixa = { id: p.faixaId, orgao_emissor_id: p.orgaoEmissorId };
  }
  await consumirNumero(c, faixa.id, numero, `APAC ${l.numero_laudo}`);
  const fim = l.tipo_apac === '3' ? somaMeses(data, 1) : somaMeses(data, 3);
  await c.query(
    `update apac.laudo set situacao = 'AUTORIZADO', numero_apac = $2, faixa_id = $3, orgao_emissor_id = $4, autorizador_id = $5, autorizado_em = $6::date + localtime,
            autorizado_por = $7, validade_inicio = $6::date, validade_fim = $8::date where id = $1`,
    [id, numero, faixa.id, faixa.orgao_emissor_id, d.autorizadorId, data, u.id, fim],
  );
  return { id, numero, validadeFim: fim };
}

/** Vincula à APAC a produção já registrada do paciente (procedimentos de instrumento APAC) dentro da validade. */
export async function vincularProducao(c: pg.PoolClient, id: number) {
  const l = (await c.query(`select * from apac.laudo where id = $1`, [id])).rows[0];
  if (!l || l.situacao !== 'AUTORIZADO') throw new ErroHttp(409, 'A APAC precisa estar autorizada.');
  const r = await c.query(
    `insert into apac.procedimento (laudo_id, competencia, data, procedimento_id, quantidade, profissional_id, cbo_codigo, cid_codigo, valor, producao_id)
     select $1, p.competencia, p.data, p.procedimento_id, p.quantidade, p.profissional_id, p.cbo_codigo, p.cid_codigo, p.valor, p.id
       from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id
      where p.paciente_id = $2 and p.data between $3 and $4 and (pr.instrumentos && array['06','07']::text[] or p.procedimento_id = $5)
        and not exists (select 1 from apac.procedimento x where x.producao_id = p.id)`,
    [id, l.paciente_id, l.validade_inicio, l.validade_fim, l.procedimento_id],
  );
  return { vinculados: r.rowCount ?? 0 };
}

export async function gerarArquivoApac(c: pg.PoolClient, competencia: string, unidadeId: number | null) {
  const apacs = (
    await c.query(
      `select l.*, l.validade_inicio::text vi, l.validade_fim::text vf, l.data_solicitacao::text ds, l.autorizado_em::date::text da,
              ue.cnes, us.cnes cnes_sol, oe.codigo emissor, pr.codigo proc, ca.codigo cid_assoc, pa.nome, pa.nome_mae, pa.numero, pa.complemento, pa.cep, pa.data_nascimento::text nasc, pa.sexo,
              pa.cns, pa.cpf, pa.raca_cor, pa.email, coalesce(pa.celular, pa.telefone) fone, pa.data_obito::text obito, et.codigo etnia, lg.nome logradouro, tl.codigo tipo_logr, b.nome bairro,
              m.codigo_ibge mun, m.uf_sigla uf, (select ps.codigo from cad.pais ps where ps.id = pa.pais_id) pais,
              ms.nome medico, (select x.cns from cad.pessoa x where x.id = ms.pessoa_id) cns_medico, az.nome autorizador, (select x.cns from cad.pessoa x where x.id = az.pessoa_id) cns_aut
         from apac.laudo l join cad.pessoa pa on pa.id = l.paciente_id join cad.procedimento pr on pr.id = l.procedimento_id
         left join cad.unidade ue on ue.id = l.unidade_executante_id left join cad.unidade us on us.id = l.unidade_solicitante_id left join aih.orgao_emissor oe on oe.id = l.orgao_emissor_id
         left join cad.cid ca on ca.id = l.cid_associado_id left join cad.etnia et on et.id = pa.etnia_id left join cad.logradouro lg on lg.id = pa.logradouro_id
         left join cad.tipo_logradouro tl on tl.id = lg.tipo_logradouro_id left join cad.bairro b on b.id = pa.bairro_id left join cad.municipio m on m.id = pa.municipio_id
         left join cad.profissional ms on ms.id = l.profissional_solicitante_id left join cad.profissional az on az.id = l.autorizador_id
        where l.numero_apac is not null and l.situacao in ('AUTORIZADO','ENCERRADO') and to_date($1, 'YYYYMM') between date_trunc('month', l.validade_inicio) and l.validade_fim
          and ($2::bigint is null or l.unidade_executante_id = $2)
        order by ue.cnes, l.numero_apac`,
      [competencia, unidadeId],
    )
  ).rows;
  const linhas: string[] = [];
  const controle: { procedimento: string; quantidade: number }[] = [];
  const procIds: number[] = [];
  let qtdApacs = 0;
  for (const a of apacs) {
    const procs = (
      await c.query(
        `select ap.id, p.codigo, ap.quantidade, ap.cbo_codigo, coalesce(ap.cid_codigo, cp.codigo) cid, cs.codigo cid_sec
           from apac.procedimento ap join cad.procedimento p on p.id = ap.procedimento_id join apac.laudo l on l.id = ap.laudo_id
           left join cad.cid cp on cp.id = l.cid_principal_id left join cad.cid cs on cs.id = l.cid_secundario_id
          where ap.laudo_id = $1 and ap.competencia = $2 order by ap.id`,
        [a.id, competencia],
      )
    ).rows;
    if (!procs.length) continue;
    qtdApacs++;
    const fone = digitos(a.fone);
    linhas.push(
      montarLinha(LAYOUT_APAC_CORPO, {
        TP_REG: 14,
        CMPT: competencia,
        NU_APAC: a.numero_apac,
        UF: a.uf ?? 'SP',
        CNES: a.cnes,
        DT_PROCESSAMENTO: aaaammdd(new Date().toISOString()),
        DT_VALIDADE_INI: aaaammdd(a.vi),
        DT_VALIDADE_FIM: aaaammdd(a.vf),
        TP_ATENDIMENTO: '00',
        TP_APAC: a.tipo_apac,
        NOME_PAC: a.nome,
        NOME_MAE: a.nome_mae ?? '',
        LOGRADOURO: a.logradouro ?? '',
        NUMERO: a.numero ?? '',
        COMPLEMENTO: a.complemento ?? '',
        CEP: digitos(a.cep),
        MUN_RES: a.mun ?? '',
        DT_NASC: aaaammdd(a.nasc),
        SEXO: a.sexo,
        NOME_MED_RESP: a.medico ?? '',
        PROC_PRINCIPAL: a.proc,
        MOT_SAIDA: a.motivo_saida ?? '21',
        DT_OBITO_ALTA: a.motivo_saida === '41' ? aaaammdd(a.obito) : '',
        NOME_AUTORIZADOR: a.autorizador ?? '',
        CNS_PAC: digitos(a.cns),
        CNS_MED_RESP: digitos(a.cns_medico),
        CNS_AUTORIZADOR: digitos(a.cns_aut),
        CID_ASSOCIADO: a.cid_assoc ?? '',
        NU_PRONTUARIO: a.prontuario ?? '',
        CNES_SOLICITANTE: a.cnes_sol,
        DT_SOLICITACAO: aaaammdd(a.ds),
        DT_AUTORIZACAO: aaaammdd(a.da),
        COD_EMISSOR: a.emissor ?? '',
        CARATER: a.carater ?? '01',
        NU_APAC_ANTERIOR: digitos(a.apac_anterior),
        RACA_COR: a.raca_cor ?? '99',
        NACIONALIDADE: a.pais ?? '010',
        ETNIA: a.raca_cor === '05' ? (a.etnia ?? '') : '',
        COD_LOGRADOURO: a.tipo_logr ?? '',
        BAIRRO: a.bairro ?? '',
        DDD: fone.slice(0, 2),
        TELEFONE: fone.slice(2),
        EMAIL: a.email ?? '',
        CNS_EXECUTANTE: digitos(a.cns_medico),
        CPF_PAC: digitos(a.cpf),
        SITUACAO_RUA: 'N',
      }),
    );
    for (const p of procs) {
      linhas.push(montarLinha(LAYOUT_APAC_PROCEDIMENTO, { TP_REG: 13, CMPT: competencia, NU_APAC: a.numero_apac, PROC: p.codigo, CBO: p.cbo_codigo ?? '', QTD: p.quantidade, CID_PRINC: p.cid ?? '', CID_SEC: p.cid_sec ?? '' }));
      controle.push({ procedimento: p.codigo, quantidade: p.quantidade });
      procIds.push(p.id);
    }
  }
  if (!qtdApacs) throw new ErroHttp(422, 'Não há APACs autorizadas com procedimentos realizados nesta competência.');
  const orgao = await parametro<OrgaoResponsavel>('faturamento.orgao', { nome: 'SECRETARIA MUNICIPAL DE SAUDE', sigla: 'SMS', cnpj: '', destino: 'SECRETARIA MUNICIPAL DE SAUDE', indicador: 'M' });
  const cc = campoControle(controle);
  const cab = montarLinha(LAYOUT_APAC_CABECALHO, {
    TP_REG: 1,
    IDENT: '#APAC',
    CMPT: competencia,
    QT_LINHAS: linhas.length,
    QT_APACS: qtdApacs,
    CONTROLE: cc,
    ORGAO_NOME: orgao.nome,
    ORGAO_SIGLA: orgao.sigla,
    ORGAO_CNPJ: orgao.cnpj,
    DESTINO: orgao.destino,
    INDICADOR: orgao.indicador,
    VERSAO: 'UBRISUS10',
  });
  const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  return {
    conteudo: Buffer.from([cab, ...linhas].join('\r\n') + '\r\n', 'latin1'),
    nome: `AP${competencia.slice(2)}${unidadeId ? '_' + unidadeId : ''}.${MESES[Number(competencia.slice(4)) - 1]}`,
    apacs: qtdApacs,
    linhas: linhas.length,
    controle: cc,
    procIds,
  };
}
