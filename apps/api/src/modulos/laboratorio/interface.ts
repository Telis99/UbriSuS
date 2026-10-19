// Interfaceamento com equipamentos de análise (TR 1.2.48): leitura de resultados e flags nos
// protocolos ASTM (E1394/LIS2-A2), HL7 v2 e Kermit/arquivo texto, comunicação mono e bidirecional
// (envio de pedidos e "request mode" pelo código de barras da amostra), Delta-Check na importação,
// rastreabilidade das mensagens e controle interno de qualidade com regras de Westgard.
import type pg from 'pg';
import { ErroHttp, type Usuario } from '../../seguranca/usuario.js';
import { numero } from './calculo.js';
import { liberarItens, P, salvarResultado, type Alerta } from './servico.js';

type C = pg.PoolClient;

export interface ResultadoLido {
  amostra: string;
  codigo: string;
  valor: string;
  unidade?: string;
  referencia?: string;
  flag?: string;
  situacao?: string;
}

const CONTROLE = /[\x02\x03\x04\x05\x06\x15\x17]/g;

/** ASTM E1394: registros H, P, O (amostra no campo 3), R (resultado), Q (consulta) e L. */
export function lerAstm(texto: string): { resultados: ResultadoLido[]; consultas: string[] } {
  const resultados: ResultadoLido[] = [];
  const consultas: string[] = [];
  let amostra = '';
  let comp = '^';
  for (let linha of texto.replace(CONTROLE, '').split(/\r\n|\r|\n/)) {
    linha = linha.trim();
    if (!linha) continue;
    // Quadros com número de sequência e checksum: "1H|..." / "...<ETX>A3".
    if (/^\d[A-Z]\|/.test(linha)) linha = linha.slice(1);
    const f = linha.split('|');
    const tipo = f[0].toUpperCase();
    if (tipo === 'H') comp = linha[3] ?? '^';
    if (tipo === 'O') amostra = (f[2] || f[3] || '').split(comp)[0].trim();
    if (tipo === 'Q') consultas.push((f[2] ?? '').split(comp).filter(Boolean)[0]?.trim() ?? '');
    if (tipo === 'R') {
      const ensaio = (f[2] ?? '').split(comp).filter(Boolean);
      resultados.push({
        amostra,
        codigo: (ensaio[0] ?? '').trim().toUpperCase(),
        valor: (f[3] ?? '').split(comp)[0].trim(),
        unidade: f[4]?.trim(),
        referencia: f[5]?.trim(),
        flag: f[6]?.trim(),
        situacao: f[8]?.trim(),
      });
    }
  }
  return { resultados, consultas };
}

/** HL7 v2 (ORU^R01): amostra em SPM-2, OBR-3 ou OBR-2; resultados em OBX. */
export function lerHl7(texto: string): { resultados: ResultadoLido[]; consultas: string[] } {
  const resultados: ResultadoLido[] = [];
  const consultas: string[] = [];
  let amostra = '';
  let comp = '^';
  for (const linha of texto.replace(CONTROLE, '').split(/\r\n|\r|\n/)) {
    const f = linha.trim().split('|');
    const seg = f[0]?.toUpperCase();
    if (seg === 'MSH') comp = f[1]?.[0] ?? '^';
    if (seg === 'OBR') amostra = (f[3] || f[2] || '').split(comp)[0].trim() || amostra;
    if (seg === 'SPM') amostra = (f[2] || '').split(comp)[0].trim() || amostra;
    if (seg === 'QRD' || seg === 'QPD') consultas.push((f[8] || f[3] || '').split(comp)[0].trim());
    if (seg === 'OBX') {
      resultados.push({
        amostra,
        codigo: (f[3] ?? '').split(comp)[0].trim().toUpperCase(),
        valor: (f[5] ?? '').split(comp)[0].trim(),
        unidade: (f[6] ?? '').split(comp)[0].trim(),
        referencia: f[7]?.trim(),
        flag: f[8]?.trim(),
        situacao: f[11]?.trim(),
      });
    }
  }
  return { resultados, consultas };
}

/** Kermit / arquivo texto: "amostra;código;valor;unidade;flag" (separador ; , tabulação ou |). */
export function lerTexto(texto: string): { resultados: ResultadoLido[]; consultas: string[] } {
  const resultados: ResultadoLido[] = [];
  for (const linha of texto.replace(CONTROLE, '').split(/\r\n|\r|\n/)) {
    if (!linha.trim() || /^(amostra|sample|#)/i.test(linha.trim())) continue;
    const f = linha.split(/[;\t|]|,(?=\S)/).map((x) => x.trim());
    if (f.length < 3) continue;
    resultados.push({ amostra: f[0], codigo: f[1].toUpperCase(), valor: f[2], unidade: f[3], flag: f[4] });
  }
  return { resultados, consultas: [] };
}

export function detectarProtocolo(texto: string, padrao?: string | null) {
  const t = texto.replace(CONTROLE, '').trimStart();
  if (/^(\d)?H\|/.test(t)) return 'ASTM';
  if (/^MSH\|/.test(t)) return 'HL7';
  return padrao && padrao !== 'MANUAL' ? padrao : 'CSV';
}

export function lerMensagem(texto: string, protocolo: string) {
  if (protocolo === 'ASTM') return lerAstm(texto);
  if (protocolo === 'HL7') return lerHl7(texto);
  return lerTexto(texto);
}

const FLAGS: Record<string, string> = { H: 'alto', L: 'baixo', HH: 'crítico alto', LL: 'crítico baixo', A: 'anormal', AA: 'crítico', N: 'normal', '>': 'acima da faixa de leitura', '<': 'abaixo da faixa de leitura' };

/** Processa uma mensagem recebida: grava resultados, controles de qualidade e o registro de rastreabilidade (TR 1.2.48.6, 1.2.48.10). */
export async function processarMensagem(c: C, equipamentoId: number, conteudo: string, u: Usuario | null, protocoloInformado?: string | null) {
  const eq = (await c.query(`select * from lab.equipamento where id = $1`, [equipamentoId])).rows[0];
  if (!eq) throw new ErroHttp(404, 'Equipamento não encontrado.');
  if (!eq.ativo) throw new ErroHttp(422, 'Equipamento inativo.');
  const protocolo = protocoloInformado ?? detectarProtocolo(conteudo, eq.protocolo);
  const lido = lerMensagem(conteudo, protocolo);
  const mapa = new Map<string, { exame_id: number; variavel_codigo: string; fator: number }[]>();
  for (const p of (await c.query(`select codigo_equipamento, exame_id, variavel_codigo, fator from lab.equipamento_parametro where equipamento_id = $1 and ativo`, [equipamentoId])).rows)
    mapa.set(p.codigo_equipamento, [...(mapa.get(p.codigo_equipamento) ?? []), { ...p, fator: Number(p.fator ?? 1) }]);
  const detalhes: string[] = [];
  const porItem = new Map<number, { valores: Record<string, any>; alertas: Alerta[] }>();
  let importados = 0;
  let controles = 0;
  for (const r of lido.resultados) {
    if (!r.amostra) {
      detalhes.push(`Resultado ${r.codigo} sem identificação de amostra.`);
      continue;
    }
    // Amostras de controle reconhecidas pelo código: entram no controle interno de qualidade (TR 1.2.48.3).
    const ctrl = (
      await c.query(`select id from lab.cq_controle where equipamento_id = $1 and ativo and codigo_amostra = $2 and variavel_codigo = any($3)`, [
        equipamentoId,
        r.amostra,
        (mapa.get(r.codigo) ?? []).map((m) => m.variavel_codigo).concat(r.codigo),
      ])
    ).rows[0];
    const valorNum = numero(r.valor);
    if (ctrl) {
      if (valorNum !== null) {
        await registrarResultadoControle(c, ctrl.id, valorNum, 'EQUIPAMENTO', u);
        controles++;
      }
      continue;
    }
    const amostra = (await c.query(`select * from lab.amostra where codigo_barras = $1 and situacao <> 'DESCARTADA'`, [r.amostra])).rows[0];
    if (!amostra) {
      detalhes.push(`Amostra ${r.amostra} não encontrada (ou descartada).`);
      continue;
    }
    const alvos = mapa.get(r.codigo);
    if (!alvos?.length) {
      detalhes.push(`Parâmetro ${r.codigo} da amostra ${r.amostra} sem mapeamento para exame.`);
      continue;
    }
    for (const alvo of alvos) {
      const item = (
        await c.query(`select id, situacao from lab.requisicao_exame where id = any(select jsonb_array_elements_text($1::jsonb)::bigint) and exame_id = $2`, [JSON.stringify(amostra.itens ?? []), alvo.exame_id])
      ).rows[0];
      if (!item) continue;
      if (item.situacao === 'LIBERADO') {
        detalhes.push(`Amostra ${r.amostra}: ${r.codigo} ignorado, exame já liberado.`);
        continue;
      }
      const acc = porItem.get(item.id) ?? { valores: {}, alertas: [] };
      acc.valores[alvo.variavel_codigo] = valorNum !== null ? Math.round(valorNum * alvo.fator * 1e6) / 1e6 : r.valor;
      if (r.flag && r.flag.toUpperCase() !== 'N')
        acc.alertas.push({ codigo: alvo.variavel_codigo, rotulo: r.codigo, tipo: 'EQUIPAMENTO', mensagem: `Flag do equipamento em ${r.codigo}: ${r.flag} (${FLAGS[r.flag.toUpperCase()] ?? 'ver manual do equipamento'}).` });
      porItem.set(item.id, acc);
      importados++;
    }
  }
  const assinar = await P.interfaceAssina();
  const liberador = assinar ? await P.interfaceProfissional() : null;
  const paraLiberar: number[] = [];
  for (const [itemId, acc] of porItem) {
    const atual = (await c.query(`select valores, rotulos, observacao_resultado from lab.requisicao_exame where id = $1`, [itemId])).rows[0];
    // Mantém valores já digitados de outras variáveis e recalcula fórmulas, referências e Delta-Check (TR 1.2.47.43.54).
    const r = await salvarResultado(c, itemId, { valores: { ...(atual?.valores ?? {}), ...acc.valores }, rotulos: atual?.rotulos, observacao: atual?.observacao_resultado, alertasEquipamento: acc.alertas }, u);
    await c.query(`update lab.requisicao_exame set interface_situacao = 'RECEBIDO' where id = $1`, [itemId]);
    for (const a of r.alertas.filter((x) => x.tipo === 'DELTA' || x.tipo === 'CRITICO')) detalhes.push(a.mensagem);
    if (assinar && r.situacao === 'DIGITADO' && !r.alertas.some((a) => a.tipo === 'DELTA' || a.tipo === 'CRITICO')) paraLiberar.push(itemId);
  }
  // Resultado recebido do equipamento já assinado, conforme parâmetro (TR 1.2.47.43.45).
  if (paraLiberar.length && liberador) await liberarItens(c, paraLiberar, liberador, u);
  const situacao = !lido.resultados.length && !lido.consultas.length ? 'ERRO' : detalhes.some((d) => !d.startsWith('Delta')) ? 'PARCIAL' : 'PROCESSADA';
  const msg = (
    await c.query(
      `insert into lab.interface_mensagem (equipamento_id, data_hora, direcao, protocolo, amostra, conteudo, situacao, resultados, detalhes)
       values ($1, now(), 'RECEBIDA', $2, $3, $4, $5, $6, $7) returning *`,
      [equipamentoId, protocolo, [...new Set(lido.resultados.map((r) => r.amostra))].join(', ').slice(0, 200), conteudo, situacao, importados + controles, detalhes.join('\n') || null],
    )
  ).rows[0];
  await c.query(`update lab.equipamento set ultima_comunicacao = now() where id = $1`, [equipamentoId]);
  // Consultas "request mode" presentes na mensagem são respondidas com os pedidos da amostra.
  const respostas = [];
  for (const q of lido.consultas.filter(Boolean)) respostas.push(await responderConsulta(c, equipamentoId, q));
  return { mensagem: msg, protocolo, lidos: lido.resultados.length, importados, controles, itens: porItem.size, liberados: paraLiberar.length && liberador ? paraLiberar.length : 0, detalhes, respostas };
}

// ---------------------------------------------------------------------------
// Pedidos ao equipamento (bidirecional) e request mode (TR 1.2.48.2, 1.2.48.8)
// ---------------------------------------------------------------------------
const dataAstm = (d: Date = new Date()) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14);

async function pedidosDaAmostra(c: C, equipamentoId: number, codigo: string) {
  const a = (
    await c.query(
      `select a.*, r.numero, p.id paciente_id, p.nome, p.sexo, to_char(p.data_nascimento, 'YYYYMMDD') nasc from lab.amostra a join lab.requisicao r on r.id = a.requisicao_id
         join cad.pessoa p on p.id = r.paciente_id where a.codigo_barras = $1 and a.situacao = 'COLETADA'`,
      [codigo],
    )
  ).rows[0];
  if (!a) return null;
  const codigos = (
    await c.query(
      `select distinct ep.codigo_equipamento from lab.requisicao_exame i join lab.equipamento_parametro ep on ep.exame_id = i.exame_id and ep.equipamento_id = $2 and ep.ativo
        where i.id = any(select jsonb_array_elements_text($1::jsonb)::bigint) and i.situacao in ('COLETADO','EM_ANALISE','DIGITADO_PARCIAL') order by 1`,
      [JSON.stringify(a.itens ?? []), equipamentoId],
    )
  ).rows.map((x) => x.codigo_equipamento as string);
  return { amostra: a, codigos };
}

/** Mensagem ASTM com o pedido da amostra (H, P, O e L). */
export function montarPedidoAstm(eq: { nome: string }, a: { codigo_barras: string; numero: string; paciente_id: number; nome: string; sexo: string; nasc: string }, codigos: string[]) {
  const ensaios = codigos.map((cod) => `^^^${cod}`).join('\\');
  return [
    `H|\\^&|||UBRISUS^LIS|||||${eq.nome}||P|1|${dataAstm()}`,
    `P|1||${a.paciente_id}||${a.nome.replace(/\|/g, ' ')}||${a.nasc ?? ''}|${a.sexo ?? 'U'}`,
    `O|1|${a.codigo_barras}|${a.numero}|${ensaios}|R||${dataAstm()}||||A||||||||||||||O`,
    'L|1|N',
  ].join('\r');
}

/** Prepara e enfileira os pedidos aos equipamentos bidirecionais após a coleta (TR 1.2.47.43.25). */
export async function enviarPedidosEquipamentos(c: C, amostraIds: number[]) {
  if (!amostraIds.length) return 0;
  const linhas = (
    await c.query(
      `select distinct a.id amostra_id, a.codigo_barras, eq.id equipamento_id, eq.nome
         from lab.amostra a cross join lateral jsonb_array_elements_text(a.itens) it(item_id)
         join lab.requisicao_exame i on i.id = it.item_id::bigint join lab.exame e on e.id = i.exame_id and e.usa_interfaceamento
         join lab.equipamento_parametro ep on ep.exame_id = e.id and ep.ativo join lab.equipamento eq on eq.id = ep.equipamento_id and eq.ativo and eq.comunicacao = 'BIDIRECIONAL'
        where a.id = any($1)`,
      [amostraIds],
    )
  ).rows;
  let n = 0;
  for (const l of linhas) {
    const p = await pedidosDaAmostra(c, l.equipamento_id, l.codigo_barras);
    if (!p?.codigos.length) continue;
    await c.query(
      `insert into lab.interface_mensagem (equipamento_id, data_hora, direcao, protocolo, amostra, conteudo, situacao) values ($1, now(), 'ENVIADA', 'ASTM', $2, $3, 'PENDENTE')`,
      [l.equipamento_id, l.codigo_barras, montarPedidoAstm(l, p.amostra, p.codigos)],
    );
    await c.query(
      `update lab.requisicao_exame set interface_situacao = 'ENVIADO' where id = any(select jsonb_array_elements_text($1::jsonb)::bigint) and exame_id in (select exame_id from lab.equipamento_parametro where equipamento_id = $2)`,
      [JSON.stringify(p.amostra.itens ?? []), l.equipamento_id],
    );
    n++;
  }
  return n;
}

/** Consulta do equipamento pelo código de barras lido (request mode). */
export async function responderConsulta(c: C, equipamentoId: number, codigo: string) {
  const eq = (await c.query(`select * from lab.equipamento where id = $1`, [equipamentoId])).rows[0];
  if (!eq) throw new ErroHttp(404, 'Equipamento não encontrado.');
  const p = await pedidosDaAmostra(c, equipamentoId, codigo);
  const conteudo = p?.codigos.length ? montarPedidoAstm(eq, p.amostra, p.codigos) : [`H|\\^&|||UBRISUS^LIS|||||${eq.nome}||P|1|${dataAstm()}`, `Q|1|^${codigo}||^^^ALL||||||||X`, 'L|1|N'].join('\r');
  await c.query(
    `insert into lab.interface_mensagem (equipamento_id, data_hora, direcao, protocolo, amostra, conteudo, situacao, detalhes) values ($1, now(), 'CONSULTA', 'ASTM', $2, $3, 'ENTREGUE', $4)`,
    [equipamentoId, codigo, conteudo, p?.codigos.length ? `Pedidos: ${p.codigos.join(', ')}` : 'Amostra sem pedidos para este equipamento.'],
  );
  await c.query(`update lab.equipamento set ultima_comunicacao = now() where id = $1`, [equipamentoId]);
  if (p?.codigos.length) await c.query(`update lab.requisicao_exame set interface_situacao = 'ENVIADO' where id = any(select jsonb_array_elements_text($1::jsonb)::bigint) and interface_situacao = 'PENDENTE'`, [JSON.stringify(p.amostra.itens ?? [])]);
  return { amostra: codigo, encontrada: !!p, ensaios: p?.codigos ?? [], conteudo };
}

/** Pedidos pendentes de entrega ao equipamento (consumidos pelo agente de comunicação centralizado, TR 1.2.48.11). */
export async function retirarPendentes(c: C, equipamentoId: number) {
  const r = await c.query(
    `update lab.interface_mensagem set situacao = 'ENTREGUE' where id in (select id from lab.interface_mensagem where equipamento_id = $1 and direcao = 'ENVIADA' and situacao = 'PENDENTE' order by id limit 200)
     returning id, amostra, conteudo`,
    [equipamentoId],
  );
  await c.query(`update lab.equipamento set ultima_comunicacao = now() where id = $1`, [equipamentoId]);
  return r.rows;
}

/** Lista de trabalho com posições para equipamentos sem leitura de código de barras (TR 1.2.48.9). */
export async function listaDeTrabalho(c: C, equipamentoId: number) {
  const linhas = (
    await c.query(
      `select a.codigo_barras, r.numero, p.nome paciente, string_agg(distinct ep.codigo_equipamento, ' ' order by ep.codigo_equipamento) ensaios, min(a.coletada_em) coletada_em
         from lab.amostra a cross join lateral jsonb_array_elements_text(a.itens) it(item_id)
         join lab.requisicao_exame i on i.id = it.item_id::bigint and i.situacao in ('COLETADO','EM_ANALISE','DIGITADO_PARCIAL')
         join lab.equipamento_parametro ep on ep.exame_id = i.exame_id and ep.equipamento_id = $1 and ep.ativo
         join lab.requisicao r on r.id = a.requisicao_id join cad.pessoa p on p.id = r.paciente_id
        where a.situacao = 'COLETADA' group by 1, 2, 3 order by min(a.coletada_em), 1`,
      [equipamentoId],
    )
  ).rows.map((l, i) => ({ posicao: i + 1, ...l }));
  const csv = ['posicao;amostra;requisicao;paciente;ensaios', ...linhas.map((l) => `${l.posicao};${l.codigo_barras};${l.numero};${l.paciente};${l.ensaios}`)].join('\r\n');
  if (linhas.length)
    await c.query(
      `insert into lab.interface_mensagem (equipamento_id, data_hora, direcao, protocolo, amostra, conteudo, situacao, detalhes) values ($1, now(), 'ENVIADA', 'CSV', $2, $3, 'ENTREGUE', 'Lista de trabalho')`,
      [equipamentoId, linhas.map((l) => l.codigo_barras).join(', ').slice(0, 200), csv],
    );
  return { linhas, csv };
}

// ---------------------------------------------------------------------------
// Controle interno de qualidade - regras de Westgard (TR 1.2.48.3, 1.2.48.3.1)
// ---------------------------------------------------------------------------
export function avaliarWestgard(zAtual: number, anteriores: number[], regras: string[]) {
  const z = [zAtual, ...anteriores];
  const ativas = regras.length ? regras : ['1_2S', '1_3S', '2_2S', 'R_4S', '4_1S', '10X'];
  const violadas: string[] = [];
  const mesmoLado = (n: number, lim: number) => z.length >= n && (z.slice(0, n).every((x) => x > lim) || z.slice(0, n).every((x) => x < -lim));
  if (ativas.includes('1_3S') && Math.abs(zAtual) > 3) violadas.push('1-3s');
  if (ativas.includes('2_2S') && mesmoLado(2, 2)) violadas.push('2-2s');
  if (ativas.includes('R_4S') && z.length >= 2 && Math.abs(z[0] - z[1]) > 4 && Math.sign(z[0]) !== Math.sign(z[1])) violadas.push('R-4s');
  if (ativas.includes('4_1S') && mesmoLado(4, 1)) violadas.push('4-1s');
  if (ativas.includes('10X') && mesmoLado(10, 0)) violadas.push('10x');
  const alerta = ativas.includes('1_2S') && Math.abs(zAtual) > 2;
  return { violadas: alerta && !violadas.length ? ['1-2s'] : violadas, situacao: violadas.length ? 'REJEITADO' : alerta ? 'ALERTA' : 'ACEITO' };
}

export async function registrarResultadoControle(c: C, controleId: number, valor: number, origem: 'MANUAL' | 'EQUIPAMENTO', _u: Usuario | null, acao?: string | null) {
  const ctrl = (await c.query(`select * from lab.cq_controle where id = $1`, [controleId])).rows[0];
  if (!ctrl) throw new ErroHttp(404, 'Material de controle não encontrado.');
  const dp = Number(ctrl.desvio_padrao);
  if (!dp) throw new ErroHttp(422, 'Desvio padrão do controle não informado.');
  const z = (valor - Number(ctrl.media)) / dp;
  const anteriores = (await c.query(`select desvios from lab.cq_resultado where controle_id = $1 order by data_hora desc, id desc limit 9`, [controleId])).rows.map((r) => Number(r.desvios));
  const w = avaliarWestgard(z, anteriores, ctrl.regras ?? []);
  return (
    await c.query(
      `insert into lab.cq_resultado (controle_id, data_hora, valor, desvios, violacoes, situacao, origem, acao_corretiva) values ($1, now(), $2, $3, $4, $5, $6, $7) returning *`,
      [controleId, valor, Math.round(z * 100) / 100, w.violadas.join(', ') || null, w.situacao, origem, acao ?? null],
    )
  ).rows[0];
}
