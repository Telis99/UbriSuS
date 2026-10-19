// Regras do aplicativo do ACS: montagem da carga do território, bloqueio das famílias em campo,
// processamento dos lotes enviados pelo dispositivo (visitas, integrantes, domicílios e
// solicitações de agendamento), conflitos e geração automática da produção BPA (TR 1.2.49).
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { consultarUm } from '../../db/pool.js';
import { alterar, inserir } from '../../meta/crud.js';
import { obterEntidade } from '../../meta/registro.js';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { cifrar } from '../../servicos/cripto.js';
import { incluirListaEspera } from '../agendamento/servico.js';
import { lancarProducao } from '../faturamento/producao.js';
import { DESFECHO_VISITA, MOTIVOS_VISITA, TIPO_IMOVEL } from './entidades.js';

export const PROCEDIMENTO_VISITA_ACS = '0101030010';
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Liberação do ACS para o aplicativo (TR 1.2.49.5). */
export async function acessoDoOperador(operadorId: number, c?: pg.PoolClient) {
  const sql = `select a.*, u.nome unidade, pr.nome profissional from acs.acesso a join cad.unidade u on u.id = a.unidade_id
                 left join cad.profissional pr on pr.id = a.profissional_id where a.operador_id = $1`;
  return c ? (await c.query(sql, [operadorId])).rows[0] : consultarUm(sql, [operadorId]);
}

export async function exigirAcessoAcs(u: Usuario, c?: pg.PoolClient) {
  const a = await acessoDoOperador(u.id, c);
  if (!a || a.situacao !== 'LIBERADO') throw new ErroHttp(403, 'Acesso ao aplicativo do ACS não liberado pela unidade de saúde.');
  return a;
}

/** Carga ativa (dentro da validade) do ACS. */
export async function cargaAtiva(operadorId: number, c?: pg.PoolClient) {
  const sql = `select k.*, k.validade::text validade_txt, o.nome responsavel from acs.carga k left join seg.operador o on o.id = k.operador_id
                where k.operador_id = $1 and k.situacao = 'ATIVA' order by k.id desc limit 1`;
  return c ? (await c.query(sql, [operadorId])).rows[0] : consultarUm(sql, [operadorId]);
}

/** Famílias bloqueadas por carga em campo: liberadas automaticamente no retorno ou após a validade (TR 1.2.49.9). */
export const SQL_BLOQUEIO = `select k.id carga_id, k.operador_id, o.nome responsavel, k.validade::text validade from acs.carga_familia cf
   join acs.carga k on k.id = cf.carga_id left join seg.operador o on o.id = k.operador_id
  where cf.familia_id = $1 and k.situacao = 'ATIVA' and k.validade >= current_date limit 1`;

export async function bloqueioFamilia(c: pg.PoolClient, familiaId: number | null | undefined) {
  if (!familiaId) return null;
  return (await c.query(SQL_BLOQUEIO, [familiaId])).rows[0] ?? null;
}

const OPCOES = (nome: string) => obterEntidade('familia')!.campos.find((c) => c.nome === nome)?.opcoes ?? [];
const OPCOES_PESSOA = (nome: string) => obterEntidade('paciente')!.campos.find((c) => c.nome === nome)?.opcoes ?? [];

/** Campos da Ficha A editáveis no aplicativo (domicílio e outras informações) (TR 1.2.49.13.2). */
export const CAMPOS_FAMILIA = [
  'tipo_localidade', 'tipo_domicilio', 'situacao_domicilio', 'comodos', 'dormitorios', 'pessoas_por_dormitorio', 'tipo_piso', 'tipo_parede',
  'agua_canalizada', 'abastecimento_agua', 'tratamento_agua', 'banheiro', 'destino_fezes', 'destino_lixo', 'iluminacao', 'acesso_domicilio',
  'acessibilidade', 'area_risco', 'area_dificil_acesso', 'area_conflito', 'animais', 'plano_saude', 'grupos_comunitarios', 'meios_comunicacao',
  'meios_transporte', 'vulnerabilidades', 'renda_familiar', 'numero', 'complemento', 'ponto_referencia', 'cep',
];
/** Campos do integrante editáveis no aplicativo (TR 1.2.49.13.3, 1.2.49.13.4). */
export const CAMPOS_PESSOA = [
  'nome', 'nome_social', 'sexo', 'data_nascimento', 'raca_cor', 'nome_mae', 'mae_desconhecida', 'nome_pai', 'cns', 'cpf', 'parentesco', 'celular',
  'telefone', 'condicoes_saude', 'deficiencias', 'escolaridade', 'situacao_trabalho', 'frequenta_escola', 'plano_saude', 'dum', 'situacao', 'data_obito',
];

/** Monta a carga do território: famílias da microárea no padrão da Ficha A, integrantes e tabelas de apoio. */
export async function montarCarga(c: pg.PoolClient, carga: any, acesso: any) {
  const familias = (
    await c.query(
      `select f.*, coalesce(f.atualizado_em, f.criado_em) versao, m.nome municipio, tl.nome tipo_logradouro, lg.nome logradouro, b.nome bairro,
              r.nome responsavel
         from acs.carga_familia cf join cad.familia f on f.id = cf.familia_id left join cad.municipio m on m.id = f.municipio_id
         left join cad.logradouro lg on lg.id = f.logradouro_id left join cad.tipo_logradouro tl on tl.id = lg.tipo_logradouro_id
         left join cad.bairro b on b.id = f.bairro_id left join cad.pessoa r on r.id = f.responsavel_id
        where cf.carga_id = $1 order by lg.nome, f.numero, f.id`,
      [carga.id],
    )
  ).rows;
  const pessoas = (
    await c.query(
      `select p.id, p.familia_id, p.nome, p.nome_social, p.sexo, p.data_nascimento::text data_nascimento, p.raca_cor, p.nome_mae, p.mae_desconhecida, p.nome_pai,
              p.cns, p.cpf, p.rg_numero, p.parentesco, p.celular, p.telefone, p.condicoes_saude, p.deficiencias, p.escolaridade, p.situacao_trabalho,
              p.frequenta_escola, p.plano_saude, p.dum::text dum, p.situacao, p.data_obito::text data_obito, coalesce(p.atualizado_em, p.criado_em) versao,
              (select max(v.data_hora) from acs.visita v where v.pessoa_id = p.id) ultima_visita,
              (select count(*)::int from imu.vacinacao vc where vc.paciente_id = p.id) vacinas,
              (select string_agg(a.substancia, ', ') from cad.pessoa_alergia a where a.pessoa_id = p.id) alergias
         from cad.pessoa p where p.familia_id = any($1) and p.situacao <> 'FALECIDO' order by p.familia_id, (p.parentesco = 'RESPONSAVEL') desc, p.data_nascimento`,
      [familias.map((f) => f.id)],
    )
  ).rows;
  const especialidades = (await c.query(`select id, nome from cad.especialidade where ativo order by nome`)).rows;
  const dados = {
    carga: {
      id: carga.id,
      recebidaEm: carga.recebida_em,
      responsavel: carga.responsavel ?? acesso.profissional,
      unidade: acesso.unidade,
      area: carga.area,
      microarea: carga.microarea,
      familias: familias.length,
      pessoas: pessoas.length,
      validade: String(carga.validade_txt ?? carga.validade).slice(0, 10),
    },
    familias,
    pessoas,
    especialidades,
    opcoes: {
      motivos: MOTIVOS_VISITA,
      desfechos: DESFECHO_VISITA,
      tiposImovel: TIPO_IMOVEL,
      parentesco: OPCOES_PESSOA('parentesco'),
      sexo: OPCOES_PESSOA('sexo'),
      racaCor: OPCOES_PESSOA('raca_cor'),
      condicoesSaude: OPCOES_PESSOA('condicoes_saude'),
      deficiencias: OPCOES_PESSOA('deficiencias'),
      ficha: Object.fromEntries(
        obterEntidade('familia')!
          .campos.filter((f) => CAMPOS_FAMILIA.includes(f.nome))
          .map((f) => [f.nome, { rotulo: f.rotulo, tipo: f.tipo, aba: f.aba, opcoes: f.opcoes ?? OPCOES(f.nome) }]),
      ),
    },
  };
  return { ...dados, hash: sha256(JSON.stringify({ familias: dados.familias, pessoas: dados.pessoas })) };
}

export interface LoteAcs {
  loteUuid: string;
  cargaId: number;
  hash: string;
  registros: {
    familias?: { id: number; versao?: string | null; dados: Record<string, any> }[];
    pessoas?: { uuid: string; id?: number | null; familiaId: number; versao?: string | null; dados: Record<string, any> }[];
    visitas?: {
      uuid: string; grupoUuid?: string | null; dataHora: string; familiaId?: number | null; pessoaId?: number | null; pessoaUuid?: string | null;
      tipoImovel?: string; motivos: string[]; desfecho: string; compartilhada?: boolean; profissionaisCompartilhados?: string | null; parecer?: string | null;
      peso?: number | null; altura?: number | null; paSistolica?: number | null; paDiastolica?: number | null; temperatura?: number | null; glicemia?: number | null;
      glicemiaMomento?: string | null; latitude?: number | null; longitude?: number | null; precisao?: number | null; turno?: string | null;
    }[];
    solicitacoes?: { uuid: string; pessoaId?: number | null; pessoaUuid?: string | null; especialidadeId: number; justificativa: string }[];
  };
}

const filtrar = (d: Record<string, any>, campos: string[]) => Object.fromEntries(Object.entries(d).filter(([k]) => campos.includes(k)));
const versaoDe = (r: any) => new Date(r.atualizado_em ?? r.criado_em).getTime();

/**
 * Processa o lote enviado pelo dispositivo em uma transação: tudo ou nada. Registros alterados no
 * sistema após o envio da carga viram conflitos para análise da unidade (TR 1.2.49.12.1.2, 1.2.49.13.8).
 */
export async function processarLote(c: pg.PoolClient, lote: LoteAcs, u: Usuario, acesso: any, carga: any) {
  const ctx = { usuarioId: u.id, rotina: 'acs:sincronizar' };
  const resultado = { visitas: 0, pessoas: 0, familias: 0, solicitacoes: 0, conflitos: [] as any[], novosIds: {} as Record<string, number>, producao: 0 };
  const sinc = (
    await c.query(
      `insert into acs.sincronizacao (carga_id, operador_id, data_hora, lote_uuid, hash_integridade, conteudo_cifrado) values ($1,$2,now(),$3,$4,$5) returning id`,
      [carga.id, u.id, lote.loteUuid, lote.hash, cifrar(JSON.stringify(lote.registros))],
    )
  ).rows[0];
  const familiasCarga = new Set((await c.query(`select familia_id from acs.carga_familia where carga_id = $1`, [carga.id])).rows.map((r) => Number(r.familia_id)));
  const conflito = async (tabela: string, registroId: number | null, descricao: string, dispositivo: unknown, servidor: unknown) => {
    await c.query(
      `insert into acs.conflito (sincronizacao_id, carga_id, tabela, registro_id, descricao, dados_dispositivo, dados_servidor, situacao) values ($1,$2,$3,$4,$5,$6,$7,'PENDENTE')`,
      [sinc.id, carga.id, tabela, registroId, descricao.slice(0, 200), JSON.stringify(dispositivo), JSON.stringify(servidor)],
    );
    resultado.conflitos.push({ tabela, registroId, descricao });
  };

  // Domicílios (Ficha A).
  for (const f of lote.registros.familias ?? []) {
    if (!familiasCarga.has(f.id)) throw new ErroHttp(422, `Família ${f.id} não pertence à carga.`);
    const atual = (await c.query(`select * from cad.familia where id = $1`, [f.id])).rows[0];
    const dados = filtrar(f.dados, CAMPOS_FAMILIA);
    if (!atual || !Object.keys(dados).length) continue;
    if (f.versao && versaoDe(atual) > new Date(f.versao).getTime() + 1000) {
      await conflito('FAMILIA', f.id, `Domicílio ${atual.codigo ?? f.id} alterado no sistema após o envio da carga`, dados, filtrar(atual, Object.keys(dados)));
      continue;
    }
    await alterar(obterEntidade('familia')!, f.id, dados, ctx, u, c);
    resultado.familias++;
  }

  // Integrantes: atualização e inclusão de novos membros (TR 1.2.49.13.3, 1.2.49.13.4).
  for (const p of lote.registros.pessoas ?? []) {
    if (!familiasCarga.has(p.familiaId)) throw new ErroHttp(422, 'Integrante de família fora da carga.');
    const dados = filtrar(p.dados, CAMPOS_PESSOA);
    if (p.id) {
      const atual = (await c.query(`select * from cad.pessoa where id = $1`, [p.id])).rows[0];
      if (!atual || Number(atual.familia_id) !== p.familiaId) throw new ErroHttp(422, `Integrante ${p.id} não pertence à família informada.`);
      if (p.versao && versaoDe(atual) > new Date(p.versao).getTime() + 1000) {
        await conflito('PESSOA', p.id, `${atual.nome}: cadastro alterado no sistema após o envio da carga`, dados, filtrar(atual, Object.keys(dados)));
        continue;
      }
      await c.query('savepoint pessoa');
      try {
        await alterar(obterEntidade('paciente')!, p.id, dados, ctx, u, c);
        await c.query('release savepoint pessoa');
        resultado.pessoas++;
      } catch (e) {
        await c.query('rollback to savepoint pessoa');
        await conflito('PESSOA', p.id, `${atual.nome}: ${(e as Error).message}`, dados, filtrar(atual, Object.keys(dados)));
      }
    } else {
      const familia = (await c.query(`select * from cad.familia where id = $1`, [p.familiaId])).rows[0];
      const novo = {
        ...dados,
        familia_id: p.familiaId,
        unidade_referencia_id: familia.unidade_id ?? acesso.unidade_id,
        municipio_id: familia.municipio_id,
        logradouro_id: familia.logradouro_id,
        numero: familia.numero,
        complemento: familia.complemento,
        bairro_id: familia.bairro_id,
        cep: familia.cep,
        microarea: familia.microarea,
        latitude: familia.latitude,
        longitude: familia.longitude,
      };
      let criado: any = null;
      for (const situacao of ['ATIVO', 'PRE_CADASTRO']) {
        await c.query('savepoint pessoa');
        try {
          criado = await inserir(obterEntidade('paciente')!, { ...novo, situacao }, ctx, u, c);
          await c.query('release savepoint pessoa');
          break;
        } catch (e) {
          await c.query('rollback to savepoint pessoa');
          if (situacao === 'PRE_CADASTRO') await conflito('PESSOA', (e as any)?.detalhes?.duplicadoId ?? null, `Novo integrante ${dados.nome ?? ''}: ${(e as Error).message}`, novo, null);
        }
      }
      if (criado) {
        resultado.novosIds[p.uuid] = criado.id;
        resultado.pessoas++;
      }
    }
  }

  const pessoaDe = (id?: number | null, uuid?: string | null) => id ?? (uuid ? resultado.novosIds[uuid] : null) ?? null;

  // Visitas domiciliares com geração automática do BPA (TR 1.2.49.11, 1.2.49.13.5, 1.2.49.13.6).
  for (const v of lote.registros.visitas ?? []) {
    if ((await c.query(`select 1 from acs.visita where uuid = $1`, [v.uuid])).rowCount) continue;
    const pessoaId = pessoaDe(v.pessoaId, v.pessoaUuid);
    if (v.familiaId && !familiasCarga.has(v.familiaId)) throw new ErroHttp(422, 'Visita a família fora da carga.');
    const motivos = (v.motivos ?? []).filter((m) => MOTIVOS_VISITA.some(([k]) => k === m));
    if (!motivos.length) throw new ErroHttp(422, 'Visita sem motivo informado.');
    const desfecho = DESFECHO_VISITA.some(([k]) => k === v.desfecho) ? v.desfecho : 'REALIZADA';
    const hora = new Date(v.dataHora);
    const h = Number(hora.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }));
    const r = (
      await c.query(
        `insert into acs.visita (uuid, grupo_uuid, data_hora, turno, profissional_id, unidade_id, microarea, tipo_imovel, familia_id, pessoa_id, motivos, desfecho,
                                 compartilhada, profissionais_compartilhados, parecer_tecnico, peso, altura, pa_sistolica, pa_diastolica, temperatura, glicemia,
                                 glicemia_momento, latitude, longitude, precisao_gps, carga_id, origem, sincronizada_em)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'APLICATIVO',now()) returning id`,
        [
          v.uuid, v.grupoUuid ?? null, hora.toISOString(), v.turno ?? (h < 12 ? 'M' : h < 18 ? 'T' : 'N'), acesso.profissional_id, acesso.unidade_id, carga.microarea,
          v.tipoImovel ?? '01', v.familiaId ?? null, pessoaId, motivos, desfecho, !!v.compartilhada, v.profissionaisCompartilhados ?? null, v.parecer ?? null,
          v.peso ?? null, v.altura ?? null, v.paSistolica ?? null, v.paDiastolica ?? null, v.temperatura ?? null, v.glicemia ?? null, v.glicemiaMomento ?? null,
          v.latitude ?? null, v.longitude ?? null, v.precisao != null ? Math.round(v.precisao) : null, carga.id,
        ],
      )
    ).rows[0];
    resultado.visitas++;
    if (desfecho === 'REALIZADA') {
      const prod = await lancarProducao(c, { data: hora.toISOString().slice(0, 10), unidadeId: acesso.unidade_id, profissionalId: acesso.profissional_id, pacienteId: pessoaId, procedimentoCodigo: PROCEDIMENTO_VISITA_ACS, origem: 'VISITA_ACS', referencia: `visita:${r.id}` });
      if (prod) {
        await c.query(`update acs.visita set producao_id = $2 where id = $1`, [r.id, prod.id]);
        resultado.producao++;
      }
    }
    // Georreferenciamento do domicílio a partir do GPS da primeira visita.
    if (v.familiaId && v.latitude != null && v.longitude != null) {
      await c.query(`update cad.familia set latitude = $2, longitude = $3 where id = $1 and latitude is null`, [v.familiaId, v.latitude, v.longitude]);
    }
    if (pessoaId && desfecho === 'REALIZADA') {
      await c.query(`insert into cad.pessoa_contato (pessoa_id, data_hora, setor, meio, assunto, descricao) values ($1,$2,'Agente comunitário de saúde','VISITA','Visita domiciliar',$3)`, [
        pessoaId,
        hora.toISOString(),
        v.parecer ?? null,
      ]);
    }
  }

  // Solicitações de agendamento de consulta feitas pelo ACS (TR 1.2.49.13.7).
  for (const s of lote.registros.solicitacoes ?? []) {
    const pessoaId = pessoaDe(s.pessoaId, s.pessoaUuid);
    if (!pessoaId) continue;
    await incluirListaEspera(c, {
      pacienteId: pessoaId,
      especialidadeId: s.especialidadeId,
      unidadeSolicitanteId: acesso.unidade_id,
      profissionalSolicitanteId: acesso.profissional_id,
      origem: 'ACS',
      justificativa: `Solicitação do ACS ${acesso.profissional ?? ''}: ${s.justificativa}`.slice(0, 2000),
    });
    resultado.solicitacoes++;
  }

  await c.query(
    `update acs.sincronizacao set visitas = $2, pessoas = $3, familias = $4, solicitacoes = $5, conflitos = $6, resultado = $7 where id = $1`,
    [sinc.id, resultado.visitas, resultado.pessoas, resultado.familias, resultado.solicitacoes, resultado.conflitos.length, JSON.stringify(resultado)],
  );
  await c.query(`update acs.carga set ultima_sincronizacao = now() where id = $1`, [carga.id]);
  return resultado;
}
