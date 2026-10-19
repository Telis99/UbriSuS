// Boletim de Produção Ambulatorial no layout do SIA/SUS (BPA magnético): cabeçalho, BPA consolidado (02)
// e individualizado (03), campo de controle, geração agrupada ou por unidade e importação de prestadores.
// Arquivo pronto para o sistema externo, sem redigitação (TR 1.1.1.42).
import type pg from 'pg';
import { ErroHttp } from '../../seguranca/usuario.js';
import { parametro } from '../cadastros/alertas.js';
import { validarProcedimento } from './producao.js';

const LINHAS_POR_FOLHA = 20;
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/** Texto sem acentos, maiúsculo, alinhado à esquerda com espaços. */
export function alfa(v: unknown, n: number) {
  const s = String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .toUpperCase();
  return s.slice(0, n).padEnd(n, ' ');
}
/** Número com zeros à esquerda. */
export function num(v: unknown, n: number) {
  const s = String(v ?? '').replace(/\D/g, '');
  return s.slice(-n).padStart(n, '0');
}
const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export interface OrgaoResponsavel {
  nome: string;
  sigla: string;
  cnpj: string;
  destino: string;
  indicador: 'M' | 'E';
}

export interface ResultadoBpa {
  conteudo: Buffer;
  nome: string;
  linhas: number;
  folhas: number;
  controle: string;
  consolidado: number;
  individualizado: number;
  ids: number[];
}

/** Campo de controle do SIA: (soma dos códigos de procedimento + soma das quantidades) mod 1111 + 1111. */
export function campoControle(itens: { procedimento: string; quantidade: number }[]) {
  const soma = itens.reduce((s, i) => s + Number(digitos(i.procedimento)) + Number(i.quantidade), 0);
  return String((soma % 1111) + 1111);
}

export async function gerarBpa(c: pg.PoolClient, competencia: string, unidadeId: number | null, incluirCriticas = false): Promise<ResultadoBpa> {
  if (!/^\d{6}$/.test(competencia)) throw new ErroHttp(422, 'Competência inválida (AAAAMM).');
  const filtroUnidade = unidadeId ? `and coalesce(u.unidade_faturamento_id, u.id) = ${Number(unidadeId)}` : '';
  const situacoes = incluirCriticas ? `('VALIDO','CRITICA','EXPORTADO')` : `('VALIDO','EXPORTADO')`;
  // Consolidado: agrupado por CNES, CBO, procedimento e idade.
  const consolidado = (
    await c.query(
      `select coalesce(uf.cnes, u.cnes) cnes, coalesce(p.cbo_codigo, '') cbo, pr.codigo procedimento, coalesce(case when coalesce(pr.idade_minima_meses, 0) > 0 or coalesce(pr.idade_maxima_meses, 9999) < 1560 then p.idade end, 0) idade,
              sum(p.quantidade)::int quantidade, array_agg(p.id) ids
         from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id join cad.unidade u on u.id = p.unidade_id
         left join cad.unidade uf on uf.id = u.unidade_faturamento_id
        where p.competencia = $1 and p.instrumento = 'BPA_C' and p.situacao in ${situacoes} ${filtroUnidade}
        group by 1,2,3,4 order by 1,3,2,4`,
      [competencia],
    )
  ).rows;
  const individual = (
    await c.query(
      `select p.id, coalesce(uf.cnes, u.cnes) cnes, to_char(p.data, 'YYYYMMDD') data, coalesce(p.cbo_codigo, '') cbo, pr.codigo procedimento, p.quantidade, p.idade, p.cid_codigo, p.carater, p.ine,
              (select pp.cns from cad.pessoa pp join cad.profissional pf on pf.pessoa_id = pp.id where pf.id = p.profissional_id) cns_profissional,
              pa.cns, pa.cpf, pa.nome, pa.sexo, to_char(pa.data_nascimento, 'YYYYMMDD') nascimento, pa.raca_cor, et.codigo etnia, pa.nacionalidade,
              (select ps.codigo from cad.pais ps where ps.id = pa.pais_id) pais, m.codigo_ibge municipio, pa.cep, tl.codigo tipo_logradouro, lg.nome logradouro, pa.numero, pa.complemento,
              b.nome bairro, coalesce(pa.celular, pa.telefone) telefone, pa.email, u.cpf_cnpj cnpj
         from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id join cad.unidade u on u.id = p.unidade_id
         left join cad.unidade uf on uf.id = u.unidade_faturamento_id
         join cad.pessoa pa on pa.id = p.paciente_id left join cad.municipio m on m.id = pa.municipio_id left join cad.etnia et on et.id = pa.etnia_id
         left join cad.logradouro lg on lg.id = pa.logradouro_id left join cad.tipo_logradouro tl on tl.id = lg.tipo_logradouro_id left join cad.bairro b on b.id = pa.bairro_id
        where p.competencia = $1 and p.instrumento = 'BPA_I' and p.situacao in ${situacoes} ${filtroUnidade}
        order by 2, p.data, p.id`,
      [competencia],
    )
  ).rows;
  if (!consolidado.length && !individual.length) throw new ErroHttp(422, 'Não há produção válida nesta competência para gerar o BPA.');

  const linhas: string[] = [];
  const controle: { procedimento: string; quantidade: number }[] = [];
  // BPA-C: folhas de 20 linhas, numeradas por estabelecimento.
  let cnesAtual = '';
  let folha = 0;
  let seq = 0;
  for (const r of consolidado) {
    if (r.cnes !== cnesAtual || seq === LINHAS_POR_FOLHA) {
      if (r.cnes !== cnesAtual) folha = 0;
      cnesAtual = r.cnes;
      folha++;
      seq = 0;
    }
    seq++;
    linhas.push(['02', num(r.cnes, 7), num(competencia, 6), alfa(r.cbo, 6), num(folha, 3), num(seq, 2), num(r.procedimento, 10), num(r.idade, 3), num(r.quantidade, 6), 'BPA'].join(''));
    controle.push({ procedimento: r.procedimento, quantidade: r.quantidade });
  }
  const folhasC = consolidado.length ? Math.ceil(consolidado.length / LINHAS_POR_FOLHA) : 0;
  // BPA-I: uma linha por atendimento.
  cnesAtual = '';
  folha = 0;
  seq = 0;
  for (const r of individual) {
    if (r.cnes !== cnesAtual || seq === LINHAS_POR_FOLHA) {
      if (r.cnes !== cnesAtual) folha = 0;
      cnesAtual = r.cnes;
      folha++;
      seq = 0;
    }
    seq++;
    const nacionalidade = r.pais ? num(r.pais, 3) : '010';
    linhas.push(
      [
        '03',
        num(r.cnes, 7),
        num(competencia, 6),
        alfa(digitos(r.cns_profissional), 15),
        alfa(r.cbo, 6),
        num(r.data, 8),
        num(folha, 3),
        num(seq, 2),
        num(r.procedimento, 10),
        alfa(digitos(r.cns), 15),
        alfa(r.sexo, 1),
        alfa(r.municipio ? String(r.municipio).slice(0, 6) : '', 6),
        alfa(r.cid_codigo ? String(r.cid_codigo).replace('.', '').slice(0, 4) : '', 4),
        num(r.idade ?? 0, 3),
        num(r.quantidade, 6),
        num(r.carater ?? '01', 2),
        alfa('', 13),
        'BPA',
        alfa(r.nome, 30),
        num(r.nascimento, 8),
        num(r.raca_cor ?? '99', 2),
        alfa(r.raca_cor === '05' ? (r.etnia ?? '') : '', 4),
        nacionalidade,
        alfa('', 3),
        alfa('', 3),
        alfa('', 8),
        alfa('', 4),
        alfa(digitos(r.cnpj).length === 14 ? digitos(r.cnpj) : '', 14),
        alfa(digitos(r.cep), 8),
        alfa(r.tipo_logradouro ?? '', 3),
        alfa(r.logradouro, 30),
        alfa(r.complemento, 10),
        alfa(r.numero, 5),
        alfa(r.bairro, 30),
        alfa(digitos(r.telefone), 11),
        alfa(r.email, 40),
        alfa(r.ine, 10),
        alfa(digitos(r.cpf), 11),
      ].join(''),
    );
    controle.push({ procedimento: r.procedimento, quantidade: r.quantidade });
  }
  const folhasI = individual.length ? Math.ceil(individual.length / LINHAS_POR_FOLHA) : 0;
  const orgao = await parametro<OrgaoResponsavel>('faturamento.orgao', { nome: 'SECRETARIA MUNICIPAL DE SAUDE', sigla: 'SMS', cnpj: '', destino: 'SECRETARIA MUNICIPAL DE SAUDE', indicador: 'M' });
  const cc = campoControle(controle);
  const cabecalho = [
    '01',
    '#BPA#',
    num(competencia, 6),
    num(linhas.length, 6),
    num(folhasC + folhasI, 6),
    num(cc, 4),
    alfa(orgao.nome, 30),
    alfa(orgao.sigla, 6),
    num(orgao.cnpj, 14),
    alfa(orgao.destino, 40),
    alfa(orgao.indicador, 1),
    alfa('UBRISUS10', 10),
  ].join('');
  const texto = [cabecalho, ...linhas].join('\r\n') + '\r\n';
  const mes = MESES[Number(competencia.slice(4)) - 1];
  return {
    conteudo: Buffer.from(texto, 'latin1'),
    nome: `PA${competencia.slice(2)}${unidadeId ? `_${unidadeId}` : ''}.${mes}`,
    linhas: linhas.length,
    folhas: folhasC + folhasI,
    controle: cc,
    consolidado: consolidado.length,
    individualizado: individual.length,
    ids: [...consolidado.flatMap((r) => r.ids), ...individual.map((r) => r.id)],
  };
}

/** Importação do BPA de prestadores com críticas de unidade, paciente e procedimento (TR 1.2.13.1.26). */
export async function importarBpa(c: pg.PoolClient, conteudo: string) {
  const linhas = conteudo.split(/\r?\n/).filter((l) => l.trim());
  if (!linhas[0]?.startsWith('01#BPA#')) throw new ErroHttp(422, 'Arquivo não está no layout BPA (cabeçalho 01#BPA#).');
  const competencia = linhas[0].slice(7, 13);
  const resultado = { competencia, importadas: 0, criticas: [] as string[] };
  const cache = new Map<string, any>();
  const buscar = async (sql: string, v: string) => {
    const k = sql + v;
    if (!cache.has(k)) cache.set(k, (await c.query(sql, [v])).rows[0] ?? null);
    return cache.get(k);
  };
  for (const [i, l] of linhas.slice(1).entries()) {
    const tipo = l.slice(0, 2);
    const cnes = l.slice(2, 9);
    const unidade = await buscar(`select id from cad.unidade where cnes = $1`, cnes);
    const criticas: string[] = [];
    if (!unidade) criticas.push(`CNES ${cnes} não cadastrado.`);
    let procCodigo: string;
    let quantidade: number;
    let paciente: any = null;
    let cbo: string;
    let data: string;
    let idade: number | null = null;
    if (tipo === '02') {
      cbo = l.slice(15, 21).trim();
      procCodigo = l.slice(26, 36);
      idade = Number(l.slice(36, 39));
      quantidade = Number(l.slice(39, 45));
      data = `${competencia.slice(0, 4)}-${competencia.slice(4)}-01`;
    } else if (tipo === '03') {
      cbo = l.slice(30, 36).trim();
      const d = l.slice(36, 44);
      data = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      procCodigo = l.slice(49, 59);
      const cns = l.slice(59, 74).trim();
      paciente = cns ? await buscar(`select id, sexo, data_nascimento::text data_nascimento from cad.pessoa where cns = $1`, cns) : null;
      if (!paciente) criticas.push(`Paciente CNS ${cns || '(vazio)'} não cadastrado.`);
      idade = Number(l.slice(89, 92));
      quantidade = Number(l.slice(92, 98));
    } else {
      resultado.criticas.push(`Linha ${i + 2}: tipo de registro ${tipo} desconhecido.`);
      continue;
    }
    const proc = await buscar(`select * from cad.procedimento where codigo = $1`, procCodigo);
    if (!proc) criticas.push(`Procedimento ${procCodigo} inexistente na tabela SIGTAP.`);
    else criticas.push(...(await validarProcedimento(c, proc, paciente, cbo || null, new Date(data + 'T12:00:00'))).criticas);
    if (criticas.length) resultado.criticas.push(`Linha ${i + 2}: ${criticas.join(' ')}`);
    if (!unidade || !proc) continue;
    await c.query(
      `insert into fat.producao (competencia, data, unidade_id, cbo_codigo, procedimento_id, quantidade, paciente_id, idade, instrumento, origem, referencia, situacao, critica, valor)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IMPORTACAO',$10,$11,$12,$13)`,
      [
        competencia,
        data,
        unidade.id,
        cbo || null,
        proc.id,
        quantidade,
        paciente?.id ?? null,
        idade,
        tipo === '02' ? 'BPA_C' : 'BPA_I',
        `importacao:${competencia}`,
        criticas.length ? 'CRITICA' : 'VALIDO',
        criticas.join(' ') || null,
        Number(proc.valor_municipal ?? proc.valor_sa ?? 0) * quantidade,
      ],
    );
    resultado.importadas++;
  }
  return resultado;
}

/** Revalida a produção da competência com as regras SIGTAP vigentes. */
export async function revalidarCompetencia(c: pg.PoolClient, competencia: string) {
  const prods = (
    await c.query(
      `select pr.*, p.id prod_id, p.data::text data_prod, p.cbo_codigo, pa.sexo pac_sexo, pa.data_nascimento::text pac_nasc from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id
         left join cad.pessoa pa on pa.id = p.paciente_id where p.competencia = $1 and p.situacao <> 'EXPORTADO'`,
      [competencia],
    )
  ).rows;
  let criticas = 0;
  for (const p of prods) {
    const v = await validarProcedimento(c, p, p.pac_sexo ? { sexo: p.pac_sexo, data_nascimento: p.pac_nasc } : null, p.cbo_codigo, new Date(p.data_prod + 'T12:00:00'));
    if (!v.valido) criticas++;
    await c.query(`update fat.producao set situacao = $2, critica = $3 where id = $1`, [p.prod_id, v.valido ? 'VALIDO' : 'CRITICA', v.criticas.join(' ') || null]);
  }
  return { total: prods.length, criticas };
}
