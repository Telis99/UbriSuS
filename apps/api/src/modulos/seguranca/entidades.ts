// Operadores, perfis, grupos e restrições de acesso (TR 1.1.1.29 a 1.1.1.36, 1.1.2.1.35 a 1.1.2.1.54).
import { campoAtivo, campoNome, definirEntidade } from '../../meta/registro.js';
import { DIAS_SEMANA } from '../cadastros/opcoes.js';

const TEC = 'TEC';

export const MODULOS_SISTEMA: [string, string][] = [
  ['AGE', 'Agendamento e cadastros gerais'],
  ['FAT', 'Faturamento'],
  ['AMB', 'Ambulatório'],
  ['FAR', 'Farmácia'],
  ['PEP', 'Prontuário médico'],
  ['ODO', 'Prontuário odontológico'],
  ['TFD', 'Tratamento fora do domicílio'],
  ['ESUS', 'e-SUS AB (Atenção Primária)'],
  ['AIH', 'AIH'],
  ['IMU', 'Imunização'],
  ['TRA', 'Transporte sanitário'],
  ['APP', 'Atendimento remoto'],
  ['UPA', 'UPA'],
  ['REG', 'Regulação'],
  ['RAAS', 'RAAS'],
  ['RAD', 'Radiologia'],
  ['CAPS', 'Saúde mental (CAPS)'],
  ['LAB', 'Laboratório'],
  ['INT', 'Interfaceamento'],
  ['ACS', 'Acesso ACS'],
  ['ECO', 'Ecografia'],
  ['IND', 'Indicadores de gestão'],
  ['TEC', 'Administração do sistema'],
];

definirEntidade({
  nome: 'perfil',
  tabela: 'seg.perfil',
  titulo: 'Perfis de acesso',
  tituloSingular: 'Perfil de acesso',
  modulo: TEC,
  menu: 'Administração/Segurança',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.1.1.29.1', '1.1.1.29.2', '1.1.2.1.37', '1.1.2.1.41'],
  clonavel: true,
  campos: [
    campoNome(60),
    { nome: 'descricao', tipo: 'texto', rotulo: 'Descrição', max: 200, lista: true },
    {
      nome: 'categoria',
      tipo: 'opcao',
      rotulo: 'Categoria',
      lista: true,
      opcoes: [
        ['OPERACIONAL', 'Operacional'],
        ['GERENCIAL', 'Gerencial'],
        ['CONSULTA', 'Consulta'],
        ['ADMINISTRADOR', 'Administrador'],
        ['PERSONALIZADO', 'Personalizado'],
      ],
    },
    {
      nome: 'grupo_profissional',
      tipo: 'opcao',
      rotulo: 'Grupo profissional',
      ajuda: 'Usado para direcionar avisos e controlar acesso por categoria profissional',
      opcoes: [
        ['RECEPCAO', 'Recepção / agendamento'],
        ['MEDICOS', 'Médicos'],
        ['ENFERMAGEM', 'Enfermagem'],
        ['FARMACIA', 'Farmácia'],
        ['ODONTOLOGIA', 'Odontologia'],
        ['MULTIPROFISSIONAL', 'Multiprofissional'],
        ['GESTAO', 'Gestão'],
        ['ACS', 'Agente comunitário de saúde'],
      ],
    },
    { nome: 'permissoes', tipo: 'json', rotulo: 'Permissões', oculto: true },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'operador',
  tabela: 'seg.operador',
  titulo: 'Operadores',
  tituloSingular: 'Operador',
  modulo: TEC,
  menu: 'Administração/Segurança',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: [
    '1.1.1.29', '1.1.1.29.5', '1.1.1.31', '1.1.1.32.1', '1.1.1.32.3', '1.1.1.34', '1.1.2.1.51', '1.1.2.1.53', '1.1.2.1.54',
    '1.1.1.33.3',
  ],
  abas: ['Identificação', 'Acesso', 'Restrições'],
  campos: [
    { nome: 'pessoa_id', tipo: 'ref', ref: 'paciente', rotulo: 'Pessoa (cadastro único)', obrigatorio: true, unico: true, aba: 'Identificação', ajuda: 'O operador é sempre uma pessoa única do cadastro; nome e e-mail vêm da pessoa (TR 1.1.2.1.51)' },
    { nome: 'nome', tipo: 'texto', rotulo: 'Nome', max: 70, lista: true, busca: true, somenteLeitura: true, aba: 'Identificação' },
    { nome: 'login', tipo: 'texto', rotulo: 'Login (CPF)', max: 11, unico: true, obrigatorio: true, lista: true, busca: true, aba: 'Identificação' },
    { nome: 'email', tipo: 'email', rotulo: 'E-mail de contato', somenteLeitura: true, aba: 'Identificação' },
    { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional de saúde vinculado', aba: 'Identificação' },
    { nome: 'administrador', tipo: 'booleano', rotulo: 'Administrador do sistema', padrao: false, lista: true, aba: 'Acesso' },
    { nome: 'oficial_protecao_dados', tipo: 'booleano', rotulo: 'Encarregado de proteção de dados (LGPD)', padrao: false, aba: 'Acesso', ajuda: 'Único que pode gerar o relatório de dados pessoais tratados (TR 1.1.1.65.1.1)' },
    { nome: 'senha_hash', tipo: 'segredo', rotulo: 'Senha', oculto: true },
    { nome: 'senha_alterada_em', tipo: 'data_hora', rotulo: 'Senha alterada em', somenteLeitura: true, aba: 'Acesso' },
    { nome: 'senha_expirada', tipo: 'booleano', rotulo: 'Senha expirada (exigir troca no próximo login)', padrao: false, aba: 'Acesso' },
    { nome: 'senha_validade_dias', tipo: 'inteiro', rotulo: 'Senha expira após (dias)', aba: 'Acesso' },
    { nome: 'senha_validade_data', tipo: 'data', rotulo: 'Senha expira em (data fixa)', aba: 'Acesso' },
    { nome: 'tentativas_invalidas', tipo: 'inteiro', rotulo: 'Tentativas inválidas', padrao: 0, somenteLeitura: true, aba: 'Acesso' },
    { nome: 'bloqueado', tipo: 'booleano', rotulo: 'Bloqueado', padrao: false, lista: true, aba: 'Acesso' },
    {
      nome: 'metodos_login',
      tipo: 'multi_opcao',
      rotulo: 'Formas de login permitidas',
      aba: 'Acesso',
      opcoes: [
        ['SENHA', 'CPF e senha'],
        ['CERTIFICADO', 'Certificado e-CPF / e-CNPJ'],
        ['GOVBR', 'Conta gov.br'],
        ['BIOMETRIA', 'Biometria'],
      ],
    },
    { nome: 'termos_aceitos_em', tipo: 'data_hora', rotulo: 'Termos de uso aceitos em', somenteLeitura: true, aba: 'Acesso' },
    { nome: 'horario_inicio', tipo: 'hora', rotulo: 'Horário de trabalho - início', aba: 'Restrições', ajuda: 'Fora do horário o registro de atendimento é bloqueado (TR 1.1.1.32.1)' },
    { nome: 'horario_fim', tipo: 'hora', rotulo: 'Horário de trabalho - fim', aba: 'Restrições' },
    { nome: 'dias_trabalho', tipo: 'multi_opcao', rotulo: 'Dias de trabalho', opcoes: DIAS_SEMANA, aba: 'Restrições' },
    { nome: 'validar_vinculo', tipo: 'booleano', rotulo: 'Validar contrato ativo e férias no login', padrao: true, aba: 'Restrições' },
    { nome: 'modulos', tipo: 'multi_opcao', rotulo: 'Módulos liberados', opcoes: MODULOS_SISTEMA, aba: 'Restrições', ajuda: 'Vazio = todos os módulos dos perfis (TR 1.1.1.34)' },
    { nome: 'acesso_ate', tipo: 'data_hora', rotulo: 'Acesso temporário até', aba: 'Restrições', ajuda: 'TR 1.1.1.33.3' },
    { nome: 'unidade_padrao_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade padrão', aba: 'Restrições' },
    campoAtivo,
  ],
  filhos: [
    { entidade: 'operador_perfil', campo: 'operador_id', titulo: 'Perfis' },
    { entidade: 'operador_unidade', campo: 'operador_id', titulo: 'Unidades autorizadas' },
    { entidade: 'operador_grupo', campo: 'operador_id', titulo: 'Grupos' },
  ],
});

definirEntidade({
  nome: 'operador_perfil',
  tabela: 'seg.operador_perfil',
  titulo: 'Perfis do operador',
  tituloSingular: 'Perfil do operador',
  modulo: TEC,
  permissao: 'operador',
  rotulo: ['perfil_id'],
  unicos: [['operador_id', 'perfil_id']],
  campos: [
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Operador', obrigatorio: true },
    { nome: 'perfil_id', tipo: 'ref', ref: 'perfil', rotulo: 'Perfil', obrigatorio: true, lista: true },
  ],
});

definirEntidade({
  nome: 'operador_unidade',
  tabela: 'seg.operador_unidade',
  titulo: 'Unidades do operador',
  tituloSingular: 'Unidade do operador',
  modulo: TEC,
  permissao: 'operador',
  rotulo: ['unidade_id'],
  unicos: [['operador_id', 'unidade_id']],
  campos: [
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Operador', obrigatorio: true },
    { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', obrigatorio: true, lista: true },
  ],
});

definirEntidade({
  nome: 'grupo_operador',
  tabela: 'seg.grupo_operador',
  titulo: 'Grupos de operadores',
  tituloSingular: 'Grupo de operadores',
  modulo: TEC,
  menu: 'Administração/Segurança',
  rotulo: ['nome'],
  ordemPadrao: 'nome',
  tr: ['1.1.2.1.52'],
  campos: [campoNome(60), { nome: 'descricao', tipo: 'texto', rotulo: 'Descrição', max: 200, lista: true }, campoAtivo],
});

definirEntidade({
  nome: 'operador_grupo',
  tabela: 'seg.operador_grupo',
  titulo: 'Grupos do operador',
  tituloSingular: 'Grupo do operador',
  modulo: TEC,
  permissao: 'operador',
  rotulo: ['grupo_id'],
  unicos: [['operador_id', 'grupo_id']],
  campos: [
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Operador', obrigatorio: true },
    { nome: 'grupo_id', tipo: 'ref', ref: 'grupo_operador', rotulo: 'Grupo', obrigatorio: true, lista: true },
  ],
});

// Restrições de acesso a formulários (TR 1.1.1.33).
definirEntidade({
  nome: 'restricao_formulario',
  tabela: 'seg.restricao_formulario',
  titulo: 'Restrições de acesso a formulários',
  tituloSingular: 'Restrição de formulário',
  modulo: TEC,
  menu: 'Administração/Segurança',
  rotulo: ['rotina'],
  ordemPadrao: 'rotina',
  tr: ['1.1.1.33', '1.1.1.33.1', '1.1.1.33.2'],
  campos: [
    { nome: 'rotina', tipo: 'texto', rotulo: 'Rotina / formulário', max: 80, obrigatorio: true, unico: true, lista: true, busca: true },
    { nome: 'exige_justificativa_impressao', tipo: 'booleano', rotulo: 'Exigir justificativa para impressão ou extração em PDF', padrao: false, lista: true },
    { nome: 'exige_supervisor', tipo: 'booleano', rotulo: 'Exigir liberação de supervisor', padrao: false, lista: true },
    { nome: 'perfil_supervisor_id', tipo: 'ref', ref: 'perfil', rotulo: 'Perfil do supervisor' },
    campoAtivo,
  ],
});

// Repositório de certificados digitais (TR 1.1.1.44 a 1.1.1.48).
definirEntidade({
  nome: 'certificado',
  tabela: 'seg.certificado',
  titulo: 'Repositório de certificados digitais',
  tituloSingular: 'Certificado digital',
  modulo: TEC,
  menu: 'Administração/Assinatura digital',
  rotulo: ['titular'],
  ordemPadrao: 'validade_fim',
  tr: ['1.1.1.44', '1.1.1.45', '1.1.1.46', '1.1.1.48', '1.1.1.56.4'],
  campos: [
    { nome: 'titular', tipo: 'texto', rotulo: 'Titular', max: 150, lista: true, busca: true, somenteLeitura: true },
    {
      nome: 'tipo',
      tipo: 'opcao',
      rotulo: 'Tipo',
      lista: true,
      opcoes: [
        ['A1_OPERADOR', 'A1 do operador (ICP-Brasil)'],
        ['A1_ENTIDADE', 'A1 da contratante (uso compartilhado)'],
        ['AVANCADA', 'Assinatura avançada emitida pelo sistema'],
      ],
    },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Operador proprietário', lista: true },
    { nome: 'documento_titular', tipo: 'texto', rotulo: 'CPF/CNPJ do titular', max: 14, somenteLeitura: true },
    { nome: 'emissor', tipo: 'texto', rotulo: 'Emissor', max: 200, somenteLeitura: true },
    { nome: 'numero_serie', tipo: 'texto', rotulo: 'Número de série', max: 80, somenteLeitura: true },
    { nome: 'validade_inicio', tipo: 'data_hora', rotulo: 'Válido a partir de', somenteLeitura: true },
    { nome: 'validade_fim', tipo: 'data_hora', rotulo: 'Válido até', lista: true, somenteLeitura: true },
    { nome: 'conteudo_cifrado', tipo: 'segredo', rotulo: 'Conteúdo (cifrado)', oculto: true },
    { nome: 'carimbo_id', tipo: 'arquivo', rotulo: 'Carimbo de assinatura (imagem)', ajuda: 'Inserido no PDF no momento da assinatura (TR 1.1.1.56.1)' },
    campoAtivo,
  ],
});

definirEntidade({
  nome: 'certificado_autorizado',
  tabela: 'seg.certificado_autorizado',
  titulo: 'Operadores autorizados a usar certificado da entidade',
  tituloSingular: 'Autorização de certificado',
  modulo: TEC,
  permissao: 'certificado',
  rotulo: ['operador_id'],
  unicos: [['certificado_id', 'operador_id']],
  tr: ['1.1.1.46', '1.1.1.57.8'],
  campos: [
    { nome: 'certificado_id', tipo: 'ref', ref: 'certificado', rotulo: 'Certificado', obrigatorio: true },
    { nome: 'operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Operador', obrigatorio: true, lista: true },
  ],
});
