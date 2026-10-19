// Rotas de assinatura eletrônica: repositório de certificados, assinatura de documentos emitidos
// e solicitações de assinatura (TR 1.1.1.44 a 1.1.1.56, 1.1.2.1.63).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { consultar, transacao } from '../../db/pool.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { contextoDe, exigirPermissao, exigirUsuario } from '../../seguranca/usuario.js';
import {
  alertarCertificadosVencendo,
  assinarDocumento,
  certificadosDoOperador,
  criarCertificadoAvancado,
  criarSolicitacao,
  importarCertificado,
  jaAssinado,
  lerPkcs12,
  pendentesDoOperador,
  responderSolicitacao,
} from '../../servicos/assinatura.js';
import { registrarTarefaDiaria } from '../rotas.js';

registrarPermissao('assinatura', 'Assinatura eletrônica de documentos', 'TEC', ['executar']);
registrarTarefaDiaria(alertarCertificadosVencendo);

const local = z.object({ pfx: z.string().min(10), senha: z.string() }).nullish();

export default async function rotasAssinatura(app: FastifyInstance) {
  app.get('/api/assinatura/certificados', async (req) => certificadosDoOperador(exigirUsuario(req)));

  // Importação de certificado A1 do operador ou, por administrador, da contratante (TR 1.1.1.44, 1.1.1.46).
  app.post('/api/assinatura/certificados/importar', async (req) => {
    const u = exigirUsuario(req);
    const b = z.object({ pfx: z.string().min(10), senha: z.string(), entidade: z.boolean().default(false) }).parse(req.body);
    if (b.entidade) exigirPermissao(req, 'certificado:incluir');
    return transacao(contextoDe(req, 'certificado:importar'), (c) => importarCertificado(c, Buffer.from(b.pfx, 'base64'), b.senha, b.entidade ? 'A1_ENTIDADE' : 'A1_OPERADOR', u.id));
  });

  // Lista os dados do certificado local antes de assinar, para conferência (TR 1.1.1.50, 1.1.1.51).
  app.post('/api/assinatura/certificados/conferir', async (req) => {
    exigirUsuario(req);
    const b = z.object({ pfx: z.string().min(10), senha: z.string() }).parse(req.body);
    const i = lerPkcs12(Buffer.from(b.pfx, 'base64'), b.senha);
    return { ...i, vencido: i.fim < new Date() };
  });

  app.post('/api/assinatura/certificados/avancado', async (req) => {
    const u = exigirUsuario(req);
    return transacao(contextoDe(req, 'certificado:avancado'), (c) => criarCertificadoAvancado(c, u));
  });

  // Documentos emitidos pelo operador (atestados, receitas, requisições, encaminhamentos, relatórios) para assinar (TR 1.1.2.1.63).
  app.get('/api/assinatura/documentos', async (req) => {
    const u = exigirUsuario(req);
    const q = req.query as any;
    return consultar(
      `select r.codigo, r.titulo, r.relatorio, r.emitido_em, r.assinado,
              (select json_agg(json_build_object('signatario', a.signatario, 'modalidade', a.modalidade, 'assinado_em', a.assinado_em) order by a.assinado_em) from sis.assinatura a where a.relatorio_codigo = r.codigo) assinaturas
         from sis.relatorio_emitido r where r.operador_id = $1 and r.formato = 'pdf' and r.situacao = 'concluido'
          and ($2::text is null or r.titulo ilike '%' || $2 || '%' or r.codigo = $2) order by r.emitido_em desc limit 100`,
      [u.id, q.busca || null],
    );
  });

  app.get('/api/assinatura/documentos/:codigo/ja-assinado', async (req) => ({ jaAssinado: await jaAssinado((req.params as any).codigo, exigirUsuario(req).id) }));

  app.post('/api/assinatura/assinar', async (req) => {
    const u = exigirUsuario(req);
    const b = z
      .object({ codigos: z.array(z.string()).min(1), modalidade: z.enum(['BASICA', 'AVANCADA', 'QUALIFICADA']), certificadoId: z.number().nullish(), certificadoLocal: local })
      .parse(req.body);
    return transacao(contextoDe(req, 'assinatura'), async (c) => {
      const r = [];
      for (const codigo of b.codigos) r.push(await assinarDocumento(c, { codigo, modalidade: b.modalidade, certificadoId: b.certificadoId, certificadoLocal: b.certificadoLocal, ip: req.ip }, u));
      return r.map((x) => ({ codigo: x.relatorio_codigo, signatario: x.signatario, modalidade: x.modalidade }));
    });
  });

  app.get('/api/assinatura/solicitacoes/pendentes', async (req) => pendentesDoOperador(exigirUsuario(req)));

  app.get('/api/assinatura/solicitacoes/minhas', async (req) => {
    const u = exigirUsuario(req);
    return consultar(
      `select s.*, (select json_agg(json_build_object('ordem', g.ordem, 'nome', coalesce(o.nome, p.nome), 'situacao', g.situacao, 'motivo', g.motivo_rejeicao, 'respondido_em', g.respondido_em) order by g.ordem)
                     from sis.solicitacao_assinatura_signatario g left join seg.operador o on o.id = g.operador_id left join cad.pessoa p on p.id = g.cidadao_id where g.solicitacao_id = s.id) signatarios,
              (select json_agg(json_build_object('codigo', d.relatorio_codigo, 'titulo', d.titulo)) from sis.solicitacao_assinatura_documento d where d.solicitacao_id = s.id) documentos
         from sis.solicitacao_assinatura s where s.solicitante_id = $1 order by s.criada_em desc limit 100`,
      [u.id],
    );
  });

  app.post('/api/assinatura/solicitacoes', async (req) => {
    const u = exigirUsuario(req);
    const b = z
      .object({
        titulo: z.string().min(3),
        modo: z.enum(['SEQUENCIAL', 'UNIFICADA']),
        notificarConclusao: z.boolean().default(true),
        documentos: z.array(z.string()).min(1),
        signatarios: z.array(z.object({ operadorId: z.number().optional(), cidadaoId: z.number().optional(), modalidade: z.enum(['BASICA', 'AVANCADA', 'QUALIFICADA']).optional() })).min(1),
      })
      .parse(req.body);
    return transacao(contextoDe(req, 'assinatura:solicitacao'), (c) => criarSolicitacao(c, b, u));
  });

  app.post('/api/assinatura/solicitacoes/:id/responder', async (req) => {
    const u = exigirUsuario(req);
    const b = z.object({ acao: z.enum(['ASSINAR', 'REJEITAR']), motivo: z.string().optional(), certificadoId: z.number().nullish(), certificadoLocal: local }).parse(req.body);
    return transacao(contextoDe(req, 'assinatura:responder'), (c) => responderSolicitacao(c, { solicitacaoId: Number((req.params as any).id), ...b, ip: req.ip }, u));
  });
}
