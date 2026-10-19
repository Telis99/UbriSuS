// Documentos impressos da AIH: laudo para solicitação de internação (impressão automática após a inclusão
// e reimpressão), autorização em duas vias e etiquetas com a numeração (TR 1.2.37.4, 1.2.37.5, 1.2.37.12, 1.2.37.17.17).
import type { Content } from 'pdfmake/interfaces.js';
import { consultar, consultarUm } from '../../db/pool.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { codigoBarras } from '../../servicos/pdf.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { CLINICA_AIH, MOTIVO_SAIDA } from './opcoes.js';
import { CARATER_ATENDIMENTO } from '../cadastros/opcoes.js';

const rot = (lista: [string, string][], v: string | null) => (v ? (lista.find(([k]) => k === v)?.[1] ?? v) : '');
const fmt = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const fmtDh = (d?: Date | string | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).slice(0, 17) : '');
const moeda = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const CAUSAS: Record<string, string> = {
  ACIDENTE_TRANSITO: 'Acidente de trânsito',
  ACIDENTE_TRABALHO: 'Acidente de trabalho típico',
  ACIDENTE_TRAJETO: 'Acidente de trabalho de trajeto',
  VIOLENCIA: 'Violência / agressão',
  OUTRAS: 'Outras causas externas',
};

export async function dadosLaudo(id: number) {
  const l = await consultarUm(
    `select l.*, l.data_internacao::text di, l.data_saida::text ds,
            pa.nome paciente, pa.cns, pa.cpf, pa.sexo, pa.data_nascimento::text nasc, pa.nome_mae, coalesce(pa.celular, pa.telefone) telefone, pa.numero, pa.complemento, pa.cep,
            lg.nome logradouro, b.nome bairro, m.nome municipio, m.uf_sigla uf,
            us.nome unidade_solicitante, us.cnes cnes_solicitante, ue.nome unidade_executante, ue.cnes cnes_executante,
            p.codigo proc_codigo, p.nome proc_nome, pr.codigo proc_real_codigo, pr.nome proc_real_nome,
            cp.codigo || ' - ' || cp.nome cid_principal, cs.codigo || ' - ' || cs.nome cid_secundario,
            ca1.codigo || ' - ' || ca1.nome cid_associado1, ca2.codigo || ' - ' || ca2.nome cid_associado2,
            ps.nome solicitante, ps.conselho sol_conselho, ps.registro_conselho sol_registro, (select x.cns from cad.pessoa x where x.id = ps.pessoa_id) sol_cns,
            pz.nome autorizador, pz.conselho aut_conselho, pz.registro_conselho aut_registro, (select x.cns from cad.pessoa x where x.id = pz.pessoa_id) aut_cns,
            oe.codigo orgao_codigo, oe.nome orgao_nome,
            (select coalesce(o.nome, o.login) from seg.operador o where o.id = l.aprovado_por) aprovador
       from aih.laudo l join cad.pessoa pa on pa.id = l.paciente_id
       left join cad.logradouro lg on lg.id = pa.logradouro_id left join cad.bairro b on b.id = pa.bairro_id left join cad.municipio m on m.id = pa.municipio_id
       left join cad.unidade us on us.id = l.unidade_solicitante_id left join cad.unidade ue on ue.id = l.unidade_executante_id
       join cad.procedimento p on p.id = l.procedimento_id left join cad.procedimento pr on pr.id = l.procedimento_realizado_id
       left join cad.cid cp on cp.id = l.cid_principal_id left join cad.cid cs on cs.id = l.cid_secundario_id
       left join cad.cid ca1 on ca1.id = l.cid_associado1_id left join cad.cid ca2 on ca2.id = l.cid_associado2_id
       left join cad.profissional ps on ps.id = l.profissional_solicitante_id left join cad.profissional pz on pz.id = l.autorizador_id
       left join aih.orgao_emissor oe on oe.id = l.orgao_emissor_id
      where l.id = $1`,
    [id],
  );
  if (!l) throw new ErroHttp(404, 'Laudo de AIH não encontrado.');
  return l;
}

const secao = (titulo: string): Content => ({ text: titulo, style: 'h2', fillColor: '#e8eef5', margin: [0, 8, 0, 2] });
const grade = (linhas: [string, string][][]): Content => ({
  stack: linhas.map((l) => ({
    table: { widths: Array(l.length).fill('*'), body: [l.map(([r, v]) => ({ stack: [{ text: r, fontSize: 6.5, color: '#555' }, { text: v || ' ', fontSize: 8.5 }] }))] },
    layout: { hLineColor: () => '#bbb', vLineColor: () => '#bbb' },
  })),
});

function blocoPaciente(l: any): Content[] {
  return [
    secao('Identificação do paciente'),
    grade([
      [['Nome do paciente', l.paciente], ['Nº do prontuário', l.prontuario ?? '']],
      [['Cartão Nacional de Saúde', l.cns ?? ''], ['Data de nascimento', fmt(l.nasc)], ['Sexo', l.sexo === 'F' ? 'Feminino' : l.sexo === 'M' ? 'Masculino' : '']],
      [['Nome da mãe', l.nome_mae ?? ''], ['Telefone', l.telefone ?? '']],
      [['Endereço', `${l.logradouro ?? ''} ${l.numero ?? ''} ${l.complemento ?? ''} - ${l.bairro ?? ''}`], ['Município / UF', `${l.municipio ?? ''} / ${l.uf ?? ''}`], ['CEP', l.cep ?? '']],
    ]),
  ];
}

/** Laudo para solicitação de AIH (modelo do Ministério da Saúde). */
export async function pdfLaudo(id: number, u: Usuario) {
  const l = await dadosLaudo(id);
  const barras = await codigoBarras(l.numero_laudo ?? String(id));
  return emitirDocumento(
    { relatorio: 'aih:laudo', titulo: 'Laudo para solicitação de autorização de internação hospitalar', filtros: { laudo: id, emissao: Date.now() } },
    [
      { columns: [{ text: `Laudo nº ${l.numero_laudo}   ·   ${fmtDh(l.data_hora)}`, bold: true }, { image: barras, width: 150, alignment: 'right' }] },
      secao('Identificação do estabelecimento'),
      grade([[['Estabelecimento solicitante', l.unidade_solicitante ?? ''], ['CNES', l.cnes_solicitante ?? '']], [['Estabelecimento executante', l.unidade_executante ?? ''], ['CNES', l.cnes_executante ?? '']]]),
      ...blocoPaciente(l),
      secao('Justificativa da internação'),
      grade([[['Principais sinais e sintomas clínicos', l.sinais_sintomas ?? '']], [['Condições que justificam a internação', l.condicoes_internacao ?? '']], [['Principais resultados de provas diagnósticas', l.resultados_provas ?? '']]]),
      grade([
        [['Diagnóstico inicial', l.diagnostico_inicial ?? ''], ['CID-10 principal', l.cid_principal ?? '']],
        [['CID-10 secundário', l.cid_secundario ?? ''], ['CID-10 causas associadas', [l.cid_associado1, l.cid_associado2].filter(Boolean).join('; ')]],
      ]),
      secao('Procedimento solicitado'),
      grade([[['Código', l.proc_codigo], ['Descrição do procedimento', l.proc_nome]], [['Clínica', rot(CLINICA_AIH, l.clinica)], ['Caráter da internação', rot(CARATER_ATENDIMENTO, l.carater)]]]),
      secao('Causas externas (acidentes ou violências)'),
      grade([
        [['Tipo', l.causa_externa ? CAUSAS[l.causa_externa] : 'Não se aplica'], ['CNPJ da seguradora', l.cnpj_seguradora ?? ''], ['Nº do bilhete', l.numero_bilhete ?? '']],
        [['CNPJ da empresa', l.cnpj_empresa ?? ''], ['CNAE da empresa', l.cnae_empresa ?? ''], ['Vínculo com a previdência', l.vinculo_previdencia ?? '']],
      ]),
      secao('Profissional solicitante'),
      grade([[['Nome', l.solicitante ?? ''], ['Documento (CNS)', l.sol_cns ?? ''], ['Conselho', `${l.sol_conselho ?? ''} ${l.sol_registro ?? ''}`], ['Data da solicitação', fmtDh(l.data_hora)]]]),
      { text: '_____________________________________________', alignment: 'center', margin: [0, 28, 0, 0] },
      { text: 'Assinatura e carimbo do profissional solicitante', alignment: 'center', fontSize: 7 },
      secao('Autorização'),
      grade([
        [['Situação', l.situacao], ['Nº da AIH', l.numero_aih ?? ''], ['Órgão emissor', l.orgao_codigo ?? '']],
        [['Profissional autorizador', l.autorizador ?? ''], ['Data da autorização', fmtDh(l.autorizado_em)], ['Documento (CNS)', l.aut_cns ?? '']],
      ]),
    ],
    {},
    u,
  );
}

/** Autorização de AIH em duas vias: paciente, solicitação/autorização, autorizador e número (TR 1.2.37.12). */
export async function pdfAutorizacao(id: number, u: Usuario) {
  const l = await dadosLaudo(id);
  if (!l.numero_aih) throw new ErroHttp(409, 'Laudo ainda não autorizado.');
  const barras = await codigoBarras(l.numero_aih);
  const via = (nome: string, quebra: boolean): Content[] => [
    { columns: [{ text: `AUTORIZAÇÃO DE INTERNAÇÃO HOSPITALAR - ${nome}`, bold: true, fontSize: 10 }, { image: barras, width: 150, alignment: 'right' }], pageBreak: quebra ? 'before' : undefined } as Content,
    { text: `Nº DA AIH: ${l.numero_aih}`, fontSize: 16, bold: true, margin: [0, 4, 0, 4] },
    ...blocoPaciente(l),
    secao('Solicitação'),
    grade([
      [['Laudo nº', l.numero_laudo], ['Data da solicitação', fmtDh(l.data_hora)], ['Caráter', rot(CARATER_ATENDIMENTO, l.carater)], ['Clínica', rot(CLINICA_AIH, l.clinica)]],
      [['Estabelecimento solicitante', `${l.unidade_solicitante ?? ''} (CNES ${l.cnes_solicitante ?? ''})`], ['Estabelecimento executante', `${l.unidade_executante ?? ''} (CNES ${l.cnes_executante ?? ''})`]],
      [['Procedimento autorizado', `${l.proc_codigo} - ${l.proc_nome}`], ['CID-10 principal', l.cid_principal ?? '']],
      [['Profissional solicitante', `${l.solicitante ?? ''} ${l.sol_conselho ?? ''} ${l.sol_registro ?? ''}`], ['Valor estimado (SH + SP)', `${moeda(l.valor_sh)} + ${moeda(l.valor_sp)} = ${moeda(l.valor_total)}`]],
    ]),
    secao('Autorização'),
    grade([
      [['Órgão emissor', `${l.orgao_codigo ?? ''} - ${l.orgao_nome ?? ''}`], ['Data da autorização', fmtDh(l.autorizado_em)]],
      [['Profissional autorizador', l.autorizador ?? ''], ['Conselho', `${l.aut_conselho ?? ''} ${l.aut_registro ?? ''}`], ['CNS do autorizador', l.aut_cns ?? '']],
    ]),
    { text: '_____________________________________________', alignment: 'center', margin: [0, 30, 0, 0] },
    { text: 'Assinatura e carimbo do autorizador', alignment: 'center', fontSize: 7 },
  ];
  return emitirDocumento(
    { relatorio: 'aih:autorizacao', titulo: 'Autorização de internação hospitalar (AIH)', filtros: { laudo: id, emissao: Date.now() } },
    [...via('1ª VIA - ESTABELECIMENTO EXECUTANTE', false), ...via('2ª VIA - PACIENTE / SOLICITANTE', true)],
    {},
    u,
  );
}

/** Etiquetas com o número de cada AIH autorizada e o nome do paciente (TR 1.2.37.17.17). */
export async function pdfEtiquetas(f: { ids?: number[]; de?: string; ate?: string; unidadeId?: number | null }, u: Usuario) {
  const linhas = await consultar(
    `select l.numero_aih, pa.nome, pa.cns, l.prontuario, l.autorizado_em::date::text data, ue.nome executante
       from aih.laudo l join cad.pessoa pa on pa.id = l.paciente_id left join cad.unidade ue on ue.id = l.unidade_executante_id
      where l.numero_aih is not null and (cardinality($1::bigint[]) = 0 or l.id = any($1))
        and ($2::date is null or l.autorizado_em::date >= $2) and ($3::date is null or l.autorizado_em::date <= $3)
        and ($4::bigint is null or l.unidade_executante_id = $4)
      order by l.numero_aih`,
    [f.ids ?? [], f.de ?? null, f.ate ?? null, f.unidadeId ?? null],
  );
  if (!linhas.length) throw new ErroHttp(422, 'Nenhuma AIH autorizada para os filtros informados.');
  const etiquetas: Content[] = [];
  for (const l of linhas) {
    etiquetas.push({
      stack: [
        { text: `AIH ${l.numero_aih}`, bold: true, fontSize: 11 },
        { image: await codigoBarras(l.numero_aih), width: 150, margin: [0, 2, 0, 2] },
        { text: l.nome, fontSize: 8, bold: true },
        { text: `CNS ${l.cns ?? '-'} · Pront. ${l.prontuario ?? '-'} · ${fmt(l.data)}`, fontSize: 6.5 },
        { text: l.executante ?? '', fontSize: 6.5 },
      ],
      margin: [4, 6, 4, 6],
    } as Content);
  }
  const linhasTabela: Content[][] = [];
  for (let i = 0; i < etiquetas.length; i += 3) linhasTabela.push([etiquetas[i], etiquetas[i + 1] ?? '', etiquetas[i + 2] ?? '']);
  return emitirDocumento(
    { relatorio: 'aih:etiquetas', titulo: 'Etiquetas de AIH autorizadas', filtros: { ...f, emissao: Date.now() } },
    [{ table: { widths: ['*', '*', '*'], dontBreakRows: true, body: linhasTabela }, layout: { hLineColor: () => '#ccc', vLineColor: () => '#ccc', hLineStyle: () => ({ dash: { length: 3 } }) } } as any],
    { margens: [20, 90, 20, 50] },
    u,
  );
}

export const rotuloMotivoSaida = (v: string | null) => rot(MOTIVO_SAIDA, v);
