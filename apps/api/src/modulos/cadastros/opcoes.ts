// Domínios padronizados pelo CADSUS / e-SUS APS (LEDI) e CNES.

export const SEXO: [string, string][] = [
  ['M', 'Masculino'],
  ['F', 'Feminino'],
  ['I', 'Ignorado'],
];

export const RACA_COR: [string, string][] = [
  ['01', 'Branca'],
  ['02', 'Preta'],
  ['03', 'Parda'],
  ['04', 'Amarela'],
  ['05', 'Indígena'],
  ['99', 'Sem informação'],
];

export const NACIONALIDADE: [string, string][] = [
  ['1', 'Brasileira'],
  ['2', 'Naturalizado'],
  ['3', 'Estrangeiro'],
];

export const SITUACAO_CADASTRAL: [string, string][] = [
  ['ATIVO', 'Ativo'],
  ['DESCONHECIDO', 'Desconhecido'],
  ['MUDOU', 'Mudou-se'],
  ['FALECIDO', 'Falecido'],
  ['PRE_CADASTRO', 'Pré-cadastro'],
];

export const TIPO_SANGUINEO: [string, string][] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((t) => [t, t]);

export const ESCOLARIDADE: [string, string][] = [
  ['51', 'Creche'],
  ['52', 'Pré-escola (exceto CA)'],
  ['53', 'Classe de alfabetização - CA'],
  ['54', 'Ensino fundamental 1ª a 4ª séries'],
  ['55', 'Ensino fundamental 5ª a 8ª séries'],
  ['56', 'Ensino fundamental completo'],
  ['61', 'Ensino fundamental especial'],
  ['58', 'Ensino fundamental EJA - séries iniciais'],
  ['59', 'Ensino fundamental EJA - séries finais'],
  ['60', 'Ensino médio, médio 2º ciclo'],
  ['57', 'Ensino médio especial'],
  ['62', 'Ensino médio EJA'],
  ['63', 'Superior, aperfeiçoamento, especialização, mestrado, doutorado'],
  ['64', 'Alfabetização para adultos'],
  ['65', 'Nenhum'],
];

export const SITUACAO_TRABALHO: [string, string][] = [
  ['66', 'Empregador'],
  ['67', 'Assalariado com carteira de trabalho'],
  ['68', 'Assalariado sem carteira de trabalho'],
  ['69', 'Autônomo com previdência social'],
  ['70', 'Autônomo sem previdência social'],
  ['71', 'Aposentado / pensionista'],
  ['72', 'Desempregado'],
  ['73', 'Não trabalha'],
  ['147', 'Servidor público / militar'],
  ['74', 'Outro'],
];

// Condições de saúde autorreferidas do Cadastro Individual do e-SUS (Ficha A).
export const CONDICOES_SAUDE: [string, string][] = [
  ['gestante', 'Gestante'],
  ['fumante', 'Fumante'],
  ['alcool', 'Faz uso de álcool'],
  ['drogas', 'Faz uso de outras drogas'],
  ['hipertensao', 'Hipertensão arterial'],
  ['diabetes', 'Diabetes'],
  ['avc', 'Teve AVC / derrame'],
  ['infarto', 'Teve infarto'],
  ['cardiaca', 'Doença cardíaca'],
  ['rins', 'Problema nos rins'],
  ['respiratoria', 'Doença respiratória'],
  ['hanseniase', 'Hanseníase'],
  ['tuberculose', 'Tuberculose'],
  ['cancer', 'Câncer'],
  ['internacao_12m', 'Internação nos últimos 12 meses'],
  ['saude_mental', 'Diagnóstico de problema de saúde mental'],
  ['acamado', 'Acamado'],
  ['domiciliado', 'Domiciliado'],
  ['plantas_medicinais', 'Usa plantas medicinais'],
  ['praticas_integrativas', 'Usa outras práticas integrativas'],
];

export const DEFICIENCIAS: [string, string][] = [
  ['auditiva', 'Auditiva'],
  ['visual', 'Visual'],
  ['intelectual', 'Intelectual / cognitiva'],
  ['fisica', 'Física'],
  ['outra', 'Outra'],
];

export const PARENTESCO: [string, string][] = [
  ['RESPONSAVEL', 'Responsável familiar'],
  ['CONJUGE', 'Cônjuge / companheiro(a)'],
  ['FILHO', 'Filho(a)'],
  ['ENTEADO', 'Enteado(a)'],
  ['NETO', 'Neto(a) / bisneto(a)'],
  ['PAI_MAE', 'Pai / mãe'],
  ['SOGRO', 'Sogro(a)'],
  ['IRMAO', 'Irmão / irmã'],
  ['GENRO_NORA', 'Genro / nora'],
  ['OUTRO_PARENTE', 'Outro parente'],
  ['NAO_PARENTE', 'Não parente'],
];

export const UF: [string, string][] = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN',
  'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
].map((u) => [u, u]);

export const CONSELHO_CLASSE: [string, string][] = [
  ['CRM', 'CRM - Medicina'],
  ['COREN', 'COREN - Enfermagem'],
  ['CRO', 'CRO - Odontologia'],
  ['CRF', 'CRF - Farmácia'],
  ['CRP', 'CRP - Psicologia'],
  ['CREFITO', 'CREFITO - Fisioterapia/Terapia ocupacional'],
  ['CRN', 'CRN - Nutrição'],
  ['CRESS', 'CRESS - Serviço social'],
  ['CRFA', 'CRFa - Fonoaudiologia'],
  ['CRBM', 'CRBM - Biomedicina'],
  ['CRTR', 'CRTR - Técnicos em radiologia'],
  ['OUTRO', 'Outro'],
];

export const DIAS_SEMANA: [string, string][] = [
  ['1', 'Segunda'],
  ['2', 'Terça'],
  ['3', 'Quarta'],
  ['4', 'Quinta'],
  ['5', 'Sexta'],
  ['6', 'Sábado'],
  ['0', 'Domingo'],
];

export const TIPO_ESTABELECIMENTO_CNES: [string, string][] = [
  ['01', 'Posto de saúde'],
  ['02', 'Centro de saúde / Unidade básica'],
  ['04', 'Policlínica'],
  ['05', 'Hospital geral'],
  ['07', 'Hospital especializado'],
  ['15', 'Unidade mista'],
  ['20', 'Pronto socorro geral'],
  ['21', 'Pronto socorro especializado'],
  ['22', 'Consultório isolado'],
  ['36', 'Clínica / centro de especialidade'],
  ['39', 'Unidade de apoio diagnose e terapia (SADT isolado)'],
  ['40', 'Unidade móvel terrestre'],
  ['42', 'Unidade móvel de nível pré-hospitalar na área de urgência'],
  ['43', 'Farmácia'],
  ['50', 'Unidade de vigilância em saúde'],
  ['62', 'Hospital / dia - isolado'],
  ['64', 'Central de regulação de serviços de saúde'],
  ['68', 'Central de gestão em saúde'],
  ['70', 'Centro de atenção psicossocial'],
  ['71', 'Centro de apoio à saúde da família'],
  ['73', 'Pronto atendimento'],
  ['74', 'Polo academia da saúde'],
  ['75', 'Telessaúde'],
  ['77', 'Serviço de atenção domiciliar isolado (home care)'],
  ['79', 'Oficina ortopédica'],
  ['80', 'Laboratório de saúde pública'],
  ['81', 'Central de regulação do acesso'],
  ['84', 'Central de abastecimento'],
  ['85', 'Centro de imunização'],
];

export const INSTRUMENTO_REGISTRO: [string, string][] = [
  ['01', 'BPA (consolidado)'],
  ['02', 'BPA (individualizado)'],
  ['03', 'AIH (procedimento principal)'],
  ['04', 'AIH (procedimento especial)'],
  ['05', 'AIH (procedimento secundário)'],
  ['06', 'APAC (procedimento principal)'],
  ['07', 'APAC (procedimento secundário)'],
  ['08', 'RAAS (atenção domiciliar)'],
  ['09', 'RAAS (psicossocial)'],
  ['10', 'e-SUS APS'],
];

export const COMPLEXIDADE: [string, string][] = [
  ['0', 'Não se aplica'],
  ['1', 'Atenção básica'],
  ['2', 'Média complexidade'],
  ['3', 'Alta complexidade'],
];

// Caráter de atendimento (SIA/SIH).
export const CARATER_ATENDIMENTO: [string, string][] = [
  ['01', 'Eletivo'],
  ['02', 'Urgência'],
  ['03', 'Acidente no local de trabalho ou a serviço da empresa'],
  ['04', 'Acidente no trajeto para o trabalho'],
  ['05', 'Outros tipos de acidente de trânsito'],
  ['06', 'Outros tipos de lesões e envenenamentos por agentes químicos ou físicos'],
];

// Classificação de risco (Protocolo de Manchester), configurável pelo município (TR 1.2.17.24).
export const CLASSIFICACAO_RISCO: [string, string][] = [
  ['VERMELHO', 'Emergência'],
  ['LARANJA', 'Muito urgente'],
  ['AMARELO', 'Urgente'],
  ['VERDE', 'Pouco urgente'],
  ['AZUL', 'Não urgente'],
];
