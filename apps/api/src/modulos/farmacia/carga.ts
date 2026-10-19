// Tabelas de apoio da farmácia e dados fictícios de demonstração (REMUME, estoques e consumo histórico).
import type pg from 'pg';
import { registrarCarga, registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { loteNaUnidade } from './servico.js';

const APRESENTACOES: [string, string][] = [
  ['COMPRIMIDO', 'CP'],
  ['CÁPSULA', 'CAP'],
  ['FRASCO', 'FR'],
  ['AMPOLA', 'AMP'],
  ['FRASCO-AMPOLA', 'FA'],
  ['BISNAGA', 'BG'],
  ['UNIDADE', 'UN'],
  ['CAIXA', 'CX'],
  ['ENVELOPE', 'ENV'],
];
const GRUPOS = ['MEDICAMENTOS DA ATENÇÃO BÁSICA', 'MEDICAMENTOS CONTROLADOS', 'MATERIAIS MÉDICO-HOSPITALARES', 'IMUNOBIOLÓGICOS', 'MATERIAL ODONTOLÓGICO', 'INSUMOS PARA DIABETES'];
const ACOES = ['ANTI-HIPERTENSIVO', 'ANTIDIABÉTICO', 'ANALGÉSICO E ANTITÉRMICO', 'ANTIMICROBIANO', 'ANTIDEPRESSIVO', 'ANSIOLÍTICO', 'HIPOLIPEMIANTE', 'ANTIÁCIDO / ANTIULCEROSO', 'ANTIAGREGANTE PLAQUETÁRIO', 'ANTI-INFLAMATÓRIO'];
const MOTIVOS: [string, string][] = [
  ['VALIDADE EXPIRADA', '2'],
  ['AVARIA / QUEBRA', '3'],
  ['FALHA NO ARMAZENAMENTO (TEMPERATURA)', '4'],
  ['INTERDIÇÃO / RECOLHIMENTO ANVISA', '5'],
  ['FALHA DE TRANSPORTE', '6'],
  ['SOBRA DE FRASCO MULTIDOSE (VACINAS)', '7'],
];
const DCB: [string, string][] = [
  ['05435', 'LOSARTANA POTÁSSICA'],
  ['04565', 'HIDROCLOROTIAZIDA'],
  ['05735', 'CLORIDRATO DE METFORMINA'],
  ['04381', 'GLIBENCLAMIDA'],
  ['08137', 'SINVASTATINA'],
  ['00727', 'AMOXICILINA'],
  ['03121', 'DIPIRONA SÓDICA'],
  ['06827', 'PARACETAMOL'],
  ['06646', 'OMEPRAZOL'],
  ['00764', 'ÁCIDO ACETILSALICÍLICO'],
  ['01731', 'CAPTOPRIL'],
  ['02350', 'CLONAZEPAM'],
  ['04086', 'CLORIDRATO DE FLUOXETINA'],
  ['02788', 'DIAZEPAM'],
  ['04971', 'IBUPROFENO'],
  ['04990', 'INSULINA HUMANA NPH'],
];

async function idPorNome(c: pg.PoolClient, tabela: string, nome: string) {
  return (await c.query(`select id from ${tabela} where nome = $1`, [nome])).rows[0]?.id as number | undefined;
}

registrarCarga('Tabelas da farmácia', async (c) => {
  for (const [nome, sigla] of APRESENTACOES) await c.query(`insert into far.apresentacao (nome, sigla) select $1::varchar, $2::varchar where not exists (select 1 from far.apresentacao where nome = $1)`, [nome, sigla]);
  for (const nome of GRUPOS) await c.query(`insert into far.grupo_produto (nome) select $1::varchar where not exists (select 1 from far.grupo_produto where nome = $1)`, [nome]);
  for (const nome of ACOES) await c.query(`insert into far.acao_terapeutica (nome) select $1::varchar where not exists (select 1 from far.acao_terapeutica where nome = $1)`, [nome]);
  for (const [nome, cod] of MOTIVOS)
    await c.query(`insert into far.motivo_inutilizacao (nome, codigo_sipni) select $1::varchar, $2::varchar where not exists (select 1 from far.motivo_inutilizacao where nome = $1)`, [nome, cod]);
  for (const [numero, nome] of DCB) await c.query(`insert into far.dcb (numero, nome) values ($1, $2) on conflict do nothing`, [numero, nome]);
});

// [nome, concentração, dcb, apresentação, grupo, ação, tipo receita, lista 344, preço, estoque mínimo, extras]
type Produto = [string, string, string, string, string, string, string, string | null, number, number, Record<string, unknown>?];
const PRODUTOS: Produto[] = [
  ['LOSARTANA POTÁSSICA', '50 MG', 'LOSARTANA POTÁSSICA', 'COMPRIMIDO', GRUPOS[0], ACOES[0], 'BASICA', null, 0.08, 3000, { programa_ministerio: 'HIPERDIA', codigos_barras: '7896004712345' }],
  ['HIDROCLOROTIAZIDA', '25 MG', 'HIDROCLOROTIAZIDA', 'COMPRIMIDO', GRUPOS[0], ACOES[0], 'BASICA', null, 0.04, 2000, { programa_ministerio: 'HIPERDIA' }],
  ['CAPTOPRIL', '25 MG', 'CAPTOPRIL', 'COMPRIMIDO', GRUPOS[0], ACOES[0], 'BASICA', null, 0.05, 1500, {}],
  ['CLORIDRATO DE METFORMINA', '850 MG', 'CLORIDRATO DE METFORMINA', 'COMPRIMIDO', GRUPOS[0], ACOES[1], 'BASICA', null, 0.09, 3000, { programa_ministerio: 'HIPERDIA', codigos_barras: '7896004798765' }],
  ['GLIBENCLAMIDA', '5 MG', 'GLIBENCLAMIDA', 'COMPRIMIDO', GRUPOS[0], ACOES[1], 'BASICA', null, 0.03, 1000, {}],
  ['SINVASTATINA', '20 MG', 'SINVASTATINA', 'COMPRIMIDO', GRUPOS[0], ACOES[6], 'BASICA', null, 0.07, 1500, {}],
  ['ÁCIDO ACETILSALICÍLICO', '100 MG', 'ÁCIDO ACETILSALICÍLICO', 'COMPRIMIDO', GRUPOS[0], ACOES[8], 'BASICA', null, 0.03, 2000, {}],
  ['OMEPRAZOL', '20 MG', 'OMEPRAZOL', 'CÁPSULA', GRUPOS[0], ACOES[7], 'BASICA', null, 0.06, 2000, {}],
  ['DIPIRONA SÓDICA', '500 MG', 'DIPIRONA SÓDICA', 'COMPRIMIDO', GRUPOS[0], ACOES[2], 'BASICA', null, 0.05, 2000, { codigos_barras: '7891058001234' }],
  ['PARACETAMOL', '500 MG', 'PARACETAMOL', 'COMPRIMIDO', GRUPOS[0], ACOES[2], 'BASICA', null, 0.04, 2000, {}],
  ['IBUPROFENO', '600 MG', 'IBUPROFENO', 'COMPRIMIDO', GRUPOS[0], ACOES[9], 'BASICA', null, 0.12, 800, {}],
  ['AMOXICILINA', '500 MG', 'AMOXICILINA', 'CÁPSULA', GRUPOS[0], ACOES[3], 'ANTIMICROBIANO', null, 0.18, 1000, { antimicrobiano: true, validade_receita_dias: 10 }],
  ['CLORIDRATO DE FLUOXETINA', '20 MG', 'CLORIDRATO DE FLUOXETINA', 'CÁPSULA', GRUPOS[1], ACOES[4], 'BRANCA_C', 'C1', 0.11, 600, { controlado: true, tarja: 'VERMELHA_RETENCAO' }],
  ['CLONAZEPAM', '2 MG', 'CLONAZEPAM', 'COMPRIMIDO', GRUPOS[1], ACOES[5], 'AZUL_B', 'B1', 0.09, 500, { controlado: true, tarja: 'PRETA' }],
  ['DIAZEPAM', '5 MG', 'DIAZEPAM', 'COMPRIMIDO', GRUPOS[1], ACOES[5], 'AZUL_B', 'B1', 0.06, 500, { controlado: true, tarja: 'PRETA' }],
  ['INSULINA HUMANA NPH', '100 UI/ML 10 ML', 'INSULINA HUMANA NPH', 'FRASCO-AMPOLA', GRUPOS[5], ACOES[1], 'BASICA', null, 18.5, 100, { programa_ministerio: 'HIPERDIA', nao_fracionavel: true }],
  ['SERINGA PARA INSULINA', '1 ML AGULHA 8 MM', '', 'UNIDADE', GRUPOS[5], '', 'BASICA', null, 0.32, 1000, { tipo: 'MATERIAL', nao_fracionavel: true }],
  ['TIRA REAGENTE PARA GLICEMIA', 'CAIXA 50 UN', '', 'CAIXA', GRUPOS[5], '', 'BASICA', null, 22.0, 50, { tipo: 'MATERIAL', nao_fracionavel: true }],
];

registrarCargaDemonstracao('Farmácia (produtos, estoques e consumo)', async (c, ctx) => {
  const { usf, usf2, upa, almox } = ctx.unidades;
  const ids = new Map<string, number>();
  for (const [nome, conc, dcb, apres, grupo, acao, receita, lista, preco, minimo, extra = {}] of PRODUTOS) {
    const campos: Record<string, unknown> = {
      nome,
      concentracao: conc,
      principio_ativo: dcb || null,
      dcb_id: dcb ? (await c.query(`select id from far.dcb where nome = $1`, [dcb])).rows[0]?.id : null,
      apresentacao_id: await idPorNome(c, 'far.apresentacao', apres),
      grupo_id: await idPorNome(c, 'far.grupo_produto', grupo),
      acao_terapeutica_id: acao ? await idPorNome(c, 'far.acao_terapeutica', acao) : null,
      tipo_receita: receita,
      lista_344: lista,
      preco_custo: preco,
      estoque_minimo: minimo,
      rename: true,
      tipo: 'MEDICAMENTO',
      ...extra,
    };
    const cols = Object.keys(campos);
    const id = (await c.query(`insert into far.produto (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(campos))).rows[0].id;
    ids.set(nome, id);
    for (const [un, fator] of [
      [usf, 0.1],
      [usf2, 0.08],
      [upa, 0.05],
    ] as const)
      await c.query(`insert into far.produto_unidade (produto_id, unidade_id, estoque_minimo, estoque_ideal, local) values ($1,$2,$3,$4,'Farmácia')`, [id, un, Math.ceil(minimo * fator), Math.ceil(minimo * fator * 2)]);
  }
  await c.query(`insert into far.produto_similar (produto_id, similar_id) values ($1,$2),($2,$1)`, [ids.get('DIPIRONA SÓDICA'), ids.get('PARACETAMOL')]);

  const fornecedor = (await c.query(`insert into far.fornecedor (nome, cnpj, telefone) values ('DISTRIBUIDORA DE MEDICAMENTOS PAULISTA LTDA', '12345678000195', '1133334444') returning id`)).rows[0].id;
  const fabricante = (await c.query(`insert into far.fabricante (nome, cnpj) values ('LABORATÓRIO FARMACÊUTICO NACIONAL S/A', '98765432000110') returning id`)).rows[0].id;

  // Entrada inicial no almoxarifado (há 15 meses) e distribuição às unidades.
  const inicio = new Date(Date.now() - 460 * 86_400_000);
  const entrada = (
    await c.query(
      `insert into far.entrada (unidade_id, tipo, fornecedor_id, nota_numero, nota_serie, data_compra, data_entrada, empenho, valor_nota, situacao) values ($1,'FORNECEDOR',$2,'004512','1',$3,$3,'2025/0187',0,'CONFIRMADA') returning id`,
      [almox, fornecedor, inicio.toISOString().slice(0, 10)],
    )
  ).rows[0].id;
  let total = 0;
  const lotes = new Map<string, number>();
  let n = 0;
  for (const [nome, , , , , , , , preco, minimo] of PRODUTOS) {
    const pid = ids.get(nome)!;
    const lote = `L${(24000 + ++n * 37).toString()}`;
    const validade = new Date(Date.now() + (n % 5 === 0 ? 40 : 300 + n * 15) * 86_400_000).toISOString().slice(0, 10);
    const qtd = minimo * 8;
    total += qtd * preco;
    await c.query(`insert into far.entrada_item (entrada_id, produto_id, fabricante_id, lote, validade, quantidade, valor_unitario) values ($1,$2,$3,$4,$5,$6,$7)`, [entrada, pid, fabricante, lote, validade, qtd, preco]);
    for (const [un, parte] of [
      [almox, 0.55],
      [usf, 0.25],
      [usf2, 0.12],
      [upa, 0.08],
    ] as const) {
      const lid = await loteNaUnidade(c, { unidadeId: un, produtoId: pid, lote, validade, fabricanteId: fabricante, custo: preco });
      const q = Math.round(qtd * parte);
      await c.query(`update far.estoque_lote set quantidade = $2 where id = $1`, [lid, q]);
      await c.query(
        `insert into far.movimento_estoque (data_hora, unidade_id, produto_id, lote_id, tipo, quantidade, saldo_apos, custo_unitario, documento) values ($1,$2,$3,$4,$5,$6,$6,$7,$8)`,
        [inicio, un, pid, lid, un === almox ? 'ENTRADA' : 'TRANSFERENCIA_ENTRADA', q, preco, un === almox ? 'NF 004512' : 'CARGA INICIAL'],
      );
      if (un === usf) lotes.set(nome, lid);
    }
  }
  await c.query(`update far.entrada set valor_nota = $2 where id = $1`, [entrada, Math.round(total * 100) / 100]);
  // Lote vencido para demonstrar o alerta e a inutilização.
  const venc = await loteNaUnidade(c, { unidadeId: usf, produtoId: ids.get('CAPTOPRIL')!, lote: 'L19870', validade: new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10), fabricanteId: fabricante, custo: 0.05 });
  await c.query(`update far.estoque_lote set quantidade = 120 where id = $1`, [venc]);

  // Consumo histórico (14 meses) para relatórios de consumo médio e previsão sazonal.
  const cronicos: [string, number, number][] = [
    ['LOSARTANA POTÁSSICA', 30, 30],
    ['CLORIDRATO DE METFORMINA', 60, 30],
    ['HIDROCLOROTIAZIDA', 30, 30],
    ['SINVASTATINA', 30, 30],
    ['DIPIRONA SÓDICA', 10, 3],
    ['AMOXICILINA', 21, 7],
  ];
  const operador = (await c.query(`select id from seg.operador where login = 'farmaceutica'`)).rows[0]?.id ?? null;
  for (let mes = 14; mes >= 1; mes--) {
    const sazonal = 1 + 0.25 * Math.cos(((new Date(Date.now() - mes * 30 * 86_400_000).getMonth() - 6) / 12) * 2 * Math.PI);
    for (const [nome, qtd, dias] of cronicos) {
      const vezes = Math.round((nome === 'AMOXICILINA' || nome === 'DIPIRONA SÓDICA' ? 6 * sazonal : 5) * (1 + (14 - mes) * 0.02));
      for (let k = 0; k < vezes; k++) {
        const pac = ctx.pacientes[(mes * 7 + k * 3 + nome.length) % ctx.pacientes.length];
        const quando = new Date(Date.now() - (mes * 30 - k * 4) * 86_400_000);
        const d = (
          await c.query(
            `insert into far.dispensacao (unidade_id, paciente_id, data_hora, numero_receita, prescritor, tipo_receita, operador_id, situacao) values ($1,$2,$3,$4,'CARLOS EDUARDO ANDRADE','BASICA',$5,'EFETIVADA') returning id`,
            [usf, pac, quando, `EXT-${mes}${k}`, operador],
          )
        ).rows[0].id;
        const lid = lotes.get(nome)!;
        await c.query(`insert into far.dispensacao_item (dispensacao_id, produto_id, lote_id, quantidade, dias_consumo, termino_previsto, custo_unitario) select $1, produto_id, id, $2, $3, $4::date, custo_unitario from far.estoque_lote where id = $5`, [
          d,
          qtd,
          dias,
          new Date(quando.getTime() + dias * 86_400_000).toISOString().slice(0, 10),
          lid,
        ]);
        const saldo = (await c.query(`update far.estoque_lote set quantidade = quantidade - $2 where id = $1 returning quantidade, produto_id, custo_unitario`, [lid, qtd])).rows[0];
        await c.query(
          `insert into far.movimento_estoque (data_hora, unidade_id, produto_id, lote_id, tipo, quantidade, saldo_apos, custo_unitario, paciente_id, documento, operador_id) values ($1,$2,$3,$4,'DISPENSACAO',$5,$6,$7,$8,$9,$10)`,
          [quando, usf, saldo.produto_id, lid, -qtd, saldo.quantidade, saldo.custo_unitario, pac, `DISP ${d}`, operador],
        );
      }
    }
  }
  // Paciente com alergia a dipirona (bloqueio na dispensação) e processo judicial de exemplo.
  const alergico = ctx.pacientes[5];
  await c.query(`insert into cad.pessoa_alergia (pessoa_id, tipo, substancia, dcb_id, gravidade) select $1, 'MEDICAMENTO', 'DIPIRONA', id, 'GRAVE' from far.dcb where nome = 'DIPIRONA SÓDICA'`, [alergico]);
  const adv = (await c.query(`insert into far.advogado (nome, oab, email) values ('MARIA HELENA PRADO', 'SP 123.456', 'mhprado@advocacia.exemplo') returning id`)).rows[0].id;
  const proc = (
    await c.query(
      `insert into far.processo_judicial (numero, paciente_id, unidade_solicitante_id, profissional, data_solicitacao, advogado_id, situacao) values ('1002345-67.2026.8.26.0080', $1, $2, 'DR. JOÃO PEREIRA - CRM 98765', current_date - 30, $3, 'EM_ANDAMENTO') returning id`,
      [ctx.pacientes[8], usf, adv],
    )
  ).rows[0].id;
  await c.query(`insert into far.processo_judicial_item (processo_id, produto_id, frequencia_dias, quantidade, quantidade_por_retirada, quantidade_entregue) values ($1,$2,30,6,1,0)`, [proc, ids.get('INSULINA HUMANA NPH')]);
  await c.query(`insert into far.processo_judicial_tramite (processo_id, data_hora, descricao) values ($1, now() - interval '30 days', 'Processo cadastrado a partir de decisão liminar.')`, [proc]);
  const kit = (await c.query(`insert into far.kit (nome, descricao) values ('KIT HIPERDIA', 'Medicamentos de uso contínuo para hipertensos e diabéticos') returning id`)).rows[0].id;
  for (const nome of ['LOSARTANA POTÁSSICA', 'HIDROCLOROTIAZIDA', 'CLORIDRATO DE METFORMINA', 'SINVASTATINA'])
    await c.query(`insert into far.kit_item (kit_id, produto_id, quantidade_padrao) values ($1,$2,30)`, [kit, ids.get(nome)]);
});
