// Tabelas de apoio do transporte sanitário (tipos e marcas de veículos já povoados, motivos e despesas)
// e dados fictícios de demonstração (frota, condutores, rotas, agendas e histórico de viagens).
import type pg from 'pg';
import { registrarCarga, registrarCargaDemonstracao } from '../../db/carga/modulos.js';
import { registrarParametro } from '../../db/carga/configuracao.js';

registrarParametro('transporte.comprovante', { termica: false }, 'Comprovante de agendamento de transporte: imprimir em impressora térmica (TR 1.2.40.26)', 'TRA');

// Principais tipos de veículos do mercado e categoria mínima da CNH (TR 1.2.40.1).
const TIPOS: [string, string][] = [
  ['AUTOMÓVEL', 'B'],
  ['CAMINHONETE / SUV', 'B'],
  ['UTILITÁRIO / FURGÃO', 'B'],
  ['VAN (ATÉ 8 PASSAGEIROS)', 'B'],
  ['VAN (MAIS DE 8 PASSAGEIROS)', 'D'],
  ['MICRO-ÔNIBUS', 'D'],
  ['ÔNIBUS', 'D'],
  ['AMBULÂNCIA TIPO A - TRANSPORTE', 'D'],
  ['AMBULÂNCIA TIPO B - SUPORTE BÁSICO', 'D'],
  ['AMBULÂNCIA TIPO C - RESGATE', 'D'],
  ['AMBULÂNCIA TIPO D - SUPORTE AVANÇADO (UTI MÓVEL)', 'D'],
  ['VEÍCULO ADAPTADO PARA CADEIRANTES', 'D'],
  ['MOTOCICLETA', 'B'],
];

// Principais marcas de veículos do mercado (TR 1.2.40.2).
const MARCAS = [
  'AGRALE', 'AUDI', 'BMW', 'BYD', 'CAOA CHERY', 'CITROËN', 'FIAT', 'FORD', 'CHEVROLET', 'HONDA', 'HYUNDAI', 'IVECO', 'JAC', 'JEEP', 'KIA', 'MARCOPOLO',
  'MERCEDES-BENZ', 'MITSUBISHI', 'NEOBUS', 'NISSAN', 'PEUGEOT', 'RENAULT', 'SCANIA', 'TOYOTA', 'VOLARE', 'VOLKSWAGEN', 'VOLVO', 'YAMAHA',
];

const MOTIVOS = [
  'CONSULTA ESPECIALIZADA', 'EXAME / DIAGNÓSTICO', 'TRATAMENTO ONCOLÓGICO (QUIMIO/RADIOTERAPIA)', 'HEMODIÁLISE', 'CIRURGIA ELETIVA', 'RETORNO PÓS-OPERATÓRIO',
  'FISIOTERAPIA / REABILITAÇÃO', 'TRATAMENTO FORA DO DOMICÍLIO (TFD)', 'ALTA HOSPITALAR', 'OUTROS',
];

// [grupo, despesa, unidade, valor padrão, combustível]
const DESPESAS: [string, string, string, number, boolean][] = [
  ['COMBUSTÍVEL', 'ÓLEO DIESEL S10', 'L', 6.19, true],
  ['COMBUSTÍVEL', 'GASOLINA COMUM', 'L', 6.29, true],
  ['COMBUSTÍVEL', 'ETANOL', 'L', 4.39, true],
  ['ALIMENTAÇÃO', 'REFEIÇÃO DO CONDUTOR', 'UN', 35, false],
  ['ALIMENTAÇÃO', 'LANCHE', 'UN', 15, false],
  ['PEDÁGIO', 'PEDÁGIO', 'UN', 12.4, false],
  ['ESTACIONAMENTO', 'ESTACIONAMENTO', 'UN', 25, false],
  ['MANUTENÇÃO', 'LAVAGEM DO VEÍCULO', 'UN', 60, false],
  ['MANUTENÇÃO', 'BORRACHARIA', 'UN', 40, false],
  ['HOSPEDAGEM', 'DIÁRIA DE HOSPEDAGEM', 'UN', 150, false],
  ['OUTRAS', 'OUTRAS DESPESAS', 'UN', 0, false],
];

/** Inclusão idempotente: não duplica registros com a mesma chave (nome). */
async function ins(c: pg.PoolClient, tabela: string, campos: Record<string, unknown>, chave = 'nome') {
  if ((await c.query(`select 1 from ${tabela} where ${chave} = $1`, [campos[chave]])).rowCount) return;
  const nomes = Object.keys(campos);
  await c.query(`insert into ${tabela} (${nomes.join(',')}) values (${nomes.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(campos));
}
const idDe = async (c: pg.PoolClient, tabela: string, nome: string, campo = 'nome') => (await c.query(`select id from ${tabela} where ${campo} = $1`, [nome])).rows[0]?.id as number | undefined;

registrarCarga('Tabelas do transporte sanitário', async (c) => {
  for (const [nome, cnh] of TIPOS) await ins(c, 'tra.tipo_veiculo', { nome, categoria_cnh: cnh });
  for (const nome of MARCAS) await ins(c, 'tra.marca_veiculo', { nome });
  for (const nome of MOTIVOS) await ins(c, 'tra.motivo_viagem', { nome });
  for (const g of new Set(DESPESAS.map((d) => d[0]))) await ins(c, 'tra.grupo_despesa', { nome: g });
  for (const [grupo, nome, un, valor, comb] of DESPESAS) {
    const grupoId = await idDe(c, 'tra.grupo_despesa', grupo);
    await ins(c, 'tra.despesa', { nome, grupo_id: grupoId, unidade_medida: un, valor_padrao: valor, combustivel: comb });
  }
});

/** Locais de destino de referência (também usados pelo TFD como local de tratamento). */
export const LOCAIS_DESTINO: [string, string, string, string][] = [
  ['HOSPITAL UNIVERSITÁRIO DE JUNDIAÍ', '3525904', 'RUA FRANCISCO TELLES, 250 - VILA ARENS', '2081644'],
  ['HOSPITAL SÃO VICENTE DE PAULO - JUNDIAÍ', '3525904', 'RUA SÃO VICENTE DE PAULO, 223 - CENTRO', '2786974'],
  ['HOSPITAL DAS CLÍNICAS DA FMUSP', '3550308', 'AV. DR. ENÉAS CARVALHO DE AGUIAR, 255 - CERQUEIRA CÉSAR', '2078015'],
  ['INSTITUTO DO CÂNCER DO ESTADO DE SÃO PAULO (ICESP)', '3550308', 'AV. DR. ARNALDO, 251 - CERQUEIRA CÉSAR', '6123740'],
  ['HOSPITAL DE CLÍNICAS DA UNICAMP', '3509502', 'R. VITAL BRASIL, 251 - CIDADE UNIVERSITÁRIA', '2079798'],
  ['CONJUNTO HOSPITALAR DE SOROCABA', '3552205', 'AV. COMENDADOR PEREIRA INÁCIO, 564 - JARDIM VERGUEIRO', '2081695'],
  ['HOSPITAL DE AMOR (BARRETOS)', '3505500', 'RUA ANTENOR DUARTE VILELA, 1331 - DR. PAULO PRATA', '2090236'],
  ['HOSPITAL DAS CLÍNICAS DE BOTUCATU', '3507506', 'AV. PROF. MÁRIO RUBENS GUIMARÃES MONTENEGRO, S/N', '2748223'],
  ['CENTRO DE ESPECIALIDADES MÉDICAS DE CABREÚVA', '3508405', 'RUA PADRE ANTÔNIO DE OLIVEIRA, 300 - CENTRO', ''],
];

export async function garantirLocaisDestino(c: pg.PoolClient) {
  for (const [nome, ibge, endereco, cnes] of LOCAIS_DESTINO) {
    const m = await idDe(c, 'cad.municipio', ibge, 'codigo_ibge');
    if (m) await ins(c, 'tra.local_destino', { nome, municipio_id: m, endereco, cnes: cnes || null });
  }
}

// Gerador pseudoaleatório determinístico para a demonstração.
function sorteador(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

registrarCargaDemonstracao('Transporte sanitário (frota, rotas, agendas e viagens)', async (c, ctx) => {
  if ((await c.query(`select 1 from tra.rota limit 1`)).rowCount) return;
  await garantirLocaisDestino(c);
  const tipo = (n: string) => idDe(c, 'tra.tipo_veiculo', n);
  const marca = (n: string) => idDe(c, 'tra.marca_veiculo', n);
  const veiculos: Record<string, number> = {};
  const lotacao = (await c.query(`select id from cad.unidade where tipo_unidade = 'TRANSPORTE' order by id limit 1`)).rows[0]?.id ?? ctx.unidades.sms ?? null;
  for (const [placa, t, m, modelo, pax, macas, cadeiras, comb, km] of [
    ['FHX3A21', 'VAN (MAIS DE 8 PASSAGEIROS)', 'RENAULT', 'MASTER MINIBUS L3H2', 15, 0, 0, 'DIESEL', 84210],
    ['GBC7D45', 'MICRO-ÔNIBUS', 'VOLARE', 'ATTACK 9 ON', 24, 0, 1, 'DIESEL', 121540],
    ['EKT2F19', 'VAN (MAIS DE 8 PASSAGEIROS)', 'MERCEDES-BENZ', 'SPRINTER 416 CDI', 15, 0, 0, 'DIESEL', 66320],
    ['FTR8B07', 'AUTOMÓVEL', 'CHEVROLET', 'SPIN LTZ 1.8', 6, 0, 0, 'FLEX', 45230],
    ['GAM1C33', 'AMBULÂNCIA TIPO A - TRANSPORTE', 'FIAT', 'DUCATO AMBULÂNCIA', 2, 1, 0, 'DIESEL', 98770],
    ['FZK5E80', 'VEÍCULO ADAPTADO PARA CADEIRANTES', 'FIAT', 'DOBLÒ ADAPTADO', 4, 0, 1, 'FLEX', 37110],
  ] as const) {
    veiculos[placa] = (
      await c.query(
        `insert into tra.veiculo (placa, tipo_id, marca_id, modelo, ano_fabricacao, ano_modelo, cor, combustivel, propriedade, unidade_id, km_atual, situacao, passageiros, macas, cadeiras_rodas, acessivel)
         values ($1,$2,$3,$4,2022,2023,'BRANCA',$5,'PROPRIO',$6,$7,'ATIVO',$8,$9,$10,$11) returning id`,
        [placa, await tipo(t), await marca(m), modelo, comb, lotacao, km, pax, macas, cadeiras, cadeiras > 0],
      )
    ).rows[0].id;
  }
  const condutores: number[] = [];
  for (const [nome, cpf, cnh, cat, validade] of [
    ['JOSÉ CARLOS DE ALMEIDA', '52998224725', '04512367891', 'D', '2029-05-10'],
    ['ANTÔNIO MARCOS PEREIRA', '11144477735', '05123498760', 'D', '2028-11-22'],
    ['ROBERTO SILVA SANTOS', '39053344705', '06234519873', 'AD', '2027-08-03'],
    ['MARCELO AUGUSTO FERREIRA', '86288366757', '07345621984', 'B', '2030-01-15'],
  ] as const)
    condutores.push(
      (
        await c.query(`insert into tra.condutor (nome, cpf, cnh_numero, cnh_categoria, cnh_validade, curso_transporte_pacientes, telefone) values ($1,$2,$3,$4,$5,true,'11945671234') returning id`, [nome, cpf, cnh, cat, validade])
      ).rows[0].id,
    );
  const embarque = (
    await c.query(`insert into tra.local_embarque (nome, endereco) values ('PRAÇA DA MATRIZ - CENTRO', 'PRAÇA PADRE ANTÔNIO, EM FRENTE À IGREJA MATRIZ'), ('TERMINAL RODOVIÁRIO DE JACARÉ', 'DISTRITO DE JACARÉ'), ('UBS BONFIM', 'BAIRRO BONFIM') returning id`)
  ).rows.map((r) => r.id as number);
  const mun = (ibge: string) => idDe(c, 'cad.municipio', ibge, 'codigo_ibge');
  const local = (n: string) => idDe(c, 'tra.local_destino', n);
  const motivo = (n: string) => idDe(c, 'tra.motivo_viagem', n);

  // [nome, destino IBGE, local, motivo, veículo, condutor, paradas (IBGE), km ida e volta, valor, dias, hora, vagas, pedágios]
  const ROTAS: [string, string, string, string, string, number, string[], number, number, string[], string, number, number][] = [
    ['CABREÚVA x JUNDIAÍ', '3525904', 'HOSPITAL UNIVERSITÁRIO DE JUNDIAÍ', 'CONSULTA ESPECIALIZADA', 'FHX3A21', 0, ['3525904'], 64, 380, ['1', '2', '3', '4', '5'], '06:00', 14, 0],
    ['CABREÚVA x SÃO PAULO (HOSPITAIS)', '3550308', 'HOSPITAL DAS CLÍNICAS DA FMUSP', 'TRATAMENTO ONCOLÓGICO (QUIMIO/RADIOTERAPIA)', 'GBC7D45', 1, ['3525904', '3550308'], 190, 1450, ['2', '4'], '04:30', 22, 4],
    ['CABREÚVA x CAMPINAS', '3509502', 'HOSPITAL DE CLÍNICAS DA UNICAMP', 'EXAME / DIAGNÓSTICO', 'EKT2F19', 2, ['3520509', '3509502'], 150, 820, ['1', '3', '5'], '05:00', 14, 2],
    ['CABREÚVA x SOROCABA', '3552205', 'CONJUNTO HOSPITALAR DE SOROCABA', 'CONSULTA ESPECIALIZADA', 'EKT2F19', 2, ['3523909', '3552205'], 130, 690, ['2', '4'], '05:30', 14, 2],
    ['CABREÚVA x BARRETOS (HOSPITAL DE AMOR)', '3505500', 'HOSPITAL DE AMOR (BARRETOS)', 'TRATAMENTO ONCOLÓGICO (QUIMIO/RADIOTERAPIA)', 'FTR8B07', 3, ['3505500'], 720, 2100, ['3'], '02:00', 5, 6],
    ['CIRCULAR MUNICIPAL - DISTRITOS', '3508405', 'CENTRO DE ESPECIALIDADES MÉDICAS DE CABREÚVA', 'FISIOTERAPIA / REABILITAÇÃO', 'FZK5E80', 3, ['3508405'], 40, 150, ['1', '2', '3', '4', '5'], '07:00', 4, 0],
  ];
  const hoje = new Date();
  const inicioAgenda = iso(new Date(hoje.getTime() - 200 * 86_400_000));
  const fimAgenda = iso(new Date(hoje.getTime() + 240 * 86_400_000));
  const sortear = sorteador(20260419);
  const pac = ctx.pacientes;
  const despesaId = async (n: string) => (await idDe(c, 'tra.despesa', n))!;
  const [diesel, gasolina, refeicao, pedagio, estacionamento] = [await despesaId('ÓLEO DIESEL S10'), await despesaId('GASOLINA COMUM'), await despesaId('REFEIÇÃO DO CONDUTOR'), await despesaId('PEDÁGIO'), await despesaId('ESTACIONAMENTO')];
  const operador = (await c.query(`select id from seg.operador where login = 'recepcao'`)).rows[0]?.id ?? null;
  let seqPac = 0;

  for (const [nome, destino, loc, mot, placa, cond, paradas, km, valor, dias, hora, vagas, pedagios] of ROTAS) {
    const destinoId = await mun(destino);
    const localId = await local(loc);
    const motivoId = await motivo(mot);
    const rota = (
      await c.query(
        `insert into tra.rota (nome, municipio_destino_id, local_destino_id, motivo_id, veiculo_id, condutor_id, local_embarque_id, abrangencia, distancia_km, valor_viagem)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [nome, destinoId, localId, motivoId, veiculos[placa], condutores[cond], embarque[0], destino === '3508405' ? 'MUNICIPIO' : 'FORA', km, valor],
      )
    ).rows[0].id;
    let ordem = 0;
    for (const p of paradas) await c.query(`insert into tra.rota_parada (rota_id, ordem, municipio_id, local_destino_id) values ($1,$2,$3,$4)`, [rota, ++ordem, await mun(p), p === destino ? localId : null]);
    const agenda = (
      await c.query(
        `insert into tra.agenda (rota_id, veiculo_id, condutor_id, local_embarque_id, vagas, hora_saida, data_inicial, data_final, dias_semana) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [rota, veiculos[placa], condutores[cond], embarque[0], vagas, hora, inicioAgenda, fimAgenda, dias],
      )
    ).rows[0].id;
    const combustivel = placa === 'FTR8B07' || placa === 'FZK5E80' ? gasolina : diesel;
    const consumo = placa === 'GBC7D45' ? 4.5 : placa === 'FTR8B07' || placa === 'FZK5E80' ? 10.5 : 8.2;
    let kmVeiculo = 20000 + Math.round(sortear() * 30000);

    // Histórico de 150 dias (viagens concluídas) e próximos 12 dias (agendadas).
    for (let d = -150; d <= 12; d++) {
      const data = new Date(hoje.getTime() + d * 86_400_000);
      if (!dias.includes(String(data.getUTCDay())) || d === 0) continue;
      if (d < 0 && sortear() < 0.35) continue;
      const passado = d < 0;
      const n = passado ? Math.max(1, Math.round(vagas * (0.45 + sortear() * 0.5))) : Math.max(1, Math.round(vagas * (0.2 + sortear() * 0.3)));
      const viagem = (
        await c.query(
          `insert into tra.viagem (agenda_id, rota_id, data_saida, hora_saida, veiculo_id, condutor_id, municipio_destino_id, local_destino_id, motivo_id, local_embarque_id, vagas, valor_viagem, situacao, confirmada_em, confirmada_por)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
          [agenda, rota, iso(data), hora, veiculos[placa], condutores[cond], destinoId, localId, motivoId, embarque[0], vagas, valor, passado ? 'CONFIRMADA' : d <= 2 ? 'CONFIRMADA' : 'ABERTA', passado || d <= 2 ? data : null, passado || d <= 2 ? operador : null],
        )
      ).rows[0].id;
      let presentes = 0;
      let poltrona = 0;
      const inicio = (seqPac += 7);
      for (let k = 0; k < n && k < pac.length && poltrona < vagas; k++) {
        const paciente = pac[(inicio + k) % pac.length];
        const falta = passado && sortear() < 0.1;
        const comAcomp = sortear() < 0.3 && poltrona + 2 <= vagas;
        const indefinido = !passado && comAcomp && sortear() < 0.4;
        const vp = (
          await c.query(
            `insert into tra.viagem_passageiro (viagem_id, paciente_id, municipio_destino_id, local_destino_id, local_destino, motivo_id, local_embarque_id, hora_saida, horario_compromisso, poltrona, tipo_viagem, ocupa_vaga, situacao, observacao_ausencia, agendado_por)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'IDA_VOLTA',true,$11,$12,$13) on conflict do nothing returning id`,
            [viagem, paciente, destinoId, localId, loc, motivoId, embarque[0], hora, `${String(8 + (k % 6)).padStart(2, '0')}:${k % 2 ? '30' : '00'}`, ++poltrona, passado ? (falta ? 'FALTA' : 'PRESENTE') : d <= 2 ? 'CONFIRMADO' : 'AGENDADO', falta ? (sortear() < 0.5 ? 'Paciente não compareceu ao embarque.' : 'Familiar informou internação do paciente.') : null, operador],
          )
        ).rows[0]?.id;
        if (!vp) continue;
        await c.query(`update tra.viagem_passageiro set protocolo = $2 where id = $1`, [vp, `TR${iso(data).slice(2, 4)}${String(vp).padStart(6, '0')}`]);
        if (!falta) presentes++;
        if (comAcomp)
          await c.query(`insert into tra.viagem_acompanhante (passageiro_id, indefinido, nome, documento, parentesco, tipo_viagem, ocupa_vaga, poltrona) values ($1,$2,$3,$4,$5,'IDA_VOLTA',true,$6)`, [
            vp,
            indefinido,
            indefinido ? null : 'MARIA APARECIDA DOS SANTOS',
            indefinido ? null : '23456789X',
            indefinido ? null : 'FILHA',
            ++poltrona,
          ]);
      }
      if (!passado) continue;
      // Fechamento com km, despesas, adiantamento e custo por paciente (TR 1.2.40.9, 1.2.40.22).
      const kmViagem = Math.round(km * (0.95 + sortear() * 0.15));
      const litros = Math.round((kmViagem / (consumo * (0.9 + sortear() * 0.2))) * 10) / 10;
      const preco = combustivel === diesel ? 6.09 + sortear() * 0.3 : 6.19 + sortear() * 0.3;
      const despesas: [number, number, number][] = [[combustivel, litros, Math.round(preco * 100) / 100]];
      if (km > 100) despesas.push([refeicao, 1, 35]);
      if (pedagios) despesas.push([pedagio, pedagios, 12.4]);
      if (km > 150 && sortear() < 0.5) despesas.push([estacionamento, 1, 25]);
      for (const [desp, q, vu] of despesas)
        await c.query(`insert into tra.viagem_despesa (viagem_id, despesa_id, data, quantidade, valor_unitario, valor_total) values ($1,$2,$3,$4,$5,$6)`, [viagem, desp, iso(data), q, vu, Math.round(q * vu * 100) / 100]);
      if (km > 100) await c.query(`insert into tra.viagem_adiantamento (viagem_id, data, condutor_id, valor, finalidade, operador_id) values ($1,$2,$3,$4,'Alimentação, pedágios e estacionamento',$5)`, [viagem, iso(data), condutores[cond], 100 + pedagios * 15, operador]);
      const custo = presentes ? Math.round((valor / presentes) * 100) / 100 : null;
      await c.query(`update tra.viagem_passageiro set custo = $2 where viagem_id = $1 and situacao = 'PRESENTE'`, [viagem, custo]);
      await c.query(
        `update tra.viagem set situacao = 'CONCLUIDA', km_inicial = $2, km_final = $3, data_chegada = data_saida, hora_chegada = $4, custo_paciente = $5, fechada_em = data_saida + interval '18 hours', fechada_por = $6 where id = $1`,
        [viagem, kmVeiculo, kmVeiculo + kmViagem, km > 300 ? '23:30' : '17:00', custo, operador],
      );
      kmVeiculo += kmViagem;
    }
  }
  // Viagem sem agendamento prévio, confirmada, para alta hospitalar (TR 1.2.40.17, 1.2.40.19).
  await c.query(
    `insert into tra.viagem (data_saida, hora_saida, veiculo_id, condutor_id, municipio_destino_id, local_destino_id, motivo_id, local_embarque_id, vagas, valor_viagem, sem_agendamento, situacao, confirmada_em, confirmada_por, observacao)
     values (current_date + 1, '09:00', $1, $2, $3, $4, $5, $6, 2, 300, true, 'CONFIRMADA', now(), $7, 'Remoção de paciente acamado - alta hospitalar')`,
    [veiculos['GAM1C33'], condutores[2], await mun('3525904'), await local('HOSPITAL SÃO VICENTE DE PAULO - JUNDIAÍ'), await motivo('ALTA HOSPITALAR'), embarque[0], operador],
  );
});
