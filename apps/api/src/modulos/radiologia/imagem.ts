// Núcleo compartilhado dos módulos de diagnóstico por imagem (Radiologia - TR 1.2.45 e Ecografia - TR 1.2.50):
// os dois módulos têm o mesmo fluxo (cadastro dos exames, modelos de laudo, recepção, execução, laudo,
// assinatura, impressão, entrega e relatórios) e diferem só no esquema, na sigla e em detalhes de execução.
import { campoAtivo, definirEntidade } from '../../meta/registro.js';
import { registrarPermissao } from '../../meta/rotas.js';
import { INSTRUMENTO_REGISTRO } from '../cadastros/opcoes.js';

export type ChaveTr = 'exame' | 'exameCbo' | 'estrutura' | 'modelo' | 'assinante' | 'cabecalho' | 'equipamento' | 'atendimento' | 'imagem';

export interface ConfigImagem {
  sigla: 'RAD' | 'ECO';
  /** Esquema do banco e prefixo das entidades/permissões (rad_exame, eco_exame...). */
  esquema: 'rad' | 'eco';
  /** Prefixo das rotas da API e das telas (/api/radiologia, /t/radiologia). */
  rota: 'radiologia' | 'ecografia';
  titulo: string;
  /** Nome genérico do exame, no singular (radiografia, ultrassonografia). */
  exame: string;
  /** Grupos/subgrupos SIGTAP importados automaticamente para o cadastro de exames. */
  grupoSigtap: string[];
  /** Registra incidências, filmes e contraste na execução (radiologia). */
  execucaoRadiologica: boolean;
  /** Título do serviço impresso no laudo quando não há cabeçalho personalizado. */
  servico: string;
  entidades: Record<ChaveTr, { tr: string[] }>;
}

export const SITUACAO_EXAME: [string, string][] = [
  ['AGENDADO', 'Agendado'],
  ['PRESENTE', 'Paciente presente'],
  ['REALIZADO', 'Exame realizado'],
  ['FALTOSO', 'Faltoso'],
  ['CANCELADO', 'Cancelado'],
];

export const SITUACAO_LAUDO: [string, string][] = [
  ['NAO_DIGITADO', 'Não digitado'],
  ['DIGITADO', 'Digitado'],
  ['ASSINADO', 'Assinado / liberado'],
  ['ANEXADO', 'Resultado anexado'],
  ['IMPRESSO', 'Impresso'],
];

export const SITUACAO_ENTREGA: [string, string][] = [
  ['PENDENTE', 'Aguardando retirada'],
  ['RETIRADO', 'Retirado'],
  ['NAO_RETIRADO', 'Não retirado'],
];

export const TAMANHO_FILME: [string, string][] = [
  ['18X24', '18 x 24 cm'],
  ['24X30', '24 x 30 cm'],
  ['30X40', '30 x 40 cm'],
  ['35X35', '35 x 35 cm'],
  ['35X43', '35 x 43 cm'],
  ['DIGITAL', 'Digital (sem filme)'],
];

export const LATERALIDADE: [string, string][] = [
  ['NA', 'Não se aplica'],
  ['DIREITO', 'Direito'],
  ['ESQUERDO', 'Esquerdo'],
  ['BILATERAL', 'Bilateral'],
];

/** Nomes das entidades, tabelas e permissões de um módulo de imagem. */
export function nomes(cfg: ConfigImagem) {
  const s = cfg.esquema;
  return {
    exame: `${s}_exame`,
    exameCbo: `${s}_exame_cbo`,
    estrutura: `${s}_estrutura`,
    modelo: `${s}_modelo_laudo`,
    assinante: `${s}_assinante`,
    cabecalho: `${s}_cabecalho`,
    equipamento: `${s}_equipamento`,
    atendimento: `${s}_atendimento`,
    imagem: `${s}_imagem`,
    permLaudo: `${s}_laudo`,
    permRecepcao: `${s}_recepcao`,
  };
}

/** Define as entidades (tabelas, API CRUD, telas e menu) de um módulo de imagem. */
export function definirEntidadesImagem(cfg: ConfigImagem) {
  const n = nomes(cfg);
  const s = cfg.esquema;
  const M = cfg.sigla;
  const menuCad = `${cfg.titulo}/Cadastros`;

  registrarPermissao(n.permRecepcao, `${cfg.titulo}: recepção, execução e faltas`, M, ['executar']);
  registrarPermissao(n.permLaudo, `${cfg.titulo}: digitação, assinatura, retificação e entrega de laudos`, M, ['digitar', 'assinar', 'retificar', 'entregar']);

  definirEntidade({
    nome: n.exame,
    tabela: `${s}.exame`,
    titulo: `Exames de ${cfg.titulo.toLowerCase()} prestados`,
    tituloSingular: `Exame de ${cfg.titulo.toLowerCase()}`,
    modulo: M,
    menu: menuCad,
    rotulo: ['nome'],
    ordemPadrao: 'nome',
    tr: cfg.entidades.exame.tr,
    abas: ['Exame', 'Regras SIGTAP', 'Execução'],
    descricao: 'Dados preenchidos a partir do procedimento SIGTAP quando não informados',
    campos: [
      { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento SIGTAP', obrigatorio: true, unico: true, lista: true, aba: 'Exame', largura: 8 },
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome do exame', max: 250, lista: true, busca: true, aba: 'Exame', largura: 12, ajuda: 'Em branco: nome do procedimento SIGTAP' },
      { nome: 'sigla', tipo: 'texto', rotulo: 'Sigla', max: 20, busca: true, aba: 'Exame' },
      { nome: 'preparo', tipo: 'texto_longo', rotulo: 'Preparo / orientações ao paciente', aba: 'Exame' },
      { nome: 'sexo', tipo: 'opcao', rotulo: 'Sexo', opcoes: [['A', 'Ambos'], ['M', 'Masculino'], ['F', 'Feminino']], padrao: 'A', lista: true, aba: 'Regras SIGTAP' },
      { nome: 'idade_minima', tipo: 'inteiro', rotulo: 'Faixa etária - idade mínima (anos)', min: 0, max: 130, aba: 'Regras SIGTAP' },
      { nome: 'idade_maxima', tipo: 'inteiro', rotulo: 'Faixa etária - idade máxima (anos)', min: 0, max: 130, aba: 'Regras SIGTAP' },
      { nome: 'instrumentos', tipo: 'multi_opcao', rotulo: 'Instrumentos de registro', opcoes: INSTRUMENTO_REGISTRO, aba: 'Regras SIGTAP', largura: 12 },
      { nome: 'habilitacoes', tipo: 'texto', rotulo: 'Habilitações exigidas', max: 250, aba: 'Regras SIGTAP', largura: 12, ajuda: 'Códigos/descrições das habilitações SIGTAP exigidas do prestador' },
      { nome: 'valor', tipo: 'moeda', rotulo: 'Valor (R$)', lista: true, aba: 'Regras SIGTAP', ajuda: 'Em branco: valor diferenciado municipal ou valor SA do SIGTAP' },
      { nome: 'tempo_minutos', tipo: 'inteiro', rotulo: 'Tempo médio de execução (min)', aba: 'Execução' },
      ...(cfg.execucaoRadiologica
        ? [
            { nome: 'incidencias_padrao', tipo: 'texto' as const, rotulo: 'Incidências padrão', max: 120, aba: 'Execução', ajuda: 'Ex.: PA e perfil' },
            { nome: 'filmes_padrao', tipo: 'inteiro' as const, rotulo: 'Quantidade padrão de filmes', min: 0, aba: 'Execução' },
            { nome: 'filme_tamanho_padrao', tipo: 'opcao' as const, rotulo: 'Tamanho padrão do filme', opcoes: TAMANHO_FILME, aba: 'Execução' },
            { nome: 'contraste', tipo: 'booleano' as const, rotulo: 'Exame contrastado', padrao: false, aba: 'Execução' },
          ]
        : []),
      campoAtivo,
    ],
    filhos: [{ entidade: n.exameCbo, campo: 'exame_id', titulo: 'CBOs habilitados' }],
  });

  definirEntidade({
    nome: n.exameCbo,
    tabela: `${s}.exame_cbo`,
    titulo: 'CBOs do exame',
    tituloSingular: 'CBO do exame',
    modulo: M,
    permissao: n.exame,
    rotulo: ['cbo_id'],
    unicos: [['exame_id', 'cbo_id']],
    tr: cfg.entidades.exameCbo.tr,
    campos: [
      { nome: 'exame_id', tipo: 'ref', ref: n.exame, rotulo: 'Exame', obrigatorio: true },
      { nome: 'cbo_id', tipo: 'ref', ref: 'cbo', rotulo: 'CBO', obrigatorio: true, lista: true },
    ],
  });

  definirEntidade({
    nome: n.estrutura,
    tabela: `${s}.estrutura`,
    titulo: 'Estruturas e órgãos a examinar',
    tituloSingular: 'Estrutura / órgão',
    modulo: M,
    menu: menuCad,
    rotulo: ['nome'],
    ordemPadrao: 'nome',
    tr: cfg.entidades.estrutura.tr,
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Estrutura / órgão', max: 120, obrigatorio: true, lista: true, busca: true, largura: 8 },
      { nome: 'exame_id', tipo: 'ref', ref: n.exame, rotulo: 'Somente para o exame', lista: true, ajuda: 'Em branco: disponível para todos os exames' },
      { nome: 'exige_lateralidade', tipo: 'booleano', rotulo: 'Exige lateralidade (direito/esquerdo)', padrao: false, lista: true },
      campoAtivo,
    ],
  });

  definirEntidade({
    nome: n.modelo,
    tabela: `${s}.modelo_laudo`,
    titulo: 'Modelos de resultado (laudo)',
    tituloSingular: 'Modelo de resultado',
    modulo: M,
    menu: menuCad,
    rotulo: ['nome'],
    ordemPadrao: 'nome',
    clonavel: true,
    tr: cfg.entidades.modelo.tr,
    descricao: 'Variáveis: {paciente} {idade} {sexo} {data} {exame} {estrutura} {lateralidade} {solicitante} {requisicao} {unidade}',
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome do modelo', max: 120, obrigatorio: true, lista: true, busca: true, largura: 8 },
      { nome: 'exame_id', tipo: 'ref', ref: n.exame, rotulo: 'Exame', lista: true, ajuda: 'Em branco: modelo disponível para todos os exames' },
      { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Modelo pessoal do profissional', lista: true, ajuda: 'Em branco: modelo disponível a todos os laudistas' },
      {
        nome: 'texto',
        tipo: 'texto_longo',
        rotulo: 'Texto do resultado',
        obrigatorio: true,
        largura: 12,
        ajuda: 'Texto livre totalmente personalizável. Variáveis: {paciente} {idade} {sexo} {data} {exame} {estrutura} {lateralidade} {solicitante} {requisicao} {unidade}',
      },
      { nome: 'conclusao', tipo: 'texto_longo', rotulo: 'Conclusão / impressão diagnóstica padrão', largura: 12 },
      { nome: 'padrao', tipo: 'booleano', rotulo: 'Modelo padrão do exame (aplicado automaticamente)', padrao: false, lista: true },
      campoAtivo,
    ],
  });

  definirEntidade({
    nome: n.assinante,
    tabela: `${s}.assinante`,
    titulo: 'Profissionais que assinam os resultados',
    tituloSingular: 'Profissional assinante',
    modulo: M,
    menu: menuCad,
    rotulo: ['profissional_id'],
    tr: cfg.entidades.assinante.tr,
    campos: [
      { nome: 'profissional_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional', obrigatorio: true, lista: true, largura: 8 },
      { nome: 'exame_id', tipo: 'ref', ref: n.exame, rotulo: 'Somente o exame', lista: true, ajuda: 'Em branco: assina todos os exames do módulo' },
      { nome: 'titulo', tipo: 'texto', rotulo: 'Título impresso sob a assinatura', max: 80, ajuda: 'Ex.: Médico radiologista' },
      {
        nome: 'assinatura_grafica_id',
        tipo: 'arquivo',
        rotulo: 'Assinatura gráfica (imagem PNG/JPEG)',
        ajuda: 'Em branco: usa a assinatura gráfica do cadastro do profissional. Permite liberar o laudo a distância.',
      },
      campoAtivo,
    ],
  });

  definirEntidade({
    nome: n.cabecalho,
    tabela: `${s}.cabecalho`,
    titulo: 'Cabeçalhos do resultado',
    tituloSingular: 'Cabeçalho do resultado',
    modulo: M,
    menu: menuCad,
    rotulo: ['titulo'],
    tr: cfg.entidades.cabecalho.tr,
    descricao: 'Cabeçalho impresso no resultado conforme a unidade do prestador ou do solicitante',
    campos: [
      { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade', unico: true, lista: true, ajuda: 'Em branco: cabeçalho padrão' },
      { nome: 'titulo', tipo: 'texto', rotulo: 'Título (ex.: Serviço de Diagnóstico por Imagem)', max: 120, obrigatorio: true, lista: true, largura: 8 },
      { nome: 'linhas', tipo: 'texto_longo', rotulo: 'Linhas adicionais (endereço, telefone, responsável técnico)', largura: 12 },
      { nome: 'logo_id', tipo: 'arquivo', rotulo: 'Logotipo (PNG/JPEG)' },
      campoAtivo,
    ],
  });

  definirEntidade({
    nome: n.equipamento,
    tabela: `${s}.equipamento`,
    titulo: 'Salas e equipamentos',
    tituloSingular: 'Sala / equipamento',
    modulo: M,
    menu: menuCad,
    rotulo: ['nome'],
    ordemPadrao: 'nome',
    tr: cfg.entidades.equipamento.tr,
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Equipamento', max: 120, obrigatorio: true, lista: true, busca: true, largura: 8 },
      { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade prestadora', lista: true },
      { nome: 'sala', tipo: 'texto', rotulo: 'Sala', max: 60, lista: true },
      { nome: 'patrimonio', tipo: 'texto', rotulo: 'Patrimônio / nº de série', max: 40 },
      campoAtivo,
    ],
  });

  definirEntidade({
    nome: n.atendimento,
    tabela: `${s}.atendimento`,
    titulo: `Exames de ${cfg.titulo.toLowerCase()} (recepção e laudos)`,
    tituloSingular: `Exame de ${cfg.titulo.toLowerCase()}`,
    modulo: M,
    menu: `${cfg.titulo}/Consultas`,
    rotulo: ['data', 'paciente_id', 'exame_id'],
    ordemPadrao: 'data desc, hora',
    tr: cfg.entidades.atendimento.tr,
    abas: ['Exame', 'Execução', 'Laudo', 'Entrega'],
    campos: [
      { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true, lista: true, aba: 'Exame' },
      { nome: 'hora', tipo: 'hora', rotulo: 'Hora', lista: true, aba: 'Exame' },
      { nome: 'paciente_id', tipo: 'ref', ref: 'paciente', rotulo: 'Paciente', obrigatorio: true, lista: true, aba: 'Exame' },
      { nome: 'exame_id', tipo: 'ref', ref: n.exame, rotulo: 'Exame', obrigatorio: true, lista: true, aba: 'Exame' },
      { nome: 'procedimento_id', tipo: 'ref', ref: 'procedimento', rotulo: 'Procedimento SIGTAP', somenteLeitura: true, aba: 'Exame' },
      { nome: 'estrutura', tipo: 'texto', rotulo: 'Estrutura / órgão a examinar', max: 120, lista: true, aba: 'Exame' },
      { nome: 'lateralidade', tipo: 'opcao', rotulo: 'Lateralidade', opcoes: LATERALIDADE, padrao: 'NA', aba: 'Exame' },
      { nome: 'unidade_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade prestadora', lista: true, aba: 'Exame' },
      { nome: 'unidade_solicitante_id', tipo: 'ref', ref: 'unidade', rotulo: 'Unidade solicitante', aba: 'Exame' },
      { nome: 'profissional_solicitante_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional solicitante', aba: 'Exame' },
      { nome: 'requisicao', tipo: 'texto', rotulo: 'Número da requisição', max: 20, lista: true, busca: true, aba: 'Exame' },
      { nome: 'solicitacao_id', tipo: 'ref', ref: 'solicitacao_exame', rotulo: 'Requisição', oculto: true },
      { nome: 'solicitacao_item_id', tipo: 'ref', ref: 'solicitacao_exame_item', rotulo: 'Item da requisição', oculto: true },
      { nome: 'agendamento_id', tipo: 'ref', ref: 'agendamento', rotulo: 'Agendamento', somenteLeitura: true, aba: 'Exame' },
      { nome: 'agendamento_procedimento_id', tipo: 'ref', ref: 'agendamento_procedimento', rotulo: 'Procedimento agendado', unico: true, oculto: true },
      { nome: 'convenio_id', tipo: 'ref', ref: 'convenio', rotulo: 'Convênio', aba: 'Exame' },
      { nome: 'urgente', tipo: 'booleano', rotulo: 'Urgência', padrao: false, aba: 'Exame' },
      { nome: 'situacao', tipo: 'opcao', rotulo: 'Situação do exame', opcoes: SITUACAO_EXAME, padrao: 'AGENDADO', lista: true, somenteLeitura: true, aba: 'Exame' },
      { nome: 'chegada_em', tipo: 'data_hora', rotulo: 'Chegada do paciente', somenteLeitura: true, aba: 'Execução' },
      { nome: 'executado_em', tipo: 'data_hora', rotulo: 'Executado em', somenteLeitura: true, aba: 'Execução' },
      { nome: 'tecnico_id', tipo: 'ref', ref: 'profissional', rotulo: 'Profissional executante', aba: 'Execução' },
      { nome: 'equipamento_id', tipo: 'ref', ref: n.equipamento, rotulo: 'Sala / equipamento', aba: 'Execução' },
      ...(cfg.execucaoRadiologica
        ? [
            { nome: 'incidencias', tipo: 'texto' as const, rotulo: 'Incidências realizadas', max: 120, aba: 'Execução' },
            { nome: 'filmes_quantidade', tipo: 'inteiro' as const, rotulo: 'Filmes utilizados', min: 0, aba: 'Execução' },
            { nome: 'filme_tamanho', tipo: 'opcao' as const, rotulo: 'Tamanho do filme', opcoes: TAMANHO_FILME, aba: 'Execução' },
            { nome: 'filmes_perdidos', tipo: 'inteiro' as const, rotulo: 'Filmes perdidos / repetições', min: 0, padrao: 0, aba: 'Execução' },
            { nome: 'contraste', tipo: 'booleano' as const, rotulo: 'Utilizou contraste', padrao: false, aba: 'Execução' },
            { nome: 'contraste_descricao', tipo: 'texto' as const, rotulo: 'Contraste (produto/volume)', max: 120, aba: 'Execução' },
          ]
        : []),
      { nome: 'observacao_execucao', tipo: 'texto_longo', rotulo: 'Observações da execução', aba: 'Execução' },
      { nome: 'falta_motivo', tipo: 'texto', rotulo: 'Motivo da falta', max: 250, aba: 'Execução' },
      { nome: 'falta_registrada_em', tipo: 'data_hora', rotulo: 'Falta registrada em', somenteLeitura: true, aba: 'Execução' },
      { nome: 'situacao_laudo', tipo: 'opcao', rotulo: 'Status do laudo', opcoes: SITUACAO_LAUDO, padrao: 'NAO_DIGITADO', lista: true, somenteLeitura: true, aba: 'Laudo' },
      { nome: 'modelo_id', tipo: 'ref', ref: n.modelo, rotulo: 'Modelo utilizado', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'laudo_texto', tipo: 'texto_longo', rotulo: 'Resultado', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'conclusao', tipo: 'texto_longo', rotulo: 'Conclusão', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'laudista_id', tipo: 'ref', ref: 'profissional', rotulo: 'Laudista', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'digitado_em', tipo: 'data_hora', rotulo: 'Digitado em', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'digitado_por', tipo: 'ref', ref: 'operador', rotulo: 'Digitado por', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'assinante_id', tipo: 'ref', ref: 'profissional', rotulo: 'Assinado por', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'assinado_em', tipo: 'data_hora', rotulo: 'Assinado em', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'assinatura_grafica_id', tipo: 'arquivo', rotulo: 'Assinatura gráfica aplicada', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'resultado_arquivo_id', tipo: 'arquivo', rotulo: 'Resultado anexado', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'anexado_em', tipo: 'data_hora', rotulo: 'Anexado em', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'laudo_arquivo_id', tipo: 'arquivo', rotulo: 'Laudo emitido (PDF)', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'codigo_validacao', tipo: 'texto', rotulo: 'Código de validação', max: 40, somenteLeitura: true, aba: 'Laudo' },
      { nome: 'impresso_em', tipo: 'data_hora', rotulo: 'Impresso em', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'impressoes', tipo: 'inteiro', rotulo: 'Impressões', padrao: 0, somenteLeitura: true, aba: 'Laudo' },
      { nome: 'envelope_em', tipo: 'data_hora', rotulo: 'Envelope impresso em', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'retificacoes', tipo: 'json', rotulo: 'Retificações', somenteLeitura: true, aba: 'Laudo' },
      { nome: 'situacao_entrega', tipo: 'opcao', rotulo: 'Entrega do resultado', opcoes: SITUACAO_ENTREGA, padrao: 'PENDENTE', lista: true, somenteLeitura: true, aba: 'Entrega' },
      { nome: 'retirado_em', tipo: 'data_hora', rotulo: 'Retirado em', somenteLeitura: true, aba: 'Entrega' },
      { nome: 'retirado_por', tipo: 'texto', rotulo: 'Retirado por', max: 120, somenteLeitura: true, aba: 'Entrega' },
      { nome: 'documento_retirada', tipo: 'texto', rotulo: 'Documento de quem retirou', max: 40, somenteLeitura: true, aba: 'Entrega' },
      { nome: 'entrega_operador_id', tipo: 'ref', ref: 'operador', rotulo: 'Entregue por', somenteLeitura: true, aba: 'Entrega' },
      { nome: 'nao_retirado_motivo', tipo: 'texto', rotulo: 'Motivo / observação (não retirado)', max: 250, somenteLeitura: true, aba: 'Entrega' },
      { nome: 'producao_id', tipo: 'inteiro', rotulo: 'Produção (BPA)', oculto: true },
    ],
    filhos: [{ entidade: n.imagem, campo: 'atendimento_id', titulo: 'Imagens digitalizadas' }],
  });

  definirEntidade({
    nome: n.imagem,
    tabela: `${s}.imagem`,
    titulo: 'Imagens digitalizadas do exame',
    tituloSingular: 'Imagem digitalizada',
    modulo: M,
    permissao: n.atendimento,
    rotulo: ['descricao'],
    tr: cfg.entidades.imagem.tr,
    campos: [
      { nome: 'atendimento_id', tipo: 'ref', ref: n.atendimento, rotulo: 'Exame', obrigatorio: true },
      { nome: 'arquivo_id', tipo: 'arquivo', rotulo: 'Imagem', obrigatorio: true, lista: true },
      { nome: 'descricao', tipo: 'texto', rotulo: 'Descrição', max: 120, lista: true },
      { nome: 'incluir_laudo', tipo: 'booleano', rotulo: 'Imprimir no laudo', padrao: true, lista: true },
    ],
  });
}
