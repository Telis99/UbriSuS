// Assinatura eletrônica de documentos PDF dentro do sistema (TR 1.1.1.44 a 1.1.1.56, 1.1.2.1.63; Lei 14.063/2020):
// básica (operador autenticado), avançada (certificado individual emitido pelo sistema) e qualificada
// (certificado ICP-Brasil A1 do operador ou da contratante), no padrão PAdES (CAdES destacado).
import forge from 'node-forge';
import { randomBytes, createHash } from 'node:crypto';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { P12Signer } from '@signpdf/signer-p12';
import { SignPdf } from '@signpdf/signpdf';
import { SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import type pg from 'pg';
import { consultarUm, pool } from '../db/pool.js';
import { ErroHttp, type Usuario } from '../seguranca/usuario.js';
import { lerArquivo, salvarArquivo } from './arquivos.js';
import { cifrar, decifrar } from './cripto.js';
import { codigoBarras, urlValidacao } from './pdf.js';

type C = pg.PoolClient;
export type Modalidade = 'BASICA' | 'AVANCADA' | 'QUALIFICADA';

interface Pacote {
  pfx: string;
  senha: string;
}

/** Lê um arquivo PKCS#12 (.pfx/.p12) e extrai titular, documento, emissor, série e validade. */
export function lerPkcs12(pfx: Buffer, senha: string) {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(pfx.toString('binary')), false, senha);
  } catch {
    throw new ErroHttp(422, 'Não foi possível abrir o certificado: arquivo inválido ou senha incorreta.');
  }
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  if (!bags.length || !chaves.length) throw new ErroHttp(422, 'O arquivo não contém certificado e chave privada.');
  // O certificado do titular é o que não é emissor de nenhum outro da cadeia.
  const certs = bags.map((b) => b.cert!).filter(Boolean);
  const cert = certs.find((c) => !certs.some((o) => o !== c && o.issuer.hash === c.subject.hash)) ?? certs[0];
  const cn = String(cert.subject.getField('CN')?.value ?? '');
  const [titular, documento] = cn.includes(':') ? cn.split(':') : [cn, null];
  return {
    titular,
    documento: documento?.replace(/\D/g, '') || null,
    emissor: String(cert.issuer.getField('CN')?.value ?? cert.issuer.attributes.map((a) => a.value).join(', ')),
    serie: cert.serialNumber,
    inicio: cert.validity.notBefore,
    fim: cert.validity.notAfter,
  };
}

/** Armazena no repositório um certificado A1 (do operador ou da contratante) cifrado (TR 1.1.1.44, 1.1.1.46). */
export async function importarCertificado(c: C, pfx: Buffer, senha: string, tipo: 'A1_OPERADOR' | 'A1_ENTIDADE', operadorId: number | null) {
  const info = lerPkcs12(pfx, senha);
  if (info.fim < new Date()) throw new ErroHttp(422, `Certificado vencido em ${info.fim.toLocaleDateString('pt-BR')}.`);
  const pacote: Pacote = { pfx: pfx.toString('base64'), senha };
  return (
    await c.query(
      `insert into seg.certificado (titular, tipo, operador_id, documento_titular, emissor, numero_serie, validade_inicio, validade_fim, conteudo_cifrado, ativo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) returning id, titular, validade_fim`,
      [info.titular, tipo, tipo === 'A1_OPERADOR' ? operadorId : null, info.documento, info.emissor, info.serie, info.inicio, info.fim, cifrar(JSON.stringify(pacote))],
    )
  ).rows[0];
}

/** Autoridade certificadora interna usada nas assinaturas avançadas (criada uma única vez). */
async function acSistema(c: C) {
  const r = (await c.query(`select valor from sis.parametro where chave = 'assinatura.ac_sistema'`)).rows[0]?.valor;
  if (r?.cifrado) return JSON.parse(decifrar(r.cifrado).toString()) as { cert: string; chave: string };
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '01' + randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 20 * 365 * 86_400_000);
  const nome = [{ name: 'commonName', value: 'AC UBRISUS - ASSINATURA AVANCADA' }, { name: 'organizationName', value: 'Secretaria Municipal de Saude' }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const ac = { cert: forge.pki.certificateToPem(cert), chave: forge.pki.privateKeyToPem(chaves.privateKey) };
  await c.query(
    `insert into sis.parametro (chave, valor, descricao, modulo) values ('assinatura.ac_sistema', $1, 'Autoridade certificadora interna (assinatura avançada)', 'TEC')
     on conflict (chave) do update set valor = excluded.valor`,
    [JSON.stringify({ cifrado: cifrar(JSON.stringify(ac)) })],
  );
  return ac;
}

/** Cria o certificado individual e exclusivo do operador para assinatura avançada (TR 1.1.1.45). */
export async function criarCertificadoAvancado(c: C, u: Usuario) {
  const existente = (await c.query(`select id from seg.certificado where operador_id = $1 and tipo = 'AVANCADA' and ativo and validade_fim > now()`, [u.id])).rows[0];
  if (existente) throw new ErroHttp(409, 'O operador já possui certificado de assinatura avançada válido.');
  const op = (await c.query(`select o.nome, p.cpf from seg.operador o left join cad.pessoa p on p.id = o.pessoa_id where o.id = $1`, [u.id])).rows[0];
  const ac = await acSistema(c);
  const acCert = forge.pki.certificateFromPem(ac.cert);
  const acChave = forge.pki.privateKeyFromPem(ac.chave);
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '02' + randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 3 * 365 * 86_400_000);
  cert.setSubject([{ name: 'commonName', value: `${op?.nome ?? u.nome}${op?.cpf ? ':' + op.cpf : ''}` }, { name: 'countryName', value: 'BR' }]);
  cert.setIssuer(acCert.subject.attributes);
  cert.setExtensions([{ name: 'keyUsage', digitalSignature: true, nonRepudiation: true }]);
  cert.sign(acChave, forge.md.sha256.create());
  const senha = randomBytes(18).toString('base64');
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert, acCert], senha, { algorithm: '3des' });
  const pfx = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
  return (
    await c.query(
      `insert into seg.certificado (titular, tipo, operador_id, documento_titular, emissor, numero_serie, validade_inicio, validade_fim, conteudo_cifrado, ativo)
       values ($1,'AVANCADA',$2,$3,$4,$5,$6,$7,$8,true) returning id, titular, validade_fim`,
      [op?.nome ?? u.nome, u.id, op?.cpf ?? null, 'AC UBRISUS - ASSINATURA AVANCADA', cert.serialNumber, cert.validity.notBefore, cert.validity.notAfter, cifrar(JSON.stringify({ pfx: pfx.toString('base64'), senha }))],
    )
  ).rows[0];
}

/** Certificados que o operador pode usar: os próprios e os da contratante a que foi autorizado (TR 1.1.1.51, 1.1.1.56.4). */
export async function certificadosDoOperador(u: Usuario) {
  return (
    await pool.query(
      `select c.id, c.titular, c.tipo, c.emissor, c.numero_serie, c.documento_titular, c.validade_inicio, c.validade_fim, (c.validade_fim < now()) vencido,
              (c.validade_fim < now() + interval '30 days') a_vencer, c.carimbo_id
         from seg.certificado c
        where c.ativo and (c.operador_id = $1 or (c.tipo = 'A1_ENTIDADE' and exists (select 1 from seg.certificado_autorizado a where a.certificado_id = c.id and a.operador_id = $1)))
        order by c.validade_fim desc`,
      [u.id],
    )
  ).rows;
}

/** Carimbo visual com signatário, data, código de validação e QR Code na última página (TR 1.1.1.56.1, 1.1.1.56.7). */
async function carimbar(pdf: Buffer, d: { signatario: string; modalidade: Modalidade; codigo: string; carimboId?: string | null; ordem: number }) {
  const doc = await PDFDocument.load(pdf);
  const pagina = doc.getPages()[doc.getPageCount() - 1];
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const largura = 250;
  const altura = 46;
  const x = pagina.getWidth() - largura - 20 - ((d.ordem - 1) % 2) * (largura + 6);
  const y = 60 + Math.floor((d.ordem - 1) / 2) * (altura + 4);
  pagina.drawRectangle({ x, y, width: largura, height: altura, borderColor: rgb(0.1, 0.3, 0.6), borderWidth: 0.8, color: rgb(0.96, 0.97, 1) });
  const qr = await codigoBarras(urlValidacao(d.codigo), 'qrcode');
  const img = await doc.embedPng(Buffer.from(qr.split(',')[1], 'base64'));
  pagina.drawImage(img, { x: x + 3, y: y + 3, width: 40, height: 40 });
  let tx = x + 47;
  if (d.carimboId) {
    const arq = await lerArquivo(d.carimboId).catch(() => null);
    if (arq) {
      const im = arq.tipo_mime?.includes('png') ? await doc.embedPng(arq.conteudo) : await doc.embedJpg(arq.conteudo);
      pagina.drawImage(im, { x: tx, y: y + 3, width: 40, height: 40 });
      tx += 44;
    }
  }
  const nomeMod = { BASICA: 'Assinatura eletrônica básica', AVANCADA: 'Assinatura eletrônica avançada', QUALIFICADA: 'Assinatura digital qualificada ICP-Brasil' }[d.modalidade];
  pagina.drawText('Assinado eletronicamente por', { x: tx, y: y + 36, size: 6, font: fonte, color: rgb(0.2, 0.2, 0.2) });
  pagina.drawText(d.signatario.slice(0, 40), { x: tx, y: y + 27, size: 7, font: negrito });
  pagina.drawText(`${nomeMod} - ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`.slice(0, 70), { x: tx, y: y + 18, size: 5.5, font: fonte });
  pagina.drawText(`Código ${d.codigo} - validar em`, { x: tx, y: y + 10, size: 5.5, font: fonte });
  pagina.drawText(urlValidacao(d.codigo).slice(0, 62), { x: tx, y: y + 3, size: 5, font: fonte, color: rgb(0.1, 0.3, 0.6) });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Assina criptograficamente o PDF no padrão PAdES (CAdES destacado). */
async function assinarPkcs12(pdf: Buffer, pacote: Pacote, signatario: string) {
  const comPlaceholder = plainAddPlaceholder({
    pdfBuffer: pdf,
    reason: 'Assinatura de documento oficial',
    contactInfo: '',
    name: signatario,
    location: 'Brasil',
    signatureLength: 16384,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    appName: 'UbriSUS',
  });
  return new SignPdf().sign(comPlaceholder, new P12Signer(Buffer.from(pacote.pfx, 'base64'), { passphrase: pacote.senha }));
}

export interface PedidoAssinatura {
  codigo: string;
  modalidade: Modalidade;
  certificadoId?: number | null;
  /** Certificado A1 instalado na máquina do operador, enviado apenas para esta assinatura (TR 1.1.1.50). */
  certificadoLocal?: { pfx: string; senha: string } | null;
  modulo?: string;
  ip?: string;
}

/** Assina um documento emitido pelo sistema sem download/upload (TR 1.1.1.47, 1.1.1.53.1) e registra o uso do certificado (TR 1.1.1.49). */
export async function assinarDocumento(c: C, p: PedidoAssinatura, u: Usuario) {
  const doc = (await c.query(`select * from sis.relatorio_emitido where codigo = $1 for update`, [p.codigo])).rows[0];
  if (!doc?.arquivo_id) throw new ErroHttp(404, 'Documento não encontrado ou ainda em emissão.');
  if (doc.formato !== 'pdf') throw new ErroHttp(422, 'Somente documentos PDF podem ser assinados.');
  const somenteQualificada = (await c.query(`select valor from sis.parametro where chave = 'assinatura.somente_qualificada'`)).rows[0]?.valor === true;
  if (somenteQualificada && p.modalidade !== 'QUALIFICADA') throw new ErroHttp(422, 'A configuração exige assinatura digital qualificada (ICP-Brasil) (TR 1.1.1.52.2).');
  let pacote: Pacote | null = null;
  let cert: any = null;
  if (p.modalidade !== 'BASICA') {
    if (p.certificadoLocal) {
      const info = lerPkcs12(Buffer.from(p.certificadoLocal.pfx, 'base64'), p.certificadoLocal.senha);
      if (info.fim < new Date()) throw new ErroHttp(422, 'Certificado vencido.');
      pacote = p.certificadoLocal;
      cert = { id: null, titular: info.titular, numero_serie: info.serie, tipo: 'A1_LOCAL', carimbo_id: null };
    } else {
      const disponiveis = await certificadosDoOperador(u);
      cert = disponiveis.find((x) => x.id === Number(p.certificadoId)) ?? disponiveis.find((x) => (p.modalidade === 'AVANCADA' ? x.tipo === 'AVANCADA' : x.tipo !== 'AVANCADA') && !x.vencido);
      if (!cert) throw new ErroHttp(422, p.modalidade === 'AVANCADA' ? 'Crie seu certificado de assinatura avançada antes de assinar.' : 'Nenhum certificado ICP-Brasil disponível para o operador.');
      if (cert.vencido) throw new ErroHttp(422, `Certificado de ${cert.titular} vencido em ${new Date(cert.validade_fim).toLocaleDateString('pt-BR')}.`);
      if (p.modalidade === 'QUALIFICADA' && cert.tipo === 'AVANCADA') throw new ErroHttp(422, 'A assinatura qualificada exige certificado ICP-Brasil.');
      const linha = (await c.query(`select conteudo_cifrado from seg.certificado where id = $1`, [cert.id])).rows[0];
      pacote = JSON.parse(decifrar(linha.conteudo_cifrado).toString());
    }
  }
  const ordem = Number((await c.query(`select count(*) n from sis.assinatura where relatorio_codigo = $1`, [p.codigo])).rows[0].n) + 1;
  const original = await lerArquivo(doc.arquivo_id, c);
  const signatario = cert?.titular ?? u.nome;
  const carimbado = await carimbar(original.conteudo, { signatario, modalidade: p.modalidade, codigo: p.codigo, carimboId: cert?.carimbo_id, ordem });
  const final = pacote ? await assinarPkcs12(carimbado, pacote, signatario) : carimbado;
  const novo = await salvarArquivo(original.nome.replace(/\.pdf$/i, '') + '_assinado.pdf', 'application/pdf', final, u.id, c);
  await c.query(`update sis.relatorio_emitido set arquivo_id = $2, assinado = true where id = $1`, [doc.id, novo]);
  return (
    await c.query(
      `insert into sis.assinatura (relatorio_codigo, arquivo_original_id, arquivo_assinado_id, operador_id, signatario, documento_signatario, modalidade, certificado_id, certificado_serie, hash_documento, ip, modulo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [p.codigo, doc.arquivo_id, novo, u.id, signatario, cert?.documento_titular ?? null, p.modalidade, cert?.id ?? null, cert?.numero_serie ?? null, createHash('sha256').update(final).digest('hex'), p.ip ?? null, p.modulo ?? doc.relatorio?.split(':')[0] ?? null],
    )
  ).rows[0];
}

/** Indica se o operador já assinou o documento (TR 1.1.1.56.2). */
export async function jaAssinado(codigo: string, operadorId: number) {
  return !!(await consultarUm(`select 1 from sis.assinatura where relatorio_codigo = $1 and operador_id = $2`, [codigo, operadorId]));
}

// ---------------------------------------------------------------------------
// Solicitações de assinatura (TR 1.1.1.54, 1.1.1.55)
// ---------------------------------------------------------------------------
export async function criarSolicitacao(
  c: C,
  d: { titulo: string; modo: 'SEQUENCIAL' | 'UNIFICADA'; notificarConclusao: boolean; documentos: string[]; signatarios: { operadorId?: number; cidadaoId?: number; modalidade?: Modalidade }[] },
  u: Usuario,
) {
  if (!d.documentos.length || !d.signatarios.length) throw new ErroHttp(422, 'Informe os documentos e os signatários.');
  const s = (await c.query(`insert into sis.solicitacao_assinatura (titulo, solicitante_id, modo, notificar_conclusao) values ($1,$2,$3,$4) returning *`, [d.titulo, u.id, d.modo, d.notificarConclusao])).rows[0];
  for (const codigo of d.documentos) {
    const r = (await c.query(`select titulo from sis.relatorio_emitido where codigo = $1 and formato = 'pdf'`, [codigo])).rows[0];
    if (!r) throw new ErroHttp(404, `Documento ${codigo} não encontrado.`);
    await c.query(`insert into sis.solicitacao_assinatura_documento (solicitacao_id, relatorio_codigo, titulo) values ($1,$2,$3)`, [s.id, codigo, r.titulo]);
  }
  for (const [i, sig] of d.signatarios.entries()) {
    await c.query(`insert into sis.solicitacao_assinatura_signatario (solicitacao_id, ordem, operador_id, cidadao_id, modalidade) values ($1,$2,$3,$4,$5)`, [
      s.id,
      i + 1,
      sig.operadorId ?? null,
      sig.cidadaoId ?? null,
      sig.modalidade ?? 'AVANCADA',
    ]);
    if (sig.operadorId && (d.modo === 'UNIFICADA' || i === 0))
      await c.query(`insert into sis.notificacao_operador (remetente_id, destinatario_id, titulo, mensagem) values ($1,$2,'Solicitação de assinatura',$3)`, [u.id, sig.operadorId, `${u.nome} solicitou sua assinatura em "${d.titulo}".`]);
  }
  return s;
}

/** Solicitações em que é a vez do operador assinar (no modo sequencial, após o signatário anterior). */
export async function pendentesDoOperador(u: Usuario) {
  return (
    await pool.query(
      `select s.id, s.titulo, s.modo, s.criada_em, o.nome solicitante, sg.id signatario_id, sg.modalidade,
              (select json_agg(json_build_object('codigo', d.relatorio_codigo, 'titulo', d.titulo,
                      'ja_assinado', exists (select 1 from sis.assinatura a where a.relatorio_codigo = d.relatorio_codigo and a.operador_id = $1))) from sis.solicitacao_assinatura_documento d where d.solicitacao_id = s.id) documentos
         from sis.solicitacao_assinatura_signatario sg join sis.solicitacao_assinatura s on s.id = sg.solicitacao_id join seg.operador o on o.id = s.solicitante_id
        where sg.operador_id = $1 and sg.situacao = 'PENDENTE' and s.situacao = 'PENDENTE'
          and (s.modo = 'UNIFICADA' or not exists (select 1 from sis.solicitacao_assinatura_signatario x where x.solicitacao_id = s.id and x.ordem < sg.ordem and x.situacao <> 'ASSINADO'))
        order by s.criada_em`,
      [u.id],
    )
  ).rows;
}

async function avancarSolicitacao(c: C, solicitacaoId: number, u: Usuario) {
  const s = (await c.query(`select * from sis.solicitacao_assinatura where id = $1`, [solicitacaoId])).rows[0];
  const sigs = (await c.query(`select * from sis.solicitacao_assinatura_signatario where solicitacao_id = $1 order by ordem`, [solicitacaoId])).rows;
  if (sigs.every((x) => x.situacao === 'ASSINADO')) {
    await c.query(`update sis.solicitacao_assinatura set situacao = 'CONCLUIDA', concluida_em = now() where id = $1`, [solicitacaoId]);
    if (s.notificar_conclusao)
      await c.query(`insert into sis.notificacao_operador (remetente_id, destinatario_id, titulo, mensagem) values ($1,$2,'Assinaturas concluídas',$3)`, [u.id, s.solicitante_id, `Todos os signatários assinaram "${s.titulo}".`]);
    return;
  }
  const proximo = sigs.find((x) => x.situacao === 'PENDENTE');
  if (s.modo === 'SEQUENCIAL' && proximo?.operador_id)
    await c.query(`insert into sis.notificacao_operador (remetente_id, destinatario_id, titulo, mensagem) values ($1,$2,'Solicitação de assinatura',$3)`, [s.solicitante_id, proximo.operador_id, `É a sua vez de assinar "${s.titulo}".`]);
}

export async function responderSolicitacao(c: C, d: { solicitacaoId: number; acao: 'ASSINAR' | 'REJEITAR'; motivo?: string; certificadoId?: number | null; certificadoLocal?: { pfx: string; senha: string } | null; ip?: string }, u: Usuario) {
  const pend = (await pendentesDoOperador(u)).find((x) => x.id === d.solicitacaoId);
  if (!pend) throw new ErroHttp(409, 'Não há assinatura pendente sua nesta solicitação.');
  if (d.acao === 'REJEITAR') {
    if (!d.motivo || d.motivo.length < 3) throw new ErroHttp(422, 'Informe o motivo da rejeição.');
    await c.query(`update sis.solicitacao_assinatura_signatario set situacao = 'REJEITADO', motivo_rejeicao = $2, respondido_em = now() where id = $1`, [pend.signatario_id, d.motivo]);
    await c.query(`update sis.solicitacao_assinatura set situacao = 'REJEITADA' where id = $1`, [d.solicitacaoId]);
    const s = (await c.query(`select solicitante_id, titulo from sis.solicitacao_assinatura where id = $1`, [d.solicitacaoId])).rows[0];
    await c.query(`insert into sis.notificacao_operador (remetente_id, destinatario_id, titulo, mensagem) values ($1,$2,'Assinatura rejeitada',$3)`, [u.id, s.solicitante_id, `${u.nome} rejeitou "${s.titulo}": ${d.motivo}`]);
    return { situacao: 'REJEITADA' };
  }
  for (const doc of pend.documentos ?? []) await assinarDocumento(c, { codigo: doc.codigo, modalidade: pend.modalidade, certificadoId: d.certificadoId, certificadoLocal: d.certificadoLocal, ip: d.ip }, u);
  await c.query(`update sis.solicitacao_assinatura_signatario set situacao = 'ASSINADO', respondido_em = now() where id = $1`, [pend.signatario_id]);
  await avancarSolicitacao(c, d.solicitacaoId, u);
  return { situacao: 'ASSINADO' };
}

/** Alerta diário de certificados próximos do vencimento (TR 1.1.1.48). */
export async function alertarCertificadosVencendo() {
  await pool.query(
    `insert into sis.notificacao_operador (destinatario_id, titulo, mensagem)
     select c.operador_id, 'Certificado digital a vencer', 'Seu certificado (' || c.titular || ') vence em ' || to_char(c.validade_fim, 'DD/MM/YYYY') || '. Providencie a renovação.'
       from seg.certificado c where c.ativo and c.operador_id is not null and c.validade_fim between now() and now() + interval '30 days'
        and not exists (select 1 from sis.notificacao_operador n where n.destinatario_id = c.operador_id and n.titulo = 'Certificado digital a vencer' and n.criado_em > now() - interval '7 days')`,
  );
}
