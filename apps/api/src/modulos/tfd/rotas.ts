// Rotas do TFD: localização de laudos, decisões (aprovar, glosar, arquivar, negar, autorizar),
// complementos, trâmites e impressão do laudo e do pedido de TFD.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, consultarUm, transacao } from '../../db/pool.js';
import { registrarGanchos } from '../../meta/crud.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { emitirDocumento } from '../../servicos/relatorios.js';
import { idadeTexto } from '../../compartilhado/validacao.js';
import { contextoDe, ErroHttp, exigirPermissao, type Usuario } from '../../seguranca/usuario.js';
import { TIPO_TRANSPORTE } from './entidades.js';
import { executarAcao, proximoNumero, registrarTramite, ROTULO_SITUACAO, SQL_SITUACAO_ATUAL, type AcaoLaudo } from './servico.js';
import './relatorios.js';

registrarPermissao('tfd_decisao', 'Aprovar, glosar, arquivar, negar e autorizar laudos e tratamentos de TFD', 'TFD', ['executar']);

const fmtData = (d?: string | null) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const fmtDataHora = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }).slice(0, 17) : '');
const ROTULO_TRANSPORTE = Object.fromEntries(TIPO_TRANSPORTE);
const idParam = (req: any) => Number(req.params.id);
const pdf = (reply: any, r: { nome: string; conteudo: Buffer }) => reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="${r.nome}"`).send(r.conteudo);

const CAMPOS_ROTULO: Record<string, string> = {
  data_abertura: 'data de abertura',
  unidade_solicitante_id: 'unidade solicitante',
  profissional_solicitante_id: 'profissional solicitante',
  paciente_id: 'paciente',
  cid_id: 'CID',
  procedimento_id: 'procedimento',
  diagnostico_inicial: 'diagnóstico inicial',
  diagnostico_provavel: 'diagnóstico provável',
  historico_doenca: 'histórico da doença',
  exame_fisico: 'exame físico',
  exames_complementares: 'exames complementares',
  tratamentos_realizados: 'tratamentos realizados',
  razoes_impossibilidade: 'razões da impossibilidade',
  tipo_transporte: 'tipo de transporte',
  necessita_acompanhante: 'necessidade de acompanhante',
  justificativa_acompanhante: 'justificativa do acompanhante',
};

// ---------------------------------------------------------------------------
// Regras nos cadastros (inclusão e alteração pelo formulário do laudo)
// ---------------------------------------------------------------------------
registrarGanchos('laudo_tfd', {
  async antesSalvar(d, { cliente, atual, usuario }) {
    const necessita = d.necessita_acompanhante ?? atual?.necessita_acompanhante;
    const just = d.justificativa_acompanhante === undefined ? atual?.justificativa_acompanhante : d.justificativa_acompanhante;
    if (necessita && !just) throw new ErroHttp(422, 'Informe a justificativa para a necessidade de acompanhante.', { justificativa_acompanhante: 'Obrigatório quando necessita de acompanhante.' });
    if (!atual) {
      d.numero = await proximoNumero(cliente, d.data_abertura);
      d.situacao = 'ABERTO';
      d.situacao_tratamento = 'PENDENTE';
      return;
    }
    // Alteração após a inclusão com data, hora e usuário (TR 1.2.35.6).
    if (['ARQUIVADO', 'NEGADO'].includes(atual.situacao)) throw new ErroHttp(422, 'Laudo arquivado ou negado não pode ser alterado.');
    d.alterado_em = new Date().toISOString();
    d.alterado_por = usuario?.id ?? null;
  },
  async depoisSalvar(r, { cliente, atual, usuario }) {
    if (!atual) return registrarTramite(cliente, r.id, 'Laudo incluído', `Laudo nº ${r.numero} aberto.`, 'ABERTO', usuario);
    const alterados = Object.keys(CAMPOS_ROTULO).filter((k) => String(atual[k] ?? '') !== String(r[k] ?? ''));
    if (alterados.length) await registrarTramite(cliente, r.id, 'Laudo alterado', `Campos alterados: ${alterados.map((k) => CAMPOS_ROTULO[k]).join(', ')}.`, null, usuario);
  },
  antesExcluir() {
    throw new ErroHttp(422, 'Laudos de TFD não são excluídos: utilize o arquivamento (TR 1.2.35.9).');
  },
});
// Complementos com data, hora e usuário automáticos (TR 1.2.35.4).
registrarGanchos('laudo_tfd_complemento', {
  antesSalvar(d, { atual, usuario }) {
    if (atual) throw new ErroHttp(422, 'Complementos registrados não podem ser alterados; inclua um novo complemento.');
    d.data_hora = new Date().toISOString();
    d.operador_id = usuario?.id ?? null;
  },
  async depoisSalvar(r, { cliente, usuario }) {
    await registrarTramite(cliente, r.laudo_id, 'Complemento incluído', r.texto, null, usuario);
  },
  antesExcluir() {
    throw new ErroHttp(422, 'Complementos do laudo não podem ser excluídos.');
  },
});
registrarGanchos('laudo_tfd_tramite', {
  antesSalvar() {
    throw new ErroHttp(422, 'Os trâmites são registrados automaticamente pelo sistema.');
  },
  antesExcluir() {
    throw new ErroHttp(422, 'Os trâmites do processo não podem ser excluídos.');
  },
});
registrarGanchos('laudo_tfd_documento', {
  async depoisSalvar(r, { cliente, atual, usuario }) {
    if (!atual) await registrarTramite(cliente, r.laudo_id, 'Documento anexado', r.descricao, null, usuario);
  },
});
registrarGanchos('laudo_tfd_acompanhante', {
  async antesSalvar(d, { cliente, atual }) {
    const pessoa = d.pessoa_id ?? atual?.pessoa_id;
    if (pessoa && !d.nome && !atual?.nome) {
      const p = (await cliente.query(`select nome, cpf, coalesce(celular, telefone) tel from cad.pessoa where id = $1`, [pessoa])).rows[0];
      if (p) Object.assign(d, { nome: p.nome, cpf: d.cpf ?? p.cpf, telefone: d.telefone ?? p.tel });
    }
    if (!(d.nome ?? atual?.nome)) throw new ErroHttp(422, 'Informe o acompanhante.', { nome: 'Obrigatório.' });
  },
  async depoisSalvar(r, { cliente, atual, usuario }) {
    if (!atual) await registrarTramite(cliente, r.laudo_id, 'Acompanhante incluído', r.nome, null, usuario);
  },
});
registrarGanchos('tfd_ajuda_custo', {
  antesSalvar(d, { atual }) {
    d.valor = Math.round(Number(d.quantidade ?? atual?.quantidade ?? 1) * Number(d.valor_unitario ?? atual?.valor_unitario ?? 0) * 100) / 100;
    if (d.situacao === 'PAGO' && !d.data_pagamento && !atual?.data_pagamento) d.data_pagamento = new Date().toISOString().slice(0, 10);
  },
  async depoisSalvar(r, { cliente, atual, usuario }) {
    if (!atual) await registrarTramite(cliente, r.laudo_id, 'Ajuda de custo lançada', `${r.tipo} - R$ ${Number(r.valor).toFixed(2).replace('.', ',')}`, null, usuario);
    else if (atual.situacao !== r.situacao) await registrarTramite(cliente, r.laudo_id, `Ajuda de custo ${String(r.situacao).toLowerCase()}`, `${r.tipo} - R$ ${Number(r.valor).toFixed(2).replace('.', ',')}`, null, usuario);
  },
});

async function carregarLaudo(id: number) {
  const l = await consultarUm(
    `select l.*, l.data_abertura::text data_abertura, p.nome paciente, p.cns, p.cpf, p.data_nascimento::text nascimento, p.sexo, p.nome_mae, coalesce(p.celular, p.telefone) telefone,
            trim(concat_ws(', ', concat_ws(' ', lg.tipo_abreviatura, lg.nome), p.numero, p.complemento, b.nome)) endereco, mp.nome municipio_paciente, mp.uf_sigla uf_paciente,
            un.nome unidade, un.cnes, pf.nome profissional, pf.conselho, pf.registro_conselho, pf.uf_conselho,
            ci.codigo cid_codigo, ci.nome cid_nome, pr.codigo procedimento_codigo, pr.nome procedimento, es.nome especialidade, md.nome municipio_destino,
            ld.nome local_tratamento, ml.nome municipio_tratamento, ld.endereco endereco_tratamento,
            oa.nome aprovado_por_nome, oz.nome autorizado_por_nome, ot.nome tratamento_autorizado_por_nome, oal.nome alterado_por_nome,
            ${SQL_SITUACAO_ATUAL('l')} situacao_atual
       from tfd.laudo l join cad.pessoa p on p.id = l.paciente_id left join cad.logradouro lg on lg.id = p.logradouro_id left join cad.bairro b on b.id = p.bairro_id
       left join cad.municipio mp on mp.id = p.municipio_id join cad.unidade un on un.id = l.unidade_solicitante_id join cad.profissional pf on pf.id = l.profissional_solicitante_id
       left join cad.cid ci on ci.id = l.cid_id left join cad.procedimento pr on pr.id = l.procedimento_id left join cad.especialidade es on es.id = l.especialidade_id
       left join cad.municipio md on md.id = l.municipio_destino_id left join tra.local_destino ld on ld.id = l.local_tratamento_id left join cad.municipio ml on ml.id = ld.municipio_id
       left join seg.operador oa on oa.id = l.aprovado_por left join seg.operador oz on oz.id = l.autorizado_por left join seg.operador ot on ot.id = l.tratamento_autorizado_por
       left join seg.operador oal on oal.id = l.alterado_por
      where l.id = $1`,
    [id],
  );
  if (!l) throw new ErroHttp(404, 'Laudo não encontrado.');
  const [tramites, complementos, acompanhantes, documentos, ajudas, viagens] = await Promise.all([
    consultar(`select t.id, t.data_hora, t.acao, t.descricao, t.situacao, o.nome operador from tfd.laudo_tramite t left join seg.operador o on o.id = t.operador_id where t.laudo_id = $1 order by t.data_hora, t.id`, [id]),
    consultar(`select c.id, c.data_hora, c.texto, o.nome operador from tfd.laudo_complemento c left join seg.operador o on o.id = c.operador_id where c.laudo_id = $1 order by c.data_hora`, [id]),
    consultar(`select * from tfd.laudo_acompanhante where laudo_id = $1 order by id`, [id]),
    consultar(`select id, tipo, descricao, arquivo_id from tfd.laudo_documento where laudo_id = $1 order by id`, [id]),
    consultar(`select a.*, a.data::text data, a.data_pagamento::text data_pagamento from tfd.ajuda_custo a where a.laudo_id = $1 order by a.data, a.id`, [id]),
    consultar(
      `select vp.id, vp.protocolo, vp.situacao, v.id viagem_id, v.data_saida::text data_saida, to_char(coalesce(vp.hora_saida, v.hora_saida), 'HH24:MI') hora, r.nome rota, vp.local_destino,
              (select count(*)::int from tra.viagem_acompanhante a where a.passageiro_id = vp.id) acompanhantes
         from tra.viagem_passageiro vp join tra.viagem v on v.id = vp.viagem_id left join tra.rota r on r.id = v.rota_id where vp.tfd_laudo_id = $1 order by v.data_saida`,
      [id],
    ),
  ]);
  return { laudo: l, tramites, complementos, acompanhantes, documentos, ajudas, viagens };
}

const secao = (titulo: string, texto?: string | null) => [
  { text: titulo, style: 'h2', fontSize: 9 },
  { text: texto?.trim() || '-', fontSize: 9, margin: [0, 0, 0, 2] },
];
const tabelaDados = (linhas: [string, unknown][]) => ({
  table: { widths: [120, '*'], body: linhas.map(([a, b]) => [{ text: a, bold: true, fontSize: 8 }, { text: String(b ?? '-'), fontSize: 8 }]) },
  layout: 'lightHorizontalLines',
  margin: [0, 0, 0, 4],
});

async function pdfLaudo(id: number, u: Usuario) {
  const d = await carregarLaudo(id);
  const l = d.laudo;
  return emitirDocumento(
    { relatorio: 'tfd:laudo', titulo: `Laudo médico para Tratamento Fora do Domicílio nº ${l.numero}`, filtros: { laudo: id } },
    [
      tabelaDados([
        ['Data de abertura', fmtData(l.data_abertura)],
        ['Situação', l.situacao_atual],
        ['Unidade solicitante', `${l.unidade}${l.cnes ? ` (CNES ${l.cnes})` : ''}`],
        ['Profissional solicitante', `${l.profissional}${l.registro_conselho ? ` - ${l.conselho ?? 'CRM'} ${l.registro_conselho}/${l.uf_conselho ?? ''}` : ''}`],
      ]),
      { text: 'Identificação do paciente', style: 'h2' },
      tabelaDados([
        ['Nome', l.paciente],
        ['CNS / CPF', `${l.cns ?? '-'} / ${l.cpf ?? '-'}`],
        ['Nascimento / idade / sexo', `${fmtData(l.nascimento)} · ${idadeTexto(l.nascimento)} · ${l.sexo ?? '-'}`],
        ['Nome da mãe', l.nome_mae],
        ['Endereço', [l.endereco, l.municipio_paciente && `${l.municipio_paciente}/${l.uf_paciente}`].filter(Boolean).join(' - ')],
        ['Telefone', l.telefone],
      ]),
      { text: 'Solicitação', style: 'h2' },
      tabelaDados([
        ['CID', `${l.cid_codigo ?? ''} - ${l.cid_nome ?? ''}`],
        ['Procedimento', `${l.procedimento_codigo ?? ''} - ${l.procedimento ?? ''}`],
        ['Especialidade', l.especialidade],
        ['Caráter', l.carater],
        ['Referência pretendida', [l.unidade_referencia, l.municipio_destino].filter(Boolean).join(' - ')],
        ['Tipo de transporte', ROTULO_TRANSPORTE[l.tipo_transporte] ?? l.tipo_transporte],
        ['Necessita acompanhante', l.necessita_acompanhante ? 'Sim' : 'Não'],
      ]),
      ...(l.necessita_acompanhante ? secao('Justificativa para a necessidade de acompanhante', l.justificativa_acompanhante) : []),
      ...secao('Diagnóstico inicial', l.diagnostico_inicial),
      ...secao('Diagnóstico provável', l.diagnostico_provavel),
      ...secao('Histórico da doença', l.historico_doenca),
      ...secao('Exame físico', l.exame_fisico),
      ...secao('Exames complementares', l.exames_complementares),
      ...secao('Tratamentos realizados', l.tratamentos_realizados),
      ...secao('Razões que impossibilitam a realização do tratamento no município', l.razoes_impossibilidade),
      ...(d.acompanhantes.length ? [{ text: 'Acompanhantes', style: 'h2' }, { ul: d.acompanhantes.map((a: any) => `${a.nome}${a.parentesco ? ` (${a.parentesco})` : ''}${a.cpf ? ` - CPF ${a.cpf}` : ''}`), fontSize: 8 }] : []),
      ...(d.complementos.length
        ? [{ text: 'Complementos', style: 'h2' }, ...d.complementos.map((c: any) => ({ text: `${fmtDataHora(c.data_hora)} - ${c.operador ?? '-'}: ${c.texto}`, fontSize: 8, margin: [0, 0, 0, 2] }))]
        : []),
      {
        columns: [
          { text: '_______________________________\nProfissional solicitante (assinatura e carimbo)', alignment: 'center', fontSize: 8 },
          { text: '_______________________________\nAutorização / regulação do TFD', alignment: 'center', fontSize: 8 },
        ],
        margin: [0, 36, 0, 0],
      },
    ] as any,
    {},
    u,
  );
}

export default async function rotasTfd(app: FastifyInstance) {
  // Localização por data de abertura, número, paciente e profissional solicitante (TR 1.2.35.5).
  app.get('/api/tfd/laudos', async (req) => {
    exigirPermissao(req, 'laudo_tfd:consultar');
    const q = req.query as any;
    return consultar(
      `select l.id, l.numero, l.data_abertura::text data_abertura, p.nome paciente, l.paciente_id, pf.nome profissional, un.nome unidade, pr.nome procedimento, ci.codigo cid,
              l.situacao, l.situacao_tratamento, ${SQL_SITUACAO_ATUAL('l')} situacao_atual, ld.nome local_tratamento
         from tfd.laudo l join cad.pessoa p on p.id = l.paciente_id join cad.profissional pf on pf.id = l.profissional_solicitante_id join cad.unidade un on un.id = l.unidade_solicitante_id
         left join cad.procedimento pr on pr.id = l.procedimento_id left join cad.cid ci on ci.id = l.cid_id left join tra.local_destino ld on ld.id = l.local_tratamento_id
        where ($1::date is null or l.data_abertura >= $1) and ($2::date is null or l.data_abertura <= $2) and ($3::text is null or l.numero ilike '%' || $3 || '%')
          and ($4::text is null or cad.fn_normalizar(p.nome) like '%' || cad.fn_normalizar($4) || '%') and ($5::text is null or cad.fn_normalizar(pf.nome) like '%' || cad.fn_normalizar($5) || '%')
          and ($6::text is null or l.situacao = $6) and ($7::bigint is null or l.paciente_id = $7) and ($8::text is null or l.situacao_tratamento = $8)
        order by l.data_abertura desc, l.id desc limit 300`,
      [q.de || null, q.ate || null, q.numero || null, q.paciente || null, q.profissional || null, q.situacao || null, q.pacienteId ? Number(q.pacienteId) : null, q.tratamento || null],
    );
  });

  // Todos os trâmites e dados do processo (TR 1.2.35.18).
  app.get('/api/tfd/laudos/:id', async (req) => {
    exigirPermissao(req, 'laudo_tfd:consultar');
    return carregarLaudo(idParam(req));
  });

  app.post('/api/tfd/laudos/:id/acoes/:acao', async (req) => {
    const u = exigirPermissao(req, 'tfd_decisao:executar');
    const acao = (req.params as any).acao as AcaoLaudo;
    const b = z.object({ motivo: z.string().max(250).nullish(), localTratamentoId: z.number().nullish(), dataHoraAgendamento: z.string().nullish() }).parse(req.body ?? {});
    return transacao(contextoDe(req, `tfd:${acao}`), (c) => executarAcao(c, idParam(req), acao, b, u));
  });

  app.post('/api/tfd/laudos/:id/complementos', async (req, reply) => {
    const u = exigirPermissao(req, 'laudo_tfd:alterar');
    const { texto } = z.object({ texto: z.string().trim().min(3).max(4000) }).parse(req.body);
    await transacao(contextoDe(req, 'tfd:complemento'), async (c) => {
      const l = (await c.query(`select situacao from tfd.laudo where id = $1`, [idParam(req)])).rows[0];
      if (!l) throw new ErroHttp(404, 'Laudo não encontrado.');
      if (l.situacao === 'ARQUIVADO') throw new ErroHttp(422, 'Laudo arquivado.');
      await c.query(`insert into tfd.laudo_complemento (laudo_id, data_hora, texto, operador_id) values ($1, now(), $2, $3)`, [idParam(req), texto, u.id]);
      await registrarTramite(c, idParam(req), 'Complemento incluído', texto, null, u);
    });
    return reply.status(201).send({ ok: true });
  });

  // Impressão automática após a inclusão e reimpressão do laudo (TR 1.2.35.2, 1.2.35.3).
  app.get('/api/tfd/laudos/:id/pdf', async (req, reply) => {
    const u = exigirPermissao(req, 'laudo_tfd:consultar');
    return pdf(reply, await pdfLaudo(idParam(req), u));
  });

  // Pedido de TFD após a autorização (TR 1.2.35.12).
  app.get('/api/tfd/laudos/:id/pedido', async (req, reply) => {
    const u = exigirPermissao(req, 'laudo_tfd:consultar');
    const d = await carregarLaudo(idParam(req));
    const l = d.laudo;
    if (l.situacao !== 'AUTORIZADO') throw new ErroHttp(422, 'O pedido de TFD só pode ser impresso após a autorização do laudo (TR 1.2.35.12).');
    const r = await emitirDocumento(
      { relatorio: 'tfd:pedido', titulo: `Pedido de Tratamento Fora do Domicílio - laudo nº ${l.numero}`, filtros: { laudo: l.id } },
      [
        { text: 'A Secretaria Municipal de Saúde autoriza o Tratamento Fora do Domicílio do paciente abaixo identificado, nos termos da Portaria SAS/MS nº 55/1999.', margin: [0, 0, 0, 8] },
        tabelaDados([
          ['Paciente', l.paciente],
          ['CNS / CPF', `${l.cns ?? '-'} / ${l.cpf ?? '-'}`],
          ['Nascimento', `${fmtData(l.nascimento)} (${idadeTexto(l.nascimento)})`],
          ['Endereço', [l.endereco, l.municipio_paciente].filter(Boolean).join(' - ')],
          ['CID', `${l.cid_codigo ?? ''} - ${l.cid_nome ?? ''}`],
          ['Procedimento', `${l.procedimento_codigo ?? ''} - ${l.procedimento ?? ''}`],
          ['Unidade / profissional solicitante', `${l.unidade} / ${l.profissional}`],
          ['Local de tratamento', l.local_tratamento ? `${l.local_tratamento} - ${l.municipio_tratamento ?? ''}${l.endereco_tratamento ? ` (${l.endereco_tratamento})` : ''}` : 'A definir na autorização do tratamento'],
          ['Atendimento agendado', fmtDataHora(l.agendamento_data_hora) || '-'],
          ['Tipo de transporte', ROTULO_TRANSPORTE[l.tipo_transporte] ?? l.tipo_transporte],
          ['Acompanhante', l.necessita_acompanhante ? d.acompanhantes.map((a: any) => a.nome).join(', ') || 'Autorizado (a identificar)' : 'Não'],
          ['Laudo aprovado', `${fmtDataHora(l.aprovado_em)} por ${l.aprovado_por_nome ?? '-'}`],
          ['Pedido autorizado', `${fmtDataHora(l.autorizado_em)} por ${l.autorizado_por_nome ?? '-'}`],
          ['Tratamento', l.situacao_tratamento === 'AUTORIZADO' ? `Autorizado em ${fmtDataHora(l.tratamento_autorizado_em)} por ${l.tratamento_autorizado_por_nome ?? '-'} - ${l.motivo_tratamento ?? ''}` : (ROTULO_SITUACAO[l.situacao_tratamento] ?? l.situacao_tratamento)],
        ]),
        ...(d.viagens.length ? [{ text: 'Transporte agendado', style: 'h2' }, { ul: d.viagens.filter((v: any) => v.situacao !== 'CANCELADO').map((v: any) => `${fmtData(v.data_saida)} às ${v.hora} - ${v.rota ?? 'viagem extra'} - protocolo ${v.protocolo}`), fontSize: 8 }] : []),
        ...(d.ajudas.length ? [{ text: 'Ajudas de custo', style: 'h2' }, { ul: d.ajudas.map((a: any) => `${fmtData(a.data)} - ${a.tipo} (${a.beneficiario}) - R$ ${Number(a.valor).toFixed(2).replace('.', ',')} - ${a.situacao}`), fontSize: 8 }] : []),
        {
          columns: [
            { text: '_______________________________\nResponsável pelo TFD', alignment: 'center', fontSize: 8 },
            { text: '_______________________________\nPaciente ou responsável', alignment: 'center', fontSize: 8 },
          ],
          margin: [0, 40, 0, 0],
        },
      ] as any,
      {},
      u,
    );
    return pdf(reply, r);
  });
}
