// Exportação CDS/RAS para o e-SUS AB PEC no padrão LEDI AB (4.x): cada ficha é um XML
// dadoTransporteTransportXml (uuidDadoSerializado, tipoDadoSerializado, codIbge, cnesDadoSerializado,
// ineDadoSerializado, remetente, originadora, versao) com o elemento da ficha correspondente, e o lote
// é entregue compactado (zip) para importação no PEC. Os dados são gerados dos próprios módulos, sem
// digitação: cadastros (pessoa/família), atendimentos (individual e odontológico), produção (procedimentos),
// visitas do ACS, vacinação, atividades coletivas/reuniões, marcadores de consumo alimentar, elegibilidade e
// atendimento domiciliar. O envio pode ser total ou parcial a partir da última exportação.
// (TR 1.2.13.1.2 a 1.2.13.1.14, 1.2.13.1.38)
//
// Observação: o formato oficial de transmissão do LEDI é a serialização Thrift; o PEC também importa o mesmo
// modelo de dados em XML, que é o formato gerado aqui, mantendo os nomes dos elementos do dicionário LEDI.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import AdmZip from 'adm-zip';
import { parametro } from '../cadastros/alertas.js';

export const FICHAS: Record<string, { tipo: number; elemento: string; ns: string; titulo: string }> = {
  CADASTRO_INDIVIDUAL: { tipo: 2, elemento: 'cadastroIndividualTransport', ns: 'http://esus.ufsc.br/cadastroindividual', titulo: 'Cadastro individual' },
  CADASTRO_DOMICILIAR: { tipo: 3, elemento: 'cadastroDomiciliarTransport', ns: 'http://esus.ufsc.br/cadastrodomiciliar', titulo: 'Cadastro domiciliar e territorial' },
  ATENDIMENTO_INDIVIDUAL: { tipo: 4, elemento: 'fichaAtendimentoIndividualMasterTransport', ns: 'http://esus.ufsc.br/fichaatendimentoindividualmaster', titulo: 'Atendimento individual' },
  ATENDIMENTO_ODONTOLOGICO: { tipo: 5, elemento: 'fichaAtendimentoOdontologicoMasterTransport', ns: 'http://esus.ufsc.br/fichaatendimentoodontologicomaster', titulo: 'Atendimento odontológico' },
  ATIVIDADE_COLETIVA: { tipo: 6, elemento: 'fichaAtividadeColetivaTransport', ns: 'http://esus.ufsc.br/fichaatividadecoletiva', titulo: 'Atividade coletiva' },
  PROCEDIMENTOS: { tipo: 7, elemento: 'fichaProcedimentoMasterTransport', ns: 'http://esus.ufsc.br/fichaprocedimentomaster', titulo: 'Procedimentos' },
  VISITA_DOMICILIAR: { tipo: 8, elemento: 'fichaVisitaDomiciliarMasterTransport', ns: 'http://esus.ufsc.br/fichavisitadomiciliarmaster', titulo: 'Visita domiciliar e territorial' },
  ATENDIMENTO_DOMICILIAR: { tipo: 10, elemento: 'fichaAtendimentoDomiciliarMasterTransport', ns: 'http://esus.ufsc.br/fichaatendimentodomiciliarmaster', titulo: 'Atendimento domiciliar' },
  ELEGIBILIDADE: { tipo: 11, elemento: 'fichaAvaliacaoElegibilidadeTransport', ns: 'http://esus.ufsc.br/fichaavaliacaoelegibilidade', titulo: 'Avaliação de elegibilidade e admissão' },
  CONSUMO_ALIMENTAR: { tipo: 12, elemento: 'fichaConsumoAlimentarTransport', ns: 'http://esus.ufsc.br/fichaconsumoalimentar', titulo: 'Marcadores de consumo alimentar' },
  VACINACAO: { tipo: 14, elemento: 'fichaVacinacaoMasterTransport', ns: 'http://esus.ufsc.br/fichavacinacaomaster', titulo: 'Vacinação' },
};
export type TipoFicha = keyof typeof FICHAS;

export interface FiltroExportacao {
  fichas: TipoFicha[];
  modalidade: 'TOTAL' | 'PARCIAL';
  de: string;
  ate: string;
  unidadeId: number | null;
}

interface Item {
  origem: string;
  cnes: string;
  ine: string | null;
  corpo: (uuid: string) => string;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------
const esc = (v: unknown) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Elemento XML; valores nulos/vazios são omitidos (campos opcionais do LEDI). */
export function el(tag: string, conteudo: unknown): string {
  if (conteudo === null || conteudo === undefined || conteudo === '') return '';
  if (Array.isArray(conteudo)) return conteudo.map((c) => el(tag, c)).join('');
  if (typeof conteudo === 'object') return `<${tag}>${Object.entries(conteudo as Record<string, unknown>).map(([k, v]) => el(k, v)).join('')}</${tag}>`;
  return `<${tag}>${esc(conteudo)}</${tag}>`;
}
/** Datas no LEDI: milissegundos desde 1970 (long). */
const epoch = (d: unknown) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00-03:00` : String(d)).getTime() : null);
const sexo = (s?: string | null) => (s === 'M' ? 0 : s === 'F' ? 1 : 4);
const raca = (r?: string | null) => ({ '01': 1, '02': 2, '03': 3, '04': 4, '05': 5 })[r ?? ''] ?? 6;
const turno = (d: unknown) => {
  const h = d ? new Date(String(d)).getUTCHours() - 3 : 9;
  return h < 12 ? 1 : h < 18 ? 2 : 3;
};
const digitos = (v: unknown) => String(v ?? '').replace(/\D/g, '') || null;
const cid4 = (v?: string | null) => (v ? v.replace('.', '') : null);
const header = (h: { cns?: string | null; cbo?: string | null; cnes: string; ine?: string | null; data: unknown; ibge?: string | null }) => ({
  profissionalCNS: digitos(h.cns),
  cboCodigo_2002: h.cbo,
  cnes: h.cnes,
  ine: h.ine,
  dataAtendimento: epoch(h.data),
  codigoIbgeMunicipio: h.ibge,
});

// Motivos de visita do ACS -> códigos do dicionário LEDI.
const MOTIVO_VISITA: Record<string, number> = {
  CADASTRAMENTO: 1, VISITA_PERIODICA: 2, BUSCA_CONSULTA: 3, BUSCA_EXAME: 4, BUSCA_VACINA: 5, BUSCA_BOLSA_FAMILIA: 6, GESTANTE: 7, PUERPERA: 8, RECEM_NASCIDO: 9,
  CRIANCA: 10, DESNUTRICAO: 11, REABILITACAO: 12, HIPERTENSAO: 13, DIABETES: 14, ASMA: 15, DPOC: 16, CANCER: 17, OUTRAS_CRONICAS: 18, HANSENIASE: 19, TUBERCULOSE: 20,
  ACAMADO: 21, VULNERABILIDADE: 22, SAUDE_MENTAL: 24, ALCOOL: 25, DROGAS: 26, SINTOMATICO_RESPIRATORIO: 27, EGRESSO_INTERNACAO: 28, CONTROLE_AMBIENTAL: 29,
  CONVITE_ATIVIDADES: 30, ORIENTACAO: 31, OUTROS: 32, TABAGISTA: 33,
};
const CONDUTA_ATENDIMENTO: Record<string, number> = { ALTA: 9, RETORNO_AGENDADO: 1, CUIDADO_CONTINUADO: 2, GRUPOS: 4, ENCAMINHAMENTO: 11, INTERNACAO: 13, OBSERVACAO: 10, OBSERVACAO_LONGA: 10, OBITO: 9, EVASAO: 9 };

/** Filtro parcial: registro ainda não exportado ou alterado após a última exportação. */
const parcial = (ficha: string, origemSql: string, alteradoSql: string) =>
  `not exists (select 1 from esus.registro_exportado x where x.ficha = '${ficha}' and x.origem = ${origemSql} and x.exportado_em >= coalesce(${alteradoSql}, '-infinity'::timestamptz))`;

async function existe(c: pg.PoolClient, tabela: string) {
  return !!(await c.query(`select to_regclass($1) t`, [tabela])).rows[0].t;
}

// ---------------------------------------------------------------------------
// Fichas
// ---------------------------------------------------------------------------
const PESSOA = `pa.nome, pa.nome_social, pa.data_nascimento::text nasc, pa.sexo, pa.raca_cor, pa.nome_mae, pa.cns, pa.cpf, pa.prontuario, pa.celular, pa.email, pa.microarea,
  (select m.codigo_ibge from cad.municipio m where m.id = pa.municipio_nascimento_id) ibge_nasc, pa.nacionalidade, pa.condicoes_saude, pa.escolaridade, pa.situacao_trabalho`;

const geradores: Record<TipoFicha, (c: pg.PoolClient, f: FiltroExportacao, ibge: string) => Promise<Item[]>> = {
  async CADASTRO_INDIVIDUAL(c, f, ibge) {
    const rows = (
      await c.query(
        `select pa.id, ${PESSOA}, coalesce(u.cnes, '0000000') cnes, pa.criado_em, pa.atualizado_em
           from cad.pessoa pa left join cad.unidade u on u.id = pa.unidade_referencia_id
          where pa.situacao in ('ATIVO','FALECIDO','MUDOU') and pa.id not in (select pessoa_id from seg.operador)
            and ($1::bigint is null or pa.unidade_referencia_id = $1) and ($2 = 'TOTAL' or ${parcial('CADASTRO_INDIVIDUAL', `'pessoa:' || pa.id`, 'coalesce(pa.atualizado_em, pa.criado_em)')})`,
        [f.unidadeId, f.modalidade],
      )
    ).rows;
    return rows.map((p) => ({
      origem: `pessoa:${p.id}`,
      cnes: p.cnes,
      ine: null,
      corpo: (uuid) =>
        el('identificacaoUsuarioCidadao', {
          nomeCidadao: p.nome,
          nomeSocial: p.nome_social,
          dataNascimentoCidadao: epoch(p.nasc),
          sexoCidadao: sexo(p.sexo),
          racaCorCidadao: raca(p.raca_cor),
          nomeMaeCidadao: p.nome_mae,
          desconheceNomeMae: p.nome_mae ? 'false' : 'true',
          cnsCidadao: digitos(p.cns),
          cpfCidadao: digitos(p.cpf),
          telefoneCelular: digitos(p.celular),
          emailCidadao: p.email,
          nacionalidadeCidadao: p.nacionalidade === '3' ? 3 : p.nacionalidade === '2' ? 2 : 1,
          codigoIbgeMunicipioNascimento: p.ibge_nasc,
          microArea: p.microarea,
          stForaArea: p.microarea ? 'false' : 'true',
          numeroProntuario: p.prontuario,
        }) +
        el('condicoesDeSaude', {
          statusTemHipertensaoArterial: String((p.condicoes_saude ?? []).includes('hipertensao')),
          statusTemDiabetes: String((p.condicoes_saude ?? []).includes('diabetes')),
          statusEhGestante: String((p.condicoes_saude ?? []).includes('gestante')),
          statusEhFumante: String((p.condicoes_saude ?? []).includes('fumante')),
        }) +
        el('informacoesSocioDemograficas', { grauInstrucaoCidadao: p.escolaridade, situacaoMercadoTrabalhoCidadao: p.situacao_trabalho }) +
        el('fichaAtualizada', p.atualizado_em ? 'true' : 'false') +
        el('statusTermoRecusaCadastroIndividualAtencaoBasica', 'false') +
        el('tpCdsOrigem', 3) +
        el('uuid', uuid) +
        el('headerTransport', header({ cnes: p.cnes, data: p.atualizado_em ?? p.criado_em, ibge })),
    }));
  },

  async CADASTRO_DOMICILIAR(c, f, ibge) {
    const rows = (
      await c.query(
        `select fa.*, coalesce(u.cnes, '0000000') cnes, lg.nome logradouro, tl.codigo tipo_logr, b.nome bairro, (select m.codigo_ibge from cad.municipio m where m.id = fa.municipio_id) mun,
                rp.cns cns_resp, rp.prontuario pront_resp, (select count(*)::int from cad.pessoa x where x.familia_id = fa.id) membros
           from cad.familia fa left join cad.unidade u on u.id = fa.unidade_id left join cad.logradouro lg on lg.id = fa.logradouro_id
           left join cad.tipo_logradouro tl on tl.id = lg.tipo_logradouro_id left join cad.bairro b on b.id = fa.bairro_id left join cad.pessoa rp on rp.id = fa.responsavel_id
          where fa.ativo and ($1::bigint is null or fa.unidade_id = $1) and ($2 = 'TOTAL' or ${parcial('CADASTRO_DOMICILIAR', `'familia:' || fa.id`, 'coalesce(fa.atualizado_em, fa.criado_em)')})`,
        [f.unidadeId, f.modalidade],
      )
    ).rows;
    return rows.map((d) => ({
      origem: `familia:${d.id}`,
      cnes: d.cnes,
      ine: null,
      corpo: (uuid) =>
        el('enderecoLocalPermanencia', {
          bairro: d.bairro,
          cep: digitos(d.cep),
          codigoIbgeMunicipio: d.mun ?? ibge,
          complemento: d.complemento,
          nomeLogradouro: d.logradouro,
          numero: d.numero,
          numeroDneUf: '35',
          tipoLogradouroNumeroDne: d.tipo_logr,
          stSemNumero: String(!!d.sem_numero),
          microArea: d.microarea,
          stForaArea: d.microarea ? 'false' : 'true',
        }) +
        el('condicaoMoradia', {
          abastecimentoAgua: d.abastecimento_agua,
          areaProducaoRural: null,
          destinoLixo: d.destino_lixo,
          formaEscoamentoBanheiro: d.destino_fezes,
          localizacao: d.tipo_localidade,
          materialPredominanteParedesExtDomicilio: d.tipo_parede,
          nuComodos: d.comodos,
          nuMoradores: d.membros,
          situacaoMoradiaPosseTerra: d.situacao_domicilio,
          stDisponibilidadeEnergiaEletrica: d.iluminacao ? 'true' : null,
          tipoAcessoDomicilio: d.acesso_domicilio,
          tipoDomicilio: d.tipo_domicilio,
          aguaConsumoDomicilio: d.tratamento_agua,
        }) +
        el('familias', { numeroCnsResponsavel: digitos(d.cns_resp), numeroMembrosFamilia: d.membros, numeroProntuario: d.pront_resp ?? d.codigo, rendaFamiliar: d.renda_familiar, stMudanca: 'false' }) +
        el('fichaAtualizada', d.atualizado_em ? 'true' : 'false') +
        el('tipoDeImovel', 1) +
        el('tpCdsOrigem', 3) +
        el('uuid', uuid) +
        el('headerTransport', header({ cnes: d.cnes, data: d.atualizado_em ?? d.criado_em, ibge })),
    }));
  },

  async ATENDIMENTO_INDIVIDUAL(c, f, ibge) {
    const rows = (
      await c.query(
        `select a.*, a.entrada_em, a.inicio_em, a.fim_em, ${PESSOA}, u.cnes, cb.codigo cbo, v.ine, (select x.cns from cad.pessoa x where x.id = pf.pessoa_id) cns_prof,
                ci.codigo ciap, cd.codigo cid, (select row_to_json(s) from (select peso, altura from amb.sinais_vitais s where s.atendimento_id = a.id and s.peso is not null limit 1) s) sv
           from amb.atendimento a join cad.pessoa pa on pa.id = a.paciente_id join cad.unidade u on u.id = a.unidade_id
           left join cad.profissional pf on pf.id = a.profissional_id left join cad.vinculo v on v.profissional_id = a.profissional_id and v.unidade_id = a.unidade_id and v.ativo
           left join cad.cbo cb on cb.id = v.cbo_id left join cad.ciap ci on ci.id = a.ciap_id left join cad.cid cd on cd.id = a.cid_id
          where a.situacao = 'FINALIZADO' and coalesce(a.tipo_unidade, 'AMBULATORIO') not in ('ODONTOLOGIA','CAPS') and a.entrada_em::date between $1 and $2 and ($3::bigint is null or a.unidade_id = $3)
            and ($4 = 'TOTAL' or ${parcial('ATENDIMENTO_INDIVIDUAL', `'atendimento:' || a.id`, 'coalesce(a.atualizado_em, a.criado_em)')})`,
        [f.de, f.ate, f.unidadeId, f.modalidade],
      )
    ).rows;
    return rows.map((a) => ({
      origem: `atendimento:${a.id}`,
      cnes: a.cnes,
      ine: a.ine,
      corpo: (uuid) =>
        el('headerTransport', header({ cns: a.cns_prof, cbo: a.cbo, cnes: a.cnes, ine: a.ine, data: a.entrada_em, ibge })) +
        el('atendimentosIndividuais', {
          numeroProntuario: a.prontuario,
          cnsCidadao: digitos(a.cns),
          cpfCidadao: digitos(a.cpf),
          dataNascimento: epoch(a.nasc),
          localDeAtendimento: a.tipo_unidade === 'DOMICILIAR' ? 4 : 1,
          sexo: sexo(a.sexo),
          turno: turno(a.inicio_em ?? a.entrada_em),
          tipoAtendimento: { '01': 2, '02': 5, '03': 4, '04': 5, '05': 6 }[a.tipo_atendimento_sia as string] ?? 5,
          pesoAcompanhamentoNutricional: a.sv?.peso ?? null,
          alturaAcompanhamentoNutricional: a.sv?.altura ?? null,
          problemaCondicaoAvaliada: a.ciap || a.cid ? { ciaps: a.ciap, cid10: cid4(a.cid) } : null,
          condutas: CONDUTA_ATENDIMENTO[a.desfecho as string] ?? 9,
          dataHoraInicialAtendimento: epoch(a.inicio_em ?? a.entrada_em),
          dataHoraFinalAtendimento: epoch(a.fim_em ?? a.inicio_em ?? a.entrada_em),
          uuidFicha: uuid,
        }) +
        el('uuidFicha', uuid) +
        el('tpCdsOrigem', 3),
    }));
  },

  async ATENDIMENTO_ODONTOLOGICO(c, f, ibge) {
    const odo = await existe(c, 'odo.atendimento_odonto');
    const rows = (
      await c.query(
        `select a.id, a.entrada_em, a.inicio_em, ${PESSOA}, u.cnes, cb.codigo cbo, v.ine, (select x.cns from cad.pessoa x where x.id = pf.pessoa_id) cns_prof,
                ${odo ? `(select row_to_json(o) from (select gestante, necessidades_especiais, tipo_consulta, condutas from odo.atendimento_odonto o where o.atendimento_id = a.id) o)` : 'null'} odo,
                (select json_agg(json_build_object('codigo', p.codigo, 'quantidade', fp.quantidade)) from fat.producao fp join cad.procedimento p on p.id = fp.procedimento_id where fp.referencia = 'atendimento:' || a.id) procs
           from amb.atendimento a join cad.pessoa pa on pa.id = a.paciente_id join cad.unidade u on u.id = a.unidade_id
           left join cad.profissional pf on pf.id = a.profissional_id left join cad.vinculo v on v.profissional_id = a.profissional_id and v.unidade_id = a.unidade_id and v.ativo left join cad.cbo cb on cb.id = v.cbo_id
          where a.situacao = 'FINALIZADO' and a.tipo_unidade = 'ODONTOLOGIA' and a.entrada_em::date between $1 and $2 and ($3::bigint is null or a.unidade_id = $3)
            and ($4 = 'TOTAL' or ${parcial('ATENDIMENTO_ODONTOLOGICO', `'atendimento:' || a.id`, 'coalesce(a.atualizado_em, a.criado_em)')})`,
        [f.de, f.ate, f.unidadeId, f.modalidade],
      )
    ).rows;
    return rows.map((a) => ({
      origem: `atendimento:${a.id}`,
      cnes: a.cnes,
      ine: a.ine,
      corpo: (uuid) =>
        el('headerTransport', header({ cns: a.cns_prof, cbo: a.cbo, cnes: a.cnes, ine: a.ine, data: a.entrada_em, ibge })) +
        el('atendimentosOdontologicos', {
          dtNascimento: epoch(a.nasc),
          cnsCidadao: digitos(a.cns),
          cpfCidadao: digitos(a.cpf),
          numProntuario: a.prontuario,
          gestante: String(!!a.odo?.gestante),
          necessidadesEspeciais: String(!!a.odo?.necessidades_especiais),
          localAtendimento: 1,
          tipoAtendimento: a.odo?.tipo_consulta === 'PRIMEIRA_PROGRAMATICA' ? 1 : a.odo?.tipo_consulta === 'RETORNO' ? 2 : 3,
          tiposConsultaOdonto: a.odo?.tipo_consulta === 'PRIMEIRA_PROGRAMATICA' ? 1 : a.odo?.tipo_consulta === 'MANUTENCAO' ? 3 : 2,
          procedimentosRealizados: (a.procs ?? []).map((p: any) => ({ coMsProcedimento: p.codigo, quantidade: p.quantidade })),
          sexo: sexo(a.sexo),
          turno: turno(a.inicio_em ?? a.entrada_em),
          dataHoraInicialAtendimento: epoch(a.inicio_em ?? a.entrada_em),
        }) +
        el('uuidFicha', uuid) +
        el('tpCdsOrigem', 3),
    }));
  },

  async ATIVIDADE_COLETIVA(c, f, ibge) {
    const rows = (
      await c.query(
        `select 'atividade:' || x.id origem, x.data::text data, x.turno, x.tipo_atividade, x.tema, x.publico, x.inep, x.local, x.participantes, x.participantes_ids, x.avaliacoes_alteradas,
                pr.codigo procedimento, u.cnes, cb.codigo cbo, v.ine, (select pp.cns from cad.pessoa pp where pp.id = pf.pessoa_id) cns_prof
           from esus.atividade_coletiva x join cad.unidade u on u.id = x.unidade_id left join cad.procedimento pr on pr.id = x.procedimento_id
           left join cad.profissional pf on pf.id = x.profissional_id left join cad.vinculo v on v.profissional_id = x.profissional_id and v.unidade_id = x.unidade_id and v.ativo left join cad.cbo cb on cb.id = v.cbo_id
          where x.data between $1 and $2 and ($3::bigint is null or x.unidade_id = $3) and ($4 = 'TOTAL' or ${parcial('ATIVIDADE_COLETIVA', `'atividade:' || x.id`, 'coalesce(x.atualizado_em, x.criado_em)')})
         union all
         select 'reuniao:' || r.id, r.data::text, case when r.hora_inicio < '12:00' then '1' when r.hora_inicio < '18:00' then '2' else '3' end, case when r.tipo in ('08','09') then '01' else r.tipo end,
                coalesce(left(r.pauta, 120), 'Reunião de equipe'), null, null, r.local, coalesce(jsonb_array_length(r.participantes), 0), null, 0, null, u.cnes, null, null, null
           from esus.reuniao r join cad.unidade u on u.id = r.unidade_id
          where r.situacao = 'REALIZADA' and r.data between $1 and $2 and ($3::bigint is null or r.unidade_id = $3)
            and ($4 = 'TOTAL' or ${parcial('ATIVIDADE_COLETIVA', `'reuniao:' || r.id`, 'coalesce(r.atualizado_em, r.criado_em)')})`,
        [f.de, f.ate, f.unidadeId, f.modalidade],
      )
    ).rows;
    const out: Item[] = [];
    for (const a of rows) {
      const ids: number[] = Array.isArray(a.participantes_ids) ? a.participantes_ids : [];
      const part = ids.length ? (await c.query(`select cns, data_nascimento::text nasc from cad.pessoa where id = any($1)`, [ids])).rows : [];
      out.push({
        origem: a.origem,
        cnes: a.cnes,
        ine: a.ine,
        corpo: (uuid) =>
          el('uuidFicha', uuid) +
          el('inep', a.inep) +
          el('numParticipantes', a.participantes ?? part.length) +
          el('numAvaliacoesAlteradas', a.avaliacoes_alteradas ?? 0) +
          el('profissionais', a.cns_prof ? { cnsProfissional: digitos(a.cns_prof), codigoCbo2002: a.cbo } : null) +
          el('atividadeTipo', Number(a.tipo_atividade)) +
          el('temasParaReuniao', Number(a.tipo_atividade) <= 3 ? 1 : null) +
          el('temasParaSaude', Number(a.tipo_atividade) > 3 ? 1 : null) +
          el('publicoAlvo', (a.publico ?? []).map(Number)) +
          el('participantes', part.map((p) => ({ cnsParticipante: digitos(p.cns), dataNascimento: epoch(p.nasc), avaliacaoAlterada: 'false' }))) +
          el('procedimento', a.procedimento) +
          el('turno', Number(a.turno ?? 1)) +
          el('dtAtividadeColetiva', epoch(a.data)) +
          el('outraLocalidade', a.inep ? null : a.local) +
          el('responsavelCns', digitos(a.cns_prof)) +
          el('responsavelCnesUnidade', a.cnes) +
          el('responsavelNumIne', a.ine) +
          el('cboCodigo_2002', a.cbo) +
          el('codigoIbgeMunicipio', ibge) +
          el('tbCdsOrigem', 3),
      });
    }
    return out;
  },

  async PROCEDIMENTOS(c, f, ibge) {
    const grupos = (
      await c.query(
        `select p.unidade_id, p.profissional_id, p.data::text data, u.cnes, p.cbo_codigo cbo, p.ine, (select pp.cns from cad.pessoa pp join cad.profissional pf on pf.pessoa_id = pp.id where pf.id = p.profissional_id) cns_prof,
                json_agg(json_build_object('id', p.id, 'paciente', p.paciente_id, 'codigo', pr.codigo, 'quantidade', p.quantidade, 'origem', p.origem) order by p.paciente_id) itens, max(p.criado_em) alterado
           from fat.producao p join cad.procedimento pr on pr.id = p.procedimento_id join cad.unidade u on u.id = p.unidade_id
          where p.data between $1 and $2 and ($3::bigint is null or p.unidade_id = $3)
            and (p.origem in ('PROCEDIMENTO','AFERICAO_PA','GLICEMIA','ACOLHIMENTO','COLETA') or (pr.instrumentos && array['10']::text[] and p.origem not in ('ATENDIMENTO','VACINACAO','VISITA_ACS','ODONTOLOGIA')))
            and ($4 = 'TOTAL' or ${parcial('PROCEDIMENTOS', `'procedimentos:' || p.unidade_id || ':' || coalesce(p.profissional_id, 0) || ':' || p.data`, 'p.criado_em')})
          group by 1, 2, 3, 4, 5, 6`,
        [f.de, f.ate, f.unidadeId, f.modalidade],
      )
    ).rows;
    const out: Item[] = [];
    for (const g of grupos) {
      const itens: any[] = g.itens;
      const pacientes = new Map<number | null, any[]>();
      for (const i of itens) pacientes.set(i.paciente, [...(pacientes.get(i.paciente) ?? []), i]);
      const dados = (await c.query(`select id, cns, cpf, prontuario, data_nascimento::text nasc, sexo from cad.pessoa where id = any($1)`, [[...pacientes.keys()].filter(Boolean)])).rows;
      const pa = new Map(dados.map((d) => [d.id, d]));
      const total = (o: string) => itens.filter((i) => i.origem === o).reduce((s, i) => s + i.quantidade, 0);
      out.push({
        origem: `procedimentos:${g.unidade_id}:${g.profissional_id ?? 0}:${g.data}`,
        cnes: g.cnes,
        ine: g.ine,
        corpo: (uuid) =>
          el('headerTransport', header({ cns: g.cns_prof, cbo: g.cbo, cnes: g.cnes, ine: g.ine, data: g.data, ibge })) +
          el(
            'atendProcedimentos',
            [...pacientes.entries()]
              .filter(([id]) => id)
              .map(([id, lista]) => {
                const p = pa.get(id) ?? {};
                return {
                  numProntuario: p.prontuario,
                  cnsCidadao: digitos(p.cns),
                  cpfCidadao: digitos(p.cpf),
                  dtNascimento: epoch(p.nasc),
                  sexo: sexo(p.sexo),
                  localAtendimento: 1,
                  turno: 1,
                  statusEscutaInicialOrientacao: String(lista.some((i) => i.origem === 'ACOLHIMENTO')),
                  procedimentos: lista.map((i) => i.codigo),
                };
              }),
          ) +
          el('numTotalAfericaoPa', total('AFERICAO_PA')) +
          el('numTotalGlicemiaCapilar', total('GLICEMIA')) +
          el('numTotalColetaMaterialParaExameLaboratorial', total('COLETA')) +
          el('uuidFicha', uuid) +
          el('tpCdsOrigem', 3),
      });
    }
    return out;
  },

  async VISITA_DOMICILIAR(c, f, ibge) {
    if (!(await existe(c, 'acs.visita'))) return [];
    const grupos = (
      await c.query(
        `select v.unidade_id, v.profissional_id, (v.data_hora at time zone 'America/Sao_Paulo')::date::text data, u.cnes, cb.codigo cbo, vi.ine,
                (select pp.cns from cad.pessoa pp join cad.profissional pf on pf.pessoa_id = pp.id where pf.id = v.profissional_id) cns_prof,
                json_agg(json_build_object('turno', v.turno, 'pessoa', v.pessoa_id, 'motivos', v.motivos, 'desfecho', v.desfecho, 'microarea', v.microarea, 'imovel', v.tipo_imovel,
                         'peso', v.peso, 'altura', v.altura, 'lat', v.latitude, 'lon', v.longitude, 'compartilhada', v.compartilhada) order by v.data_hora) visitas
           from acs.visita v join cad.unidade u on u.id = v.unidade_id left join cad.vinculo vi on vi.profissional_id = v.profissional_id and vi.unidade_id = v.unidade_id and vi.ativo
           left join cad.cbo cb on cb.id = vi.cbo_id
          where (v.data_hora at time zone 'America/Sao_Paulo')::date between $1 and $2 and ($3::bigint is null or v.unidade_id = $3)
            and ($4 = 'TOTAL' or ${parcial('VISITA_DOMICILIAR', `'visitas:' || v.unidade_id || ':' || v.profissional_id || ':' || (v.data_hora at time zone 'America/Sao_Paulo')::date`, 'coalesce(v.atualizado_em, v.criado_em)')})
          group by 1, 2, 3, 4, 5, 6`,
        [f.de, f.ate, f.unidadeId, f.modalidade],
      )
    ).rows;
    const out: Item[] = [];
    for (const g of grupos) {
      const ids = (g.visitas as any[]).map((v) => v.pessoa).filter(Boolean);
      const pa = new Map((await c.query(`select id, cns, cpf, prontuario, data_nascimento::text nasc, sexo from cad.pessoa where id = any($1)`, [ids])).rows.map((d) => [d.id, d]));
      out.push({
        origem: `visitas:${g.unidade_id}:${g.profissional_id}:${g.data}`,
        cnes: g.cnes,
        ine: g.ine,
        corpo: (uuid) =>
          el('headerTransport', header({ cns: g.cns_prof, cbo: g.cbo ?? '515105', cnes: g.cnes, ine: g.ine, data: g.data, ibge })) +
          el(
            'visitasDomiciliares',
            (g.visitas as any[]).map((v) => {
              const p = (v.pessoa && pa.get(v.pessoa)) || {};
              return {
                turno: { M: 1, T: 2, N: 3 }[v.turno as 'M'] ?? 1,
                numProntuario: p.prontuario,
                cnsCidadao: digitos(p.cns),
                cpfCidadao: digitos(p.cpf),
                dtNascimento: epoch(p.nasc),
                sexo: p.sexo ? sexo(p.sexo) : null,
                statusVisitaCompartilhadaOutrosProfissionais: String(!!v.compartilhada),
                motivosVisita: (v.motivos ?? []).map((m: string) => MOTIVO_VISITA[m] ?? 32),
                desfecho: { REALIZADA: 1, RECUSADA: 2, AUSENTE: 3 }[v.desfecho as 'REALIZADA'] ?? 1,
                microArea: v.microarea,
                stForaArea: v.microarea ? 'false' : 'true',
                tipoDeImovel: Number(v.imovel ?? 1),
                pesoAcompanhamentoNutricional: v.peso,
                alturaAcompanhamentoNutricional: v.altura,
                latitude: v.lat,
                longitude: v.lon,
              };
            }),
          ) +
          el('uuidFicha', uuid) +
          el('tpCdsOrigem', 3),
      });
    }
    return out;
  },

  async ATENDIMENTO_DOMICILIAR(c, f, ibge) {
    const rows = (
      await c.query(
        `select x.*, x.data::text dt, ${PESSOA}, u.cnes, cb.codigo cbo, v.ine, (select pp.cns from cad.pessoa pp where pp.id = pf.pessoa_id) cns_prof, cd.codigo cid, pr.codigo proc
           from esus.atendimento_domiciliar x join cad.pessoa pa on pa.id = x.paciente_id join cad.unidade u on u.id = x.unidade_id left join cad.profissional pf on pf.id = x.profissional_id
           left join cad.vinculo v on v.profissional_id = x.profissional_id and v.unidade_id = x.unidade_id and v.ativo left join cad.cbo cb on cb.id = v.cbo_id
           left join cad.cid cd on cd.id = x.cid_id left join cad.procedimento pr on pr.id = x.procedimento_id
          where x.data between $1 and $2 and ($3::bigint is null or x.unidade_id = $3) and ($4 = 'TOTAL' or ${parcial('ATENDIMENTO_DOMICILIAR', `'atdom:' || x.id`, 'coalesce(x.atualizado_em, x.criado_em)')})`,
        [f.de, f.ate, f.unidadeId, f.modalidade],
      )
    ).rows;
    return rows.map((a) => ({
      origem: `atdom:${a.id}`,
      cnes: a.cnes,
      ine: a.ine,
      corpo: (uuid) =>
        el('headerTransport', header({ cns: a.cns_prof, cbo: a.cbo, cnes: a.cnes, ine: a.ine, data: a.dt, ibge })) +
        el('atendimentosDomiciliares', {
          turno: Number(a.turno ?? 1),
          cnsCidadao: digitos(a.cns),
          cpfCidadao: digitos(a.cpf),
          dataNascimento: epoch(a.nasc),
          sexo: sexo(a.sexo),
          localDeAtendimento: 4,
          atencaoDomiciliarModalidade: Number(String(a.modalidade).slice(2)),
          tipoAtendimento: Number(a.tipo_atendimento ?? 7),
          condicoesAvaliadas: (a.condicoes ?? []).length,
          cid: cid4(a.cid),
          procedimentos: a.proc,
          condutaDesfecho: Number(a.conduta ?? 1),
        }) +
        el('uuidFicha', uuid) +
        el('tpCdsOrigem', 3),
    }));
  },

  async ELEGIBILIDADE(c, f, ibge) {
    const rows = (
      await c.query(
        `select x.*, x.data::text dt, ${PESSOA}, u.cnes, cb.codigo cbo, v.ine, (select pp.cns from cad.pessoa pp where pp.id = pf.pessoa_id) cns_prof, cd.codigo cid
           from esus.elegibilidade x join cad.pessoa pa on pa.id = x.paciente_id join cad.unidade u on u.id = x.unidade_id left join cad.profissional pf on pf.id = x.profissional_id
           left join cad.vinculo v on v.profissional_id = x.profissional_id and v.unidade_id = x.unidade_id and v.ativo left join cad.cbo cb on cb.id = v.cbo_id left join cad.cid cd on cd.id = x.cid_id
          where x.data between $1 and $2 and ($3::bigint is null or x.unidade_id = $3) and ($4 = 'TOTAL' or ${parcial('ELEGIBILIDADE', `'elegibilidade:' || x.id`, 'coalesce(x.atualizado_em, x.criado_em)')})`,
        [f.de, f.ate, f.unidadeId, f.modalidade],
      )
    ).rows;
    return rows.map((a) => ({
      origem: `elegibilidade:${a.id}`,
      cnes: a.cnes,
      ine: a.ine,
      corpo: (uuid) =>
        el('uuidFicha', uuid) +
        el('tpCdsOrigem', 3) +
        el('headerTransport', header({ cns: a.cns_prof, cbo: a.cbo, cnes: a.cnes, ine: a.ine, data: a.dt, ibge })) +
        el('numeroProntuario', a.prontuario) +
        el('cnsCidadao', digitos(a.cns)) +
        el('cpfCidadao', digitos(a.cpf)) +
        el('nomeCidadao', a.nome) +
        el('nomeSocialCidadao', a.nome_social) +
        el('dataNascimentoCidadao', epoch(a.nasc)) +
        el('sexoCidadao', sexo(a.sexo)) +
        el('racaCorCidadao', raca(a.raca_cor)) +
        el('nomeMaeCidadao', a.nome_mae) +
        el('nacionalidadeCidadao', 1) +
        el('atencaoDomiciliarProcedencia', Number(a.procedencia ?? 1)) +
        el('atencaoDomiciliarModalidade', a.modalidade ? Number(String(a.modalidade).slice(2)) : null) +
        el('condicoesAvaliadas', (a.condicoes ?? []).length || null) +
        el('cid10Principal', cid4(a.cid)) +
        el('conclusaoDestinoElegivel', a.conclusao === 'ELEGIVEL' ? Number(String(a.modalidade ?? 'AD2').slice(2)) : null) +
        el('conclusaoDestinoInelegivel', a.conclusao === 'INELEGIVEL' ? Number(a.motivo_inelegibilidade ?? 4) : null) +
        el('cuidadorCnsCidadao', null) +
        el('cuidadorNome', a.cuidador) +
        el('cuidadorRelacao', a.cuidador_relacao ? Number(a.cuidador_relacao) : null),
    }));
  },

  async CONSUMO_ALIMENTAR(c, f, ibge) {
    const rows = (
      await c.query(
        `select x.*, x.data::text dt, ${PESSOA}, u.cnes, cb.codigo cbo, v.ine, (select pp.cns from cad.pessoa pp where pp.id = pf.pessoa_id) cns_prof
           from esus.marcador_consumo x join cad.pessoa pa on pa.id = x.paciente_id join cad.unidade u on u.id = x.unidade_id left join cad.profissional pf on pf.id = x.profissional_id
           left join cad.vinculo v on v.profissional_id = x.profissional_id and v.unidade_id = x.unidade_id and v.ativo left join cad.cbo cb on cb.id = v.cbo_id
          where x.data between $1 and $2 and ($3::bigint is null or x.unidade_id = $3) and ($4 = 'TOTAL' or ${parcial('CONSUMO_ALIMENTAR', `'consumo:' || x.id`, 'coalesce(x.atualizado_em, x.criado_em)')})`,
        [f.de, f.ate, f.unidadeId, f.modalidade],
      )
    ).rows;
    return rows.map((a) => {
      const consumo: string[] = a.consumo_ontem ?? [];
      const perguntas = [
        ...(a.refeicoes_tv ? [{ pergunta: 'REFEICOES_TV', respostaUnicaEscolha: Number(a.refeicoes_tv) }] : []),
        ...(a.refeicoes?.length ? [{ pergunta: 'REFEICOES_DIA', respostaMultiplaEscolha: a.refeicoes.map(Number) }] : []),
        ...consumo.map((k) => ({ pergunta: `CONSUMIU_${k}`, respostaUnicaEscolha: 1 })),
      ];
      return {
        origem: `consumo:${a.id}`,
        cnes: a.cnes,
        ine: a.ine,
        corpo: (uuid) =>
          el('headerTransport', header({ cns: a.cns_prof, cbo: a.cbo, cnes: a.cnes, ine: a.ine, data: a.dt, ibge })) +
          el('uuidFicha', uuid) +
          el('tpCdsOrigem', 3) +
          el('numeroCartaoSus', digitos(a.cns)) +
          el('cpfCidadao', digitos(a.cpf)) +
          el('identificacaoUsuario', a.nome) +
          el('dataNascimento', epoch(a.nasc)) +
          el('sexo', sexo(a.sexo)) +
          el('localAtendimento', Number(a.local_atendimento ?? 1)) +
          el('perguntasQuestionario', perguntas),
      };
    });
  },

  async VACINACAO(c, f, ibge) {
    const grupos = (
      await c.query(
        `select v.unidade_id, v.profissional_id, v.data::text data, u.cnes, cb.codigo cbo, vi.ine, (select pp.cns from cad.pessoa pp join cad.profissional pf on pf.pessoa_id = pp.id where pf.id = v.profissional_id) cns_prof,
                json_agg(json_build_object('pessoa', v.paciente_id, 'imuno', i.codigo_sipni, 'dose', d.codigo_sipni, 'estrategia', v.estrategia, 'lote', coalesce(l.lote, v.lote_texto),
                         'fabricante', fb.codigo_sipni, 'gestante', v.gestante) order by v.paciente_id) vacinas
           from imu.vacinacao v join imu.imunobiologico i on i.id = v.imunobiologico_id left join imu.dose d on d.id = v.dose_id left join far.estoque_lote l on l.id = v.lote_id
           left join far.fabricante fb on fb.id = coalesce(v.fabricante_id, l.fabricante_id) join cad.unidade u on u.id = v.unidade_id
           left join cad.vinculo vi on vi.profissional_id = v.profissional_id and vi.unidade_id = v.unidade_id and vi.ativo left join cad.cbo cb on cb.id = vi.cbo_id
          where v.tipo = 'APLICACAO' and v.data between $1 and $2 and ($3::bigint is null or v.unidade_id = $3)
            and ($4 = 'TOTAL' or ${parcial('VACINACAO', `'vacinacao:' || v.unidade_id || ':' || coalesce(v.profissional_id, 0) || ':' || v.data`, 'coalesce(v.atualizado_em, v.criado_em)')})
          group by 1, 2, 3, 4, 5, 6`,
        [f.de, f.ate, f.unidadeId, f.modalidade],
      )
    ).rows;
    const ESTRATEGIA: Record<string, number> = { ROTINA: 1, ESPECIAL: 2, BLOQUEIO: 3, INTENSIFICACAO: 4, CAMPANHA: 5 };
    const out: Item[] = [];
    for (const g of grupos) {
      const ids = [...new Set((g.vacinas as any[]).map((v) => v.pessoa))];
      const pa = new Map((await c.query(`select id, cns, cpf, prontuario, data_nascimento::text nasc, sexo from cad.pessoa where id = any($1)`, [ids])).rows.map((d) => [d.id, d]));
      out.push({
        origem: `vacinacao:${g.unidade_id}:${g.profissional_id ?? 0}:${g.data}`,
        cnes: g.cnes,
        ine: g.ine,
        corpo: (uuid) =>
          el('headerTransport', header({ cns: g.cns_prof, cbo: g.cbo, cnes: g.cnes, ine: g.ine, data: g.data, ibge })) +
          el(
            'vacinacoes',
            ids.map((id) => {
              const p = pa.get(id) ?? {};
              const vs = (g.vacinas as any[]).filter((v) => v.pessoa === id);
              return {
                turno: 1,
                numProntuario: p.prontuario,
                cnsCidadao: digitos(p.cns),
                cpfCidadao: digitos(p.cpf),
                dtNascimento: epoch(p.nasc),
                sexo: sexo(p.sexo),
                localAtendimento: 1,
                viajante: 'false',
                comunicanteHanseniase: 'false',
                gestante: String(vs.some((v) => v.gestante)),
                puerpera: 'false',
                vacinas: vs.map((v) => ({ imunobiologico: v.imuno, estrategiaVacinacao: ESTRATEGIA[v.estrategia] ?? 1, dose: v.dose, lote: v.lote, fabricante: v.fabricante })),
              };
            }),
          ) +
          el('uuidFicha', uuid) +
          el('tpCdsOrigem', 3),
      });
    }
    return out;
  },
};

export interface Instalacao {
  contraChave: string;
  uuidInstalacao: string;
  cpfOuCnpj: string;
  nomeOuRazaoSocial: string;
  fone: string;
  email: string;
  versaoSistema: string;
  nomeBancoDados: string;
}

/** Monta o XML de transporte de uma ficha (dadoTransporteTransportXml). */
export function xmlTransporte(ficha: TipoFicha, uuid: string, item: Item, ibge: string, inst: Instalacao, lote: number) {
  const d = FICHAS[ficha];
  const instalacao = el('contraChave', inst.contraChave) + el('uuidInstalacao', inst.uuidInstalacao) + el('cpfOuCnpj', inst.cpfOuCnpj) + el('nomeOuRazaoSocial', inst.nomeOuRazaoSocial) + el('fone', inst.fone) + el('email', inst.email) + el('versaoSistema', inst.versaoSistema) + el('nomeBancoDados', inst.nomeBancoDados);
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<ns3:dadoTransporteTransportXml xmlns:ns2="http://esus.ufsc.br/dadoinstalacao" xmlns:ns3="http://esus.ufsc.br/dadotransporte" xmlns:ns4="${d.ns}">` +
    el('uuidDadoSerializado', uuid) +
    el('tipoDadoSerializado', d.tipo) +
    el('codIbge', ibge) +
    el('cnesDadoSerializado', item.cnes) +
    el('ineDadoSerializado', item.ine) +
    el('numLote', lote) +
    `<ns4:${d.elemento}>${item.corpo(uuid)}</ns4:${d.elemento}>` +
    `<remetente>${instalacao}</remetente><originadora>${instalacao}</originadora>` +
    `<versao major="4" minor="0" revision="0"/>` +
    `</ns3:dadoTransporteTransportXml>`
  );
}

/** Gera o lote de exportação: zip com um XML por ficha e o resumo; registra os UUIDs para envios parciais. */
export async function gerarLoteLedi(c: pg.PoolClient, f: FiltroExportacao, exportacaoId: number) {
  const ibge = (await c.query(`select codigo_ibge from cad.municipio where id = (select municipio_id from cad.unidade where municipio_id is not null order by id limit 1)`)).rows[0]?.codigo_ibge ?? '3508405';
  const inst = await parametro<Instalacao>('esus.instalacao', {
    contraChave: 'UBRISUS',
    uuidInstalacao: '00000000-0000-0000-0000-000000000000',
    cpfOuCnpj: '46634432000155',
    nomeOuRazaoSocial: 'SECRETARIA MUNICIPAL DE SAUDE DE CABREUVA',
    fone: '',
    email: '',
    versaoSistema: 'UBRISUS 1.0',
    nomeBancoDados: 'PostgreSQL',
  });
  const zip = new AdmZip();
  const resumo: Record<string, number> = {};
  let total = 0;
  for (const ficha of f.fichas) {
    const itens = await geradores[ficha](c, f, ibge);
    resumo[ficha] = itens.length;
    for (const item of itens) {
      const ja = (await c.query(`select uuid from esus.registro_exportado where ficha = $1 and origem = $2`, [ficha, item.origem])).rows[0];
      const uuid = ja?.uuid ?? `${item.cnes}-${randomUUID()}`;
      zip.addFile(`${ficha.toLowerCase()}/${uuid}.esus.xml`, Buffer.from(xmlTransporte(ficha, uuid, item, ibge, inst, exportacaoId), 'utf8'));
      await c.query(
        `insert into esus.registro_exportado (ficha, origem, uuid, exportacao_id, exportado_em) values ($1,$2,$3,$4,now())
         on conflict (ficha, origem) do update set exportacao_id = excluded.exportacao_id, exportado_em = now()`,
        [ficha, item.origem, uuid, exportacaoId],
      );
      total++;
    }
  }
  zip.addFile(
    'LEIAME.txt',
    Buffer.from(
      [
        `Exportação e-SUS AB (LEDI AB 4.0) - ${f.modalidade === 'TOTAL' ? 'envio total' : 'envio parcial desde a última exportação'}`,
        `Período: ${f.de} a ${f.ate} · Município IBGE ${ibge} · Gerado em ${new Date().toISOString()}`,
        ...Object.entries(resumo).map(([k, v]) => `${FICHAS[k].titulo}: ${v} ficha(s)`),
        'Importe o arquivo no PEC e-SUS AB em Administração > Importar CDS/LEDI.',
      ].join('\r\n'),
      'utf8',
    ),
  );
  return { conteudo: zip.toBuffer(), resumo, total };
}
