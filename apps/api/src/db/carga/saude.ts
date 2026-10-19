// Tabelas clínicas iniciais: especialidades, CIAP-2 e procedimentos frequentes.
// A tabela SIGTAP completa é carregada pelo importador oficial (Faturamento > Importar SIGTAP).
import type pg from 'pg';

const PROCEDIMENTOS: [string, string, string, string[], number | null, string?][] = [
  // código, nome, complexidade, instrumentos, valor SA, sexo
  ['0101010010', 'ATIVIDADE EDUCATIVA / ORIENTAÇÃO EM GRUPO NA ATENÇÃO PRIMÁRIA', '1', ['01', '10'], null],
  ['0101030010', 'VISITA DOMICILIAR POR PROFISSIONAL DE NÍVEL MÉDIO', '1', ['01', '10'], null],
  ['0101040024', 'AVALIAÇÃO ANTROPOMÉTRICA', '1', ['01', '10'], null],
  ['0214010015', 'GLICEMIA CAPILAR', '1', ['01', '10'], null],
  ['0301010030', 'CONSULTA DE PROFISSIONAIS DE NÍVEL SUPERIOR NA ATENÇÃO PRIMÁRIA (EXCETO MÉDICO)', '1', ['01', '10'], null],
  ['0301010048', 'CONSULTA DE PROFISSIONAIS DE NÍVEL SUPERIOR NA ATENÇÃO ESPECIALIZADA (EXCETO MÉDICO)', '2', ['01', '02'], 6.3],
  ['0301010064', 'CONSULTA MÉDICA EM ATENÇÃO PRIMÁRIA', '1', ['01', '10'], null],
  ['0301010072', 'CONSULTA MÉDICA EM ATENÇÃO ESPECIALIZADA', '2', ['01', '02'], 10],
  ['0301010153', 'PRIMEIRA CONSULTA ODONTOLÓGICA PROGRAMÁTICA', '1', ['01', '10'], null],
  ['0301060029', 'ATENDIMENTO DE URGÊNCIA C/ OBSERVAÇÃO ATÉ 24 HORAS EM ATENÇÃO ESPECIALIZADA', '2', ['02'], 12.47],
  ['0301060096', 'ATENDIMENTO MÉDICO EM UNIDADE DE PRONTO ATENDIMENTO', '2', ['02'], 11],
  ['0301060118', 'ACOLHIMENTO COM CLASSIFICAÇÃO DE RISCO', '2', ['01', '02'], null],
  ['0301100039', 'AFERIÇÃO DE PRESSÃO ARTERIAL', '1', ['01', '10'], null],
  ['0202010295', 'DOSAGEM DE COLESTEROL TOTAL', '2', ['01', '02'], 1.85],
  ['0202010279', 'DOSAGEM DE COLESTEROL HDL', '2', ['01', '02'], 3.51],
  ['0202010678', 'DOSAGEM DE TRIGLICERÍDEOS', '2', ['01', '02'], 3.51],
  ['0202010317', 'DOSAGEM DE CREATININA', '2', ['01', '02'], 1.85],
  ['0202010473', 'DOSAGEM DE GLICOSE', '2', ['01', '02'], 1.85],
  ['0202020380', 'HEMOGRAMA COMPLETO', '2', ['01', '02'], 4.11],
  ['0202050017', 'ANÁLISE DE CARACTERES FÍSICOS, ELEMENTOS E SEDIMENTO DA URINA', '2', ['01', '02'], 3.7],
  ['0203010019', 'EXAME CITOPATOLÓGICO CÉRVICO-VAGINAL / MICROFLORA', '2', ['01', '02'], 6.97, 'F'],
  ['0204030153', 'RADIOGRAFIA DE TÓRAX (PA E PERFIL)', '2', ['01', '02'], 9.5],
  ['0204030188', 'MAMOGRAFIA BILATERAL PARA RASTREAMENTO', '2', ['02'], 45, 'F'],
  ['0205020046', 'ULTRASSONOGRAFIA DE ABDÔMEN TOTAL', '2', ['01', '02'], 37.95],
  ['0205020186', 'ULTRASSONOGRAFIA TRANSVAGINAL', '2', ['01', '02'], 24.2, 'F'],
];

const CIAP: [string, string][] = [
  ['A01', 'Dor generalizada / múltipla'], ['A03', 'Febre'], ['A04', 'Debilidade / cansaço geral'], ['A97', 'Sem doença'],
  ['A98', 'Medicina preventiva / manutenção da saúde'], ['D01', 'Dor abdominal generalizada / cólicas'], ['D11', 'Diarreia'],
  ['D70', 'Infecção gastrointestinal'], ['K86', 'Hipertensão sem complicações'], ['K87', 'Hipertensão com complicações'],
  ['L03', 'Sinais / sintomas da região lombar'], ['N01', 'Cefaleia'], ['P74', 'Distúrbio ansioso / estado de ansiedade'],
  ['P76', 'Perturbações depressivas'], ['R05', 'Tosse'], ['R74', 'Infecção aguda do aparelho respiratório superior'], ['R80', 'Gripe'],
  ['S88', 'Dermatite de contato / alérgica'], ['T89', 'Diabetes insulino-dependente'], ['T90', 'Diabetes não insulino-dependente'],
  ['U71', 'Cistite / outra infecção urinária'], ['W78', 'Gravidez'], ['W84', 'Gravidez de alto risco'], ['X37', 'Neoplasia maligna do colo do útero'],
  ['Y08', 'Sinais / sintomas sexuais no homem'], ['Z29', 'Problema social NE'],
];

const ESPECIALIDADES: [string, string, string, string, number | null, number | null, string, string][] = [
  // nome, tipo, atenção, sexo, idade min, idade max, cbo, procedimento faturado
  ['CLÍNICA GERAL', 'MEDICA', 'BASICA', 'A', null, null, '225125', '0301010064'],
  ['MEDICINA DE FAMÍLIA', 'MEDICA', 'BASICA', 'A', null, null, '225142', '0301010064'],
  ['PEDIATRIA', 'MEDICA', 'BASICA', 'A', 0, 17, '225124', '0301010064'],
  ['GINECOLOGIA E OBSTETRÍCIA', 'MEDICA', 'ESPECIALIZADA', 'F', null, null, '225250', '0301010072'],
  ['CARDIOLOGIA', 'MEDICA', 'ESPECIALIZADA', 'A', null, null, '225120', '0301010072'],
  ['ORTOPEDIA', 'MEDICA', 'ESPECIALIZADA', 'A', null, null, '225270', '0301010072'],
  ['PSIQUIATRIA', 'MEDICA', 'ESPECIALIZADA', 'A', null, null, '225133', '0301010072'],
  ['NEUROLOGIA', 'MEDICA', 'ESPECIALIZADA', 'A', null, null, '225112', '0301010072'],
  ['OFTALMOLOGIA', 'MEDICA', 'ESPECIALIZADA', 'A', null, null, '225265', '0301010072'],
  ['DERMATOLOGIA', 'MEDICA', 'ESPECIALIZADA', 'A', null, null, '225135', '0301010072'],
  ['ENDOCRINOLOGIA', 'MEDICA', 'ESPECIALIZADA', 'A', null, null, '225155', '0301010072'],
  ['UROLOGIA', 'MEDICA', 'ESPECIALIZADA', 'A', null, null, '225285', '0301010072'],
  ['CLÍNICA MÉDICA - PRONTO ATENDIMENTO', 'MEDICA', 'ESPECIALIZADA', 'A', null, null, '225125', '0301060096'],
  ['ENFERMAGEM', 'ENFERMAGEM', 'BASICA', 'A', null, null, '223505', '0301010030'],
  ['ODONTOLOGIA - CLÍNICO GERAL', 'ODONTOLOGICA', 'BASICA', 'A', null, null, '223208', '0301010153'],
  ['ENDODONTIA', 'ODONTOLOGICA', 'ESPECIALIZADA', 'A', null, null, '223212', '0301010048'],
  ['ODONTOPEDIATRIA', 'ODONTOLOGICA', 'ESPECIALIZADA', 'A', 0, 14, '223236', '0301010048'],
  ['PSICOLOGIA', 'MULTIPROFISSIONAL', 'ESPECIALIZADA', 'A', null, null, '251510', '0301010048'],
  ['FISIOTERAPIA', 'MULTIPROFISSIONAL', 'ESPECIALIZADA', 'A', null, null, '223605', '0301010048'],
  ['NUTRIÇÃO', 'MULTIPROFISSIONAL', 'ESPECIALIZADA', 'A', null, null, '223710', '0301010048'],
  ['FONOAUDIOLOGIA', 'MULTIPROFISSIONAL', 'ESPECIALIZADA', 'A', null, null, '223810', '0301010048'],
  ['SERVIÇO SOCIAL', 'MULTIPROFISSIONAL', 'ESPECIALIZADA', 'A', null, null, '251605', '0301010048'],
];

export async function carregarTabelasSaude(c: pg.PoolClient) {
  for (const [codigo, nome, complexidade, instrumentos, valor, sexo] of PROCEDIMENTOS) {
    await c.query(
      `insert into cad.procedimento (codigo, nome, grupo, subgrupo, forma_organizacao, complexidade, instrumentos, valor_sa, sexo, competencia, ativo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,null,true) on conflict (codigo) do nothing`,
      [codigo, nome, codigo.slice(0, 2), codigo.slice(0, 4), codigo.slice(0, 6), complexidade, instrumentos, valor, sexo ?? 'A'],
    );
  }
  for (const [codigo, nome] of CIAP) {
    await c.query(`insert into cad.ciap (codigo, nome, ativo) values ($1,$2,true) on conflict (codigo) do nothing`, [codigo, nome]);
  }
  for (const [nome, tipo, atencao, sexo, imin, imax, cbo, proc] of ESPECIALIDADES) {
    await c.query(
      `insert into cad.especialidade (nome, tipo, atencao, sexo_permitido, idade_minima, idade_maxima, cbo_id, procedimento_id, ativo)
       select $1::varchar,$2::varchar,$3::varchar,$4::varchar,$5::int,$6::int,(select id from cad.cbo where codigo = $7::varchar),(select id from cad.procedimento where codigo = $8::varchar),true
        where not exists (select 1 from cad.especialidade where nome = $1::varchar)`,
      [nome, tipo, atencao, sexo, imin, imax, cbo, proc],
    );
  }
  await c.query(`update cad.cid set notificavel = true where codigo like any(array['A90%','A92%','B05%','A37%','U07%'])`);
}
