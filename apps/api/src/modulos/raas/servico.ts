// Regras do RAAS: abertura automática do registro do usuário por competência, lançamento das ações a partir
// dos atendimentos (CAPS, atenção domiciliar e produção com instrumento RAAS), arquivo de exportação em
// largura fixa (cabeçalho 01, registro 30 do usuário e 31 das ações) e importação do mesmo layout
// (TR 1.2.44.1 a 1.2.44.5, 1.2.13.1.30, 1.2.13.1.31, 1.2.13.1.36).
import type pg from 'pg';
import { ErroHttp } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { campoControle, type OrgaoResponsavel } from '../faturamento/bpa.js';
import { aaaammdd, digitos, lerLinha, montarLinha, type CampoLayout } from '../aih/layout.js';

export type TipoRaas = 'PSICOSSOCIAL' | 'DOMICILIAR';

export interface AcaoRaas {
  tipo: TipoRaas;
  unidadeId: number;
  pacienteId: number;
  data: string;
  procedimentoId: number;
  quantidade?: number;
  profissionalId?: number | null;
  local?: 'C' | 'T' | 'D';
  origem: string;
  cidId?: number | null;
}

const competenciaDe = (data: string) => data.slice(0, 7).replace('-', '');

/** Registro RAAS do usuário na competência; herda os dados de admissão da competência anterior. */
export async function registroDaCompetencia(c: pg.PoolClient, tipo: TipoRaas, unidadeId: number, pacienteId: number, competencia: string, dados: { dataInicio?: string; cidId?: number | null; profissionalId?: number | null } = {}) {
  const atual = (await c.query(`select id from raas.registro where tipo = $1 and unidade_id = $2 and paciente_id = $3 and competencia = $4`, [tipo, unidadeId, pacienteId, competencia])).rows[0];
  if (atual) return atual.id as number;
  const anterior = (
    await c.query(`select * from raas.registro where tipo = $1 and unidade_id = $2 and paciente_id = $3 and competencia < $4 and data_fim is null order by competencia desc limit 1`, [tipo, unidadeId, pacienteId, competencia])
  ).rows[0];
  const r = await c.query(
    `insert into raas.registro (tipo, competencia, unidade_id, paciente_id, data_inicio, origem, desfecho, profissional_id, cid_principal_id, cid_secundario_id, situacao_rua,
                               substancias, cobertura_esf, modalidade_ad, cuidador, cuidador_cns, situacao)
     values ($1,$2,$3,$4,$5,$6,'21',$7,$8,$9,$10,$11,$12,$13,$14,$15,'ABERTO') returning id`,
    [
      tipo,
      competencia,
      unidadeId,
      pacienteId,
      anterior?.data_inicio ?? dados.dataInicio ?? `${competencia.slice(0, 4)}-${competencia.slice(4)}-01`,
      anterior?.origem ?? '01',
      anterior?.profissional_id ?? dados.profissionalId ?? null,
      anterior?.cid_principal_id ?? dados.cidId ?? null,
      anterior?.cid_secundario_id ?? null,
      anterior?.situacao_rua ?? false,
      anterior?.substancias ?? null,
      anterior?.cobertura_esf ?? true,
      anterior?.modalidade_ad ?? (tipo === 'DOMICILIAR' ? 'AD2' : null),
      anterior?.cuidador ?? null,
      anterior?.cuidador_cns ?? null,
    ],
  );
  return r.rows[0].id as number;
}

/** Lança uma ação no RAAS do usuário (sem redigitação: chamado pelos atendimentos). */
export async function registrarAcaoRaas(c: pg.PoolClient, a: AcaoRaas) {
  const ja = (await c.query(`select id from raas.acao where origem = $1`, [a.origem])).rows[0];
  if (ja) return ja.id as number;
  const registroId = await registroDaCompetencia(c, a.tipo, a.unidadeId, a.pacienteId, competenciaDe(a.data), { dataInicio: a.data, cidId: a.cidId, profissionalId: a.profissionalId });
  const cbo = a.profissionalId
    ? (await c.query(`select cb.codigo from cad.vinculo v join cad.cbo cb on cb.id = v.cbo_id where v.profissional_id = $1 and v.ativo order by (v.unidade_id = $2) desc limit 1`, [a.profissionalId, a.unidadeId])).rows[0]?.codigo
    : null;
  const cid = a.cidId ? (await c.query(`select codigo from cad.cid where id = $1`, [a.cidId])).rows[0]?.codigo : null;
  const r = await c.query(
    `insert into raas.acao (registro_id, data, procedimento_id, quantidade, profissional_id, cbo_codigo, local, cid_codigo, origem) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [registroId, a.data, a.procedimentoId, a.quantidade ?? 1, a.profissionalId ?? null, cbo ?? null, a.local ?? 'C', cid ? String(cid).slice(0, 4) : null, a.origem],
  );
  if (cid) await c.query(`update raas.registro set cid_principal_id = coalesce(cid_principal_id, $2) where id = $1`, [registroId, a.cidId]);
  return r.rows[0].id as number;
}

/** O procedimento é registrado em RAAS (instrumento 08 = atenção domiciliar, 09 = psicossocial)? */
export async function tipoRaasDoProcedimento(c: pg.PoolClient | pg.Pool, procedimentoId: number): Promise<TipoRaas | null> {
  const p = (await c.query(`select instrumentos from cad.procedimento where id = $1`, [procedimentoId])).rows[0];
  const ins: string[] = p?.instrumentos ?? [];
  return ins.includes('09') ? 'PSICOSSOCIAL' : ins.includes('08') ? 'DOMICILIAR' : null;
}

/**
 * Gera as ações RAAS da competência a partir dos dados já registrados no sistema: produção com
 * procedimentos de instrumento RAAS (atendimentos domiciliares, CAPS e demais) (TR 1.2.44.3, 1.2.13.1.36).
 */
export async function gerarAcoesDaProducao(c: pg.PoolClient, competencia: string) {
  const prods = (
    await c.query(
      `select p.id, p.data::text data, p.unidade_id, p.paciente_id, p.procedimento_id, p.quantidade, p.profissional_id, pr.instrumentos,
              (select id from cad.cid where codigo = p.cid_codigo) cid_id, p.origem
         from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id
        where p.competencia = $1 and p.paciente_id is not null and pr.instrumentos && array['08','09']::text[]
          and not exists (select 1 from raas.acao a where a.origem = 'producao:' || p.id)`,
      [competencia],
    )
  ).rows;
  let geradas = 0;
  for (const p of prods) {
    await registrarAcaoRaas(c, {
      tipo: (p.instrumentos as string[]).includes('09') ? 'PSICOSSOCIAL' : 'DOMICILIAR',
      unidadeId: p.unidade_id,
      pacienteId: p.paciente_id,
      data: p.data,
      procedimentoId: p.procedimento_id,
      quantidade: p.quantidade,
      profissionalId: p.profissional_id,
      local: p.origem === 'VISITA_ACS' ? 'D' : 'C',
      origem: `producao:${p.id}`,
      cidId: p.cid_id,
    });
    geradas++;
  }
  return { geradas };
}

export const LAYOUT_RAAS_CABECALHO: CampoLayout[] = [
  ['TP_REG', 2, 'N', '01 = cabeçalho'],
  ['IDENT', 5, 'A', '#RAAS'],
  ['CMPT', 6, 'N', 'Competência (AAAAMM)'],
  ['QT_LINHAS', 6, 'N', 'Linhas do arquivo'],
  ['QT_RAAS', 6, 'N', 'Quantidade de RAAS'],
  ['CONTROLE', 4, 'N', 'Campo de controle (soma de procedimentos e quantidades mod 1111 + 1111)'],
  ['ORGAO_NOME', 30, 'A', 'Órgão responsável'],
  ['ORGAO_SIGLA', 6, 'A', 'Sigla'],
  ['ORGAO_CNPJ', 14, 'N', 'CNPJ'],
  ['DESTINO', 40, 'A', 'Destino'],
  ['INDICADOR', 1, 'A', 'M = municipal, E = estadual'],
  ['VERSAO', 15, 'A', 'Sistema gerador'],
];

export const LAYOUT_RAAS_USUARIO: CampoLayout[] = [
  ['TP_REG', 2, 'N', '30 = RAAS do usuário'],
  ['TP_RAAS', 2, 'N', '01 = atenção domiciliar, 02 = psicossocial'],
  ['CMPT', 6, 'N', 'Competência'],
  ['CNES', 7, 'N', 'CNES do estabelecimento'],
  ['CNS_PAC', 15, 'A', 'CNS do usuário'],
  ['CPF_PAC', 11, 'A', 'CPF do usuário'],
  ['NOME_PAC', 70, 'A', 'Nome'],
  ['DT_NASC', 8, 'N', 'Nascimento'],
  ['SEXO', 1, 'A', 'Sexo'],
  ['RACA_COR', 2, 'N', 'Raça/cor'],
  ['ETNIA', 4, 'A', 'Etnia'],
  ['NOME_MAE', 70, 'A', 'Nome da mãe'],
  ['NACIONALIDADE', 3, 'N', 'Nacionalidade'],
  ['MUN_RES', 7, 'N', 'Município de residência'],
  ['COD_LOGRADOURO', 3, 'A', 'Tipo de logradouro'],
  ['LOGRADOURO', 50, 'A', 'Logradouro'],
  ['NUMERO', 7, 'A', 'Número'],
  ['COMPLEMENTO', 15, 'A', 'Complemento'],
  ['BAIRRO', 30, 'A', 'Bairro'],
  ['CEP', 8, 'N', 'CEP'],
  ['TELEFONE', 11, 'A', 'Telefone'],
  ['DT_INICIO', 8, 'N', 'Data de admissão'],
  ['DT_FIM', 8, 'N', 'Data de conclusão'],
  ['ORIGEM', 2, 'N', 'Origem do usuário'],
  ['DESFECHO', 2, 'N', 'Motivo de saída/permanência'],
  ['CID_PRINC', 4, 'A', 'CID principal'],
  ['CID_SEC', 4, 'A', 'CID secundário'],
  ['CID_ASSOC', 4, 'A', 'CID causas associadas'],
  ['SITUACAO_RUA', 1, 'A', 'S/N'],
  ['USO_ALCOOL', 1, 'A', 'S/N'],
  ['USO_CRACK', 1, 'A', 'S/N'],
  ['USO_OUTRAS', 1, 'A', 'S/N'],
  ['COBERTURA_ESF', 1, 'A', 'S/N'],
  ['MODALIDADE_AD', 1, 'A', '1, 2 ou 3 (atenção domiciliar)'],
  ['NOME_CUIDADOR', 70, 'A', 'Cuidador (atenção domiciliar)'],
  ['CNS_CUIDADOR', 15, 'A', 'CNS do cuidador'],
  ['CNS_PROF_RESP', 15, 'A', 'CNS do profissional responsável'],
];

export const LAYOUT_RAAS_ACAO: CampoLayout[] = [
  ['TP_REG', 2, 'N', '31 = ação realizada'],
  ['CMPT', 6, 'N', 'Competência'],
  ['CNES', 7, 'N', 'CNES'],
  ['CNS_PAC', 15, 'A', 'CNS do usuário'],
  ['DT_ACAO', 8, 'N', 'Data da ação'],
  ['PROC', 10, 'N', 'Procedimento SIGTAP'],
  ['QTD', 6, 'N', 'Quantidade'],
  ['CNS_PROF', 15, 'A', 'CNS do profissional'],
  ['CBO', 6, 'A', 'CBO'],
  ['LOCAL', 1, 'A', 'C = no serviço, T = território, D = domicílio'],
  ['CID', 4, 'A', 'CID'],
];

export async function gerarArquivoRaas(c: pg.PoolClient, competencia: string, tipo: TipoRaas | null, unidadeId: number | null) {
  const regs = (
    await c.query(
      `select r.*, r.data_inicio::text di, r.data_fim::text df, u.cnes, pa.cns, pa.cpf, pa.nome, pa.data_nascimento::text nasc, pa.sexo, pa.raca_cor, et.codigo etnia, pa.nome_mae,
              (select ps.codigo from cad.pais ps where ps.id = pa.pais_id) pais, m.codigo_ibge mun, tl.codigo tipo_logr, lg.nome logradouro, pa.numero, pa.complemento, b.nome bairro, pa.cep,
              coalesce(pa.celular, pa.telefone) fone, cp.codigo cid_p, cs.codigo cid_s, ca.codigo cid_a, (select x.cns from cad.pessoa x join cad.profissional pf on pf.pessoa_id = x.id where pf.id = r.profissional_id) cns_prof
         from raas.registro r join cad.unidade u on u.id = r.unidade_id join cad.pessoa pa on pa.id = r.paciente_id
         left join cad.etnia et on et.id = pa.etnia_id left join cad.municipio m on m.id = pa.municipio_id left join cad.logradouro lg on lg.id = pa.logradouro_id
         left join cad.tipo_logradouro tl on tl.id = lg.tipo_logradouro_id left join cad.bairro b on b.id = pa.bairro_id
         left join cad.cid cp on cp.id = r.cid_principal_id left join cad.cid cs on cs.id = r.cid_secundario_id left join cad.cid ca on ca.id = r.cid_associado_id
        where r.competencia = $1 and ($2::text is null or r.tipo = $2) and ($3::bigint is null or r.unidade_id = $3)
          and exists (select 1 from raas.acao a where a.registro_id = r.id)
        order by u.cnes, r.tipo, pa.nome`,
      [competencia, tipo, unidadeId],
    )
  ).rows;
  if (!regs.length) throw new ErroHttp(422, 'Não há RAAS com ações registradas nesta competência.');
  const linhas: string[] = [];
  const controle: { procedimento: string; quantidade: number }[] = [];
  let acoes = 0;
  for (const r of regs) {
    const subst: string[] = r.substancias ?? [];
    linhas.push(
      montarLinha(LAYOUT_RAAS_USUARIO, {
        TP_REG: 30,
        TP_RAAS: r.tipo === 'DOMICILIAR' ? '01' : '02',
        CMPT: competencia,
        CNES: r.cnes,
        CNS_PAC: digitos(r.cns),
        CPF_PAC: digitos(r.cpf),
        NOME_PAC: r.nome,
        DT_NASC: aaaammdd(r.nasc),
        SEXO: r.sexo,
        RACA_COR: r.raca_cor ?? '99',
        ETNIA: r.raca_cor === '05' ? (r.etnia ?? '') : '',
        NOME_MAE: r.nome_mae ?? '',
        NACIONALIDADE: r.pais ?? '010',
        MUN_RES: r.mun ?? '',
        COD_LOGRADOURO: r.tipo_logr ?? '',
        LOGRADOURO: r.logradouro ?? '',
        NUMERO: r.numero ?? '',
        COMPLEMENTO: r.complemento ?? '',
        BAIRRO: r.bairro ?? '',
        CEP: digitos(r.cep),
        TELEFONE: digitos(r.fone),
        DT_INICIO: aaaammdd(r.di),
        DT_FIM: aaaammdd(r.df),
        ORIGEM: r.origem ?? '01',
        DESFECHO: r.desfecho ?? '21',
        CID_PRINC: r.cid_p ?? '',
        CID_SEC: r.cid_s ?? '',
        CID_ASSOC: r.cid_a ?? '',
        SITUACAO_RUA: r.situacao_rua ? 'S' : 'N',
        USO_ALCOOL: subst.includes('ALCOOL') ? 'S' : 'N',
        USO_CRACK: subst.includes('CRACK') ? 'S' : 'N',
        USO_OUTRAS: subst.some((s) => !['ALCOOL', 'CRACK'].includes(s)) ? 'S' : 'N',
        COBERTURA_ESF: r.cobertura_esf ? 'S' : 'N',
        MODALIDADE_AD: r.modalidade_ad ? r.modalidade_ad.slice(2) : '',
        NOME_CUIDADOR: r.cuidador ?? '',
        CNS_CUIDADOR: digitos(r.cuidador_cns),
        CNS_PROF_RESP: digitos(r.cns_prof),
      }),
    );
    const itens = (
      await c.query(
        `select a.data::text data, p.codigo, a.quantidade, a.cbo_codigo, a.local, a.cid_codigo, (select x.cns from cad.pessoa x join cad.profissional pf on pf.pessoa_id = x.id where pf.id = a.profissional_id) cns_prof
           from raas.acao a join cad.procedimento p on p.id = a.procedimento_id where a.registro_id = $1 order by a.data, a.id`,
        [r.id],
      )
    ).rows;
    for (const a of itens) {
      linhas.push(
        montarLinha(LAYOUT_RAAS_ACAO, { TP_REG: 31, CMPT: competencia, CNES: r.cnes, CNS_PAC: digitos(r.cns), DT_ACAO: aaaammdd(a.data), PROC: a.codigo, QTD: a.quantidade, CNS_PROF: digitos(a.cns_prof), CBO: a.cbo_codigo ?? '', LOCAL: a.local ?? 'C', CID: a.cid_codigo ?? '' }),
      );
      controle.push({ procedimento: a.codigo, quantidade: a.quantidade });
      acoes++;
    }
  }
  const orgao = await parametro<OrgaoResponsavel>('faturamento.orgao', { nome: 'SECRETARIA MUNICIPAL DE SAUDE', sigla: 'SMS', cnpj: '', destino: 'SECRETARIA MUNICIPAL DE SAUDE', indicador: 'M' });
  const cc = campoControle(controle);
  const cab = montarLinha(LAYOUT_RAAS_CABECALHO, {
    TP_REG: 1,
    IDENT: '#RAAS',
    CMPT: competencia,
    QT_LINHAS: linhas.length,
    QT_RAAS: regs.length,
    CONTROLE: cc,
    ORGAO_NOME: orgao.nome,
    ORGAO_SIGLA: orgao.sigla,
    ORGAO_CNPJ: orgao.cnpj,
    DESTINO: orgao.destino,
    INDICADOR: orgao.indicador,
    VERSAO: 'UBRISUS10',
  });
  return {
    conteudo: Buffer.from([cab, ...linhas].join('\r\n') + '\r\n', 'latin1'),
    nome: `RAAS_${competencia}${tipo ? '_' + (tipo === 'DOMICILIAR' ? 'AD' : 'PS') : ''}.TXT`,
    registros: regs.length,
    acoes,
    ids: regs.map((r) => r.id as number),
  };
}

/** Importação de arquivo RAAS (mesmo layout) de prestadores, com críticas de estabelecimento, usuário e procedimento (TR 1.2.44.4). */
export async function importarRaas(c: pg.PoolClient, conteudo: string) {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas[0]?.startsWith('01#RAAS')) throw new ErroHttp(422, 'Arquivo fora do layout RAAS (cabeçalho 01#RAAS).');
  const cab = lerLinha(LAYOUT_RAAS_CABECALHO, linhas[0]);
  const resultado = { competencia: cab.CMPT, registros: 0, acoes: 0, criticas: [] as string[] };
  const registros = new Map<string, number>();
  for (const [i, l] of linhas.slice(1).entries()) {
    const tipo = l.slice(0, 2);
    if (tipo === '30') {
      const u = lerLinha(LAYOUT_RAAS_USUARIO, l);
      const un = (await c.query(`select id from cad.unidade where cnes = $1`, [u.CNES])).rows[0];
      const pac = (await c.query(`select id from cad.pessoa where (cns = $1 and $1 <> '') or (cpf = $2 and $2 <> '') limit 1`, [u.CNS_PAC, u.CPF_PAC])).rows[0];
      if (!un) resultado.criticas.push(`Linha ${i + 2}: CNES ${u.CNES} não cadastrado.`);
      if (!pac) resultado.criticas.push(`Linha ${i + 2}: usuário ${u.NOME_PAC} (CNS ${u.CNS_PAC || '-'}) não localizado no cadastro.`);
      if (!un || !pac) continue;
      const tp: TipoRaas = u.TP_RAAS === '01' ? 'DOMICILIAR' : 'PSICOSSOCIAL';
      const data = (s: string) => (s && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
      const cid = async (codigo: string) => (codigo ? ((await c.query(`select id from cad.cid where codigo = $1`, [codigo])).rows[0]?.id ?? null) : null);
      const id = await registroDaCompetencia(c, tp, un.id, pac.id, u.CMPT, { dataInicio: data(u.DT_INICIO) ?? undefined });
      await c.query(
        `update raas.registro set data_inicio = coalesce($2, data_inicio), data_fim = $3, origem = $4, desfecho = $5, cid_principal_id = coalesce($6, cid_principal_id),
                cid_secundario_id = coalesce($7, cid_secundario_id), situacao_rua = $8, cobertura_esf = $9, situacao = 'IMPORTADO' where id = $1`,
        [id, data(u.DT_INICIO), data(u.DT_FIM), u.ORIGEM || '01', u.DESFECHO || '21', await cid(u.CID_PRINC), await cid(u.CID_SEC), u.SITUACAO_RUA === 'S', u.COBERTURA_ESF === 'S'],
      );
      registros.set(`${u.CNES}|${u.CNS_PAC}`, id);
      resultado.registros++;
    } else if (tipo === '31') {
      const a = lerLinha(LAYOUT_RAAS_ACAO, l);
      const reg = registros.get(`${a.CNES}|${a.CNS_PAC}`);
      if (!reg) {
        resultado.criticas.push(`Linha ${i + 2}: ação sem RAAS do usuário válida.`);
        continue;
      }
      const proc = (await c.query(`select id from cad.procedimento where codigo = $1`, [a.PROC])).rows[0];
      if (!proc) {
        resultado.criticas.push(`Linha ${i + 2}: procedimento ${a.PROC} inexistente na tabela SIGTAP.`);
        continue;
      }
      const prof = a.CNS_PROF ? (await c.query(`select pf.id from cad.profissional pf join cad.pessoa p on p.id = pf.pessoa_id where p.cns = $1`, [a.CNS_PROF])).rows[0] : null;
      const origem = `importacao:${cab.CMPT}:${a.CNES}:${a.CNS_PAC}:${a.DT_ACAO}:${a.PROC}:${i}`;
      const dataAcao = `${a.DT_ACAO.slice(0, 4)}-${a.DT_ACAO.slice(4, 6)}-${a.DT_ACAO.slice(6, 8)}`;
      // Ação já registrada (mesmo usuário, data, procedimento e profissional) não é duplicada.
      const existe = await c.query(
        `select 1 from raas.acao where origem = $1 or (registro_id = $2 and data = $3 and procedimento_id = $4 and coalesce(profissional_id, 0) = coalesce($5::bigint, 0))`,
        [origem, reg, dataAcao, proc.id, prof?.id ?? null],
      );
      if (existe.rowCount) continue;
      await c.query(
        `insert into raas.acao (registro_id, data, procedimento_id, quantidade, profissional_id, cbo_codigo, local, cid_codigo, origem) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [reg, dataAcao, proc.id, Number(a.QTD) || 1, prof?.id ?? null, a.CBO || null, a.LOCAL || 'C', a.CID || null, origem],
      );
      resultado.acoes++;
    }
  }
  return resultado;
}
