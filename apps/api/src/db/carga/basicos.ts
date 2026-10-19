// Tabelas povoadas na instalação (TR 1.2.1.1: municípios, tipos de logradouro, religiões,
// tipos de encaminhamento, vulnerabilidades e CBO já povoados).
import { readFileSync } from 'node:fs';
import iconv from 'iconv-lite';
import type pg from 'pg';

const dados = (arq: string) => new URL(`../../../dados/${arq}`, import.meta.url).pathname;

function csv(texto: string, sep = ','): Record<string, string>[] {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const cab = linhas[0].split(sep).map((c) => c.trim());
  return linhas.slice(1).map((l) => {
    const v = l.split(sep);
    return Object.fromEntries(cab.map((c, i) => [c, (v[i] ?? '').trim()]));
  });
}

async function inserirVarios(c: pg.PoolClient, sql: string, linhas: unknown[][]) {
  for (const l of linhas) await c.query(sql, l);
}

export async function carregarEnderecos(c: pg.PoolClient) {
  const estados = csv(readFileSync(dados('ibge/estados.csv'), 'utf8'));
  for (const e of estados) {
    await c.query(
      `insert into cad.uf (codigo_ibge, sigla, nome) values ($1,$2,$3) on conflict (codigo_ibge) do update set nome = excluded.nome`,
      [e.codigo_uf, e.uf, e.nome],
    );
  }
  const ufPorCodigo = new Map((await c.query(`select id, codigo_ibge from cad.uf`)).rows.map((r) => [r.codigo_ibge, r.id]));
  const municipios = csv(readFileSync(dados('ibge/municipios.csv'), 'utf8'));
  const lote = 500;
  for (let i = 0; i < municipios.length; i += lote) {
    const parte = municipios.slice(i, i + lote);
    const valores: unknown[] = [];
    const tuplas = parte.map((m, j) => {
      valores.push(m.codigo_ibge, m.nome, ufPorCodigo.get(m.codigo_uf), Number(m.latitude), Number(m.longitude));
      const b = j * 5;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
    });
    await c.query(
      `insert into cad.municipio (codigo_ibge, nome, uf_id, latitude, longitude) values ${tuplas.join(',')}
       on conflict (codigo_ibge) do update set nome = excluded.nome, latitude = excluded.latitude, longitude = excluded.longitude`,
      valores,
    );
  }

  const tipos: [string, string, string][] = [
    ['081', 'RUA', 'R'], ['008', 'AVENIDA', 'AV'], ['100', 'TRAVESSA', 'TV'], ['004', 'ALAMEDA', 'AL'], ['031', 'ESTRADA', 'EST'],
    ['090', 'RODOVIA', 'ROD'], ['065', 'PRAÇA', 'PC'], ['118', 'VIELA', 'VLA'], ['096', 'SERVIDÃO', 'SERV'], ['104', 'VILA', 'VL'],
    ['040', 'LARGO', 'LGO'], ['030', 'ESTRADA MUNICIPAL', 'EST MUN'], ['076', 'RUA PROJETADA', 'R PROJ'], ['012', 'BECO', 'BC'],
    ['014', 'CAMINHO', 'CAM'], ['023', 'CONDOMÍNIO', 'COND'], ['043', 'LOTEAMENTO', 'LOT'], ['047', 'MARGINAL', 'MARG'],
    ['060', 'PARQUE', 'PQ'], ['070', 'PASSAGEM', 'PSG'], ['085', 'SÍTIO', 'SIT'], ['033', 'FAZENDA', 'FAZ'], ['018', 'CHÁCARA', 'CHAC'],
    ['050', 'JARDIM', 'JD'], ['101', 'TREVO', 'TRV'], ['105', 'VIADUTO', 'VD'], ['106', 'VIA', 'VIA'], ['999', 'OUTROS', 'OUTROS'],
  ];
  await inserirVarios(c, `insert into cad.tipo_logradouro (codigo, nome, abreviatura) values ($1,$2,$3) on conflict (codigo) do nothing`, tipos);

  const paises: [string, string][] = [
    ['10', 'BRASIL'], ['14', 'ARGENTINA'], ['17', 'BOLÍVIA'], ['21', 'CHILE'], ['26', 'COLÔMBIA'], ['45', 'PARAGUAI'], ['48', 'PERU'],
    ['56', 'URUGUAI'], ['58', 'VENEZUELA'], ['35', 'HAITI'], ['15', 'ALEMANHA'], ['19', 'CANADÁ'], ['31', 'ESPANHA'], ['32', 'ESTADOS UNIDOS'],
    ['33', 'FRANÇA'], ['38', 'ITÁLIA'], ['39', 'JAPÃO'], ['49', 'PORTUGAL'], ['22', 'CHINA'], ['11', 'ANGOLA'], ['99', 'OUTROS'],
  ];
  await inserirVarios(c, `insert into cad.pais (codigo, nome) values ($1,$2) on conflict (codigo) do nothing`, paises);
}

export async function carregarTabelasApoio(c: pg.PoolClient) {
  const simples = async (tabela: string, nomes: string[]) => {
    for (const n of nomes) await c.query(`insert into ${tabela} (nome) select $1::varchar where not exists (select 1 from ${tabela} where nome = $1::varchar)`, [n]);
  };
  await simples('cad.religiao', [
    'Católica', 'Evangélica', 'Espírita', 'Umbanda', 'Candomblé', 'Judaica', 'Islâmica', 'Budista', 'Testemunha de Jeová',
    'Adventista', 'Sem religião', 'Outra', 'Não informada',
  ]);
  await simples('cad.tipo_encaminhamento', [
    'Encaminhamento interno no dia', 'Encaminhamento para serviço especializado', 'Encaminhamento para internação hospitalar',
    'Encaminhamento para urgência', 'Encaminhamento para serviço de atenção domiciliar', 'Encaminhamento intersetorial',
    'Encaminhamento para CAPS', 'Encaminhamento para NASF/eMulti', 'Retorno para consulta agendada', 'Retorno para cuidado continuado/programado',
  ]);
  await simples('cad.tipo_vulnerabilidade', [
    'Situação de rua', 'Extrema pobreza', 'Violência doméstica', 'Trabalho infantil', 'Dependência química', 'Abandono / negligência',
    'Pessoa idosa vivendo só', 'Deficiência sem cuidador', 'Insegurança alimentar', 'Migrante / refugiado', 'Privado de liberdade',
  ]);
  const etnias: [string, string][] = [
    ['0001', 'ACONA (WAKONAS, NACONAS, JAKONA, ACORANES)'], ['0071', 'GUARANI'], ['0072', 'GUARANI KAIOWÁ'], ['0073', 'GUARANI MBYA'],
    ['0074', 'GUARANI NHANDEVA'], ['0125', 'KAINGANG'], ['0235', 'PATAXÓ'], ['0270', 'TERENA'], ['0299', 'TUPI GUARANI'],
    ['0306', 'XAVANTE'], ['0317', 'YANOMÁMI'], ['X999', 'SEM INFORMAÇÃO'],
  ];
  await inserirVarios(c, `insert into cad.etnia (codigo, nome) values ($1,$2) on conflict (codigo) do nothing`, etnias);

  // CBO: ocupações de saúde e administrativas de uso frequente. A tabela completa é
  // importada do SIGTAP (tb_ocupacao) na competência vigente.
  const cbos: [string, string, boolean, boolean, string[]][] = [
    ['225125', 'Médico clínico', true, true, ['USF', 'UBS', 'ESPECIALIZADO', 'HOSPITALAR']],
    ['225142', 'Médico da estratégia de saúde da família', true, true, ['USF']],
    ['225170', 'Médico generalista', true, true, ['USF', 'UBS']],
    ['225124', 'Médico pediatra', true, true, ['UBS', 'ESPECIALIZADO', 'HOSPITALAR']],
    ['225250', 'Médico ginecologista e obstetra', true, true, ['UBS', 'ESPECIALIZADO', 'HOSPITALAR']],
    ['225120', 'Médico cardiologista', true, true, ['ESPECIALIZADO', 'HOSPITALAR']],
    ['225133', 'Médico psiquiatra', true, true, ['ESPECIALIZADO']],
    ['225112', 'Médico neurologista', true, true, ['ESPECIALIZADO']],
    ['225270', 'Médico ortopedista e traumatologista', true, true, ['ESPECIALIZADO', 'HOSPITALAR']],
    ['225265', 'Médico oftalmologista', true, true, ['ESPECIALIZADO']],
    ['225275', 'Médico otorrinolaringologista', true, true, ['ESPECIALIZADO']],
    ['225135', 'Médico dermatologista', true, true, ['ESPECIALIZADO']],
    ['225155', 'Médico endocrinologista e metabologista', true, true, ['ESPECIALIZADO']],
    ['225285', 'Médico urologista', true, true, ['ESPECIALIZADO']],
    ['225320', 'Médico em radiologia e diagnóstico por imagem', true, true, ['ESPECIALIZADO']],
    ['225335', 'Médico patologista clínico / medicina laboratorial', true, true, ['ESPECIALIZADO']],
    ['225150', 'Médico em medicina intensiva', true, true, ['HOSPITALAR']],
    ['225130', 'Médico de família e comunidade', true, true, ['USF', 'UBS']],
    ['223505', 'Enfermeiro', true, true, ['USF', 'UBS', 'ESPECIALIZADO', 'HOSPITALAR']],
    ['223565', 'Enfermeiro da estratégia de saúde da família', true, true, ['USF']],
    ['322205', 'Técnico de enfermagem', true, false, ['USF', 'UBS', 'ESPECIALIZADO', 'HOSPITALAR']],
    ['322245', 'Técnico de enfermagem de saúde da família', true, false, ['USF']],
    ['322230', 'Auxiliar de enfermagem', true, false, ['USF', 'UBS', 'ESPECIALIZADO', 'HOSPITALAR']],
    ['223208', 'Cirurgião-dentista - clínico geral', true, true, ['USF', 'UBS', 'ESPECIALIZADO']],
    ['223293', 'Cirurgião-dentista da estratégia de saúde da família', true, true, ['USF']],
    ['223212', 'Cirurgião-dentista - endodontista', true, true, ['ESPECIALIZADO']],
    ['223236', 'Cirurgião-dentista - odontopediatra', true, true, ['ESPECIALIZADO']],
    ['223248', 'Cirurgião-dentista - periodontista', true, true, ['ESPECIALIZADO']],
    ['322415', 'Auxiliar em saúde bucal', true, false, ['USF', 'UBS', 'ESPECIALIZADO']],
    ['322430', 'Auxiliar em saúde bucal da estratégia de saúde da família', true, false, ['USF']],
    ['322405', 'Técnico em saúde bucal', true, false, ['USF', 'UBS', 'ESPECIALIZADO']],
    ['515105', 'Agente comunitário de saúde', true, false, ['USF']],
    ['515140', 'Agente de combate às endemias', true, false, ['ADMINISTRATIVO']],
    ['223405', 'Farmacêutico', true, true, ['UBS', 'ESPECIALIZADO', 'HOSPITALAR']],
    ['324205', 'Técnico em farmácia', true, false, ['UBS', 'ESPECIALIZADO']],
    ['251510', 'Psicólogo clínico', true, true, ['UBS', 'ESPECIALIZADO']],
    ['223605', 'Fisioterapeuta geral', true, true, ['ESPECIALIZADO', 'HOSPITALAR']],
    ['223905', 'Terapeuta ocupacional', true, true, ['ESPECIALIZADO']],
    ['223710', 'Nutricionista', true, true, ['UBS', 'ESPECIALIZADO']],
    ['223810', 'Fonoaudiólogo', true, true, ['ESPECIALIZADO']],
    ['251605', 'Assistente social', true, true, ['UBS', 'ESPECIALIZADO', 'ADMINISTRATIVO']],
    ['221205', 'Biomédico', true, true, ['ESPECIALIZADO']],
    ['324115', 'Técnico em radiologia e imagenologia', true, false, ['ESPECIALIZADO']],
    ['324205', 'Técnico em farmácia', true, false, ['UBS']],
    ['515210', 'Auxiliar de farmácia de manipulação', true, false, ['UBS']],
    ['782320', 'Motorista de ambulância', false, false, ['ADMINISTRATIVO']],
    ['782305', 'Motorista de carro de passeio', false, false, ['ADMINISTRATIVO']],
    ['411010', 'Assistente administrativo', false, false, ['ADMINISTRATIVO', 'USF', 'UBS', 'ESPECIALIZADO']],
    ['422110', 'Recepcionista, em geral', false, false, ['USF', 'UBS', 'ESPECIALIZADO', 'HOSPITALAR']],
    ['131210', 'Gerente de serviços de saúde', false, true, ['ADMINISTRATIVO']],
    ['142105', 'Gerente administrativo', false, true, ['ADMINISTRATIVO']],
  ];
  await inserirVarios(
    c,
    `insert into cad.cbo (codigo, nome, area_saude, nivel_superior, atuacao) values ($1,$2,$3,$4,$5) on conflict (codigo) do nothing`,
    cbos,
  );

  await c.query(`insert into cad.convenio (nome, sus) select 'SUS', true where not exists (select 1 from cad.convenio where nome = 'SUS')`);
}

/** CID-10 completa a partir dos arquivos oficiais do DATASUS (ISO-8859-1, separados por ';'). */
export async function carregarCid10(c: pg.PoolClient) {
  const ler = (arq: string) => csv(iconv.decode(readFileSync(dados(`cid10/${arq}`)), 'latin1'), ';');
  const capitulos = ler('CID-10-CAPITULOS.CSV');
  const capituloDe = (cat: string) =>
    capitulos.find((cp) => cat >= cp.CATINIC && cat <= cp.CATFIM)?.NUMCAP ?? null;
  const notificaveis = new Set([
    'A00', 'A01', 'A05', 'A15', 'A16', 'A17', 'A18', 'A19', 'A20', 'A22', 'A27', 'A30', 'A33', 'A34', 'A35', 'A36', 'A37', 'A39', 'A50',
    'A51', 'A52', 'A53', 'A56', 'A80', 'A82', 'A90', 'A91', 'A92', 'A95', 'A98', 'B01', 'B03', 'B05', 'B06', 'B15', 'B16', 'B17', 'B18',
    'B19', 'B20', 'B21', 'B22', 'B23', 'B24', 'B26', 'B34', 'B50', 'B51', 'B52', 'B53', 'B54', 'B55', 'B57', 'B65', 'T60', 'U07', 'W54', 'X58',
    'Y09', 'T74',
  ]);
  const subcats = ler('CID-10-SUBCATEGORIAS.CSV');
  const categorias = ler('CID-10-CATEGORIAS.CSV');
  const linhas: [string, string, string | null, string | null, string | null, boolean][] = [];
  for (const cat of categorias) {
    linhas.push([cat.CAT, cat.DESCRICAO, cat.DESCRABREV?.slice(0, 120) || null, capituloDe(cat.CAT), null, notificaveis.has(cat.CAT)]);
  }
  for (const s of subcats) {
    const cat = s.SUBCAT.slice(0, 3);
    const sexo = s.RESTRSEXO === 'M' || s.RESTRSEXO === 'F' ? s.RESTRSEXO : null;
    linhas.push([s.SUBCAT, s.DESCRICAO, s.DESCRABREV?.slice(0, 120) || null, capituloDe(cat), sexo, notificaveis.has(cat)]);
  }
  const lote = 400;
  for (let i = 0; i < linhas.length; i += lote) {
    const parte = linhas.slice(i, i + lote);
    const valores: unknown[] = [];
    const tuplas = parte.map((l, j) => {
      valores.push(...l);
      const b = j * 6;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
    });
    await c.query(
      `insert into cad.cid (codigo, nome, nome_abreviado, capitulo, restricao_sexo, notificavel) values ${tuplas.join(',')}
       on conflict (codigo) do update set nome = excluded.nome, nome_abreviado = excluded.nome_abreviado, capitulo = excluded.capitulo`,
      valores,
    );
  }
  return linhas.length;
}
