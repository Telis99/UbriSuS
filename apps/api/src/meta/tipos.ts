// Metadados das entidades: uma única definição gera a tabela no banco, a API de
// cadastro/consulta/exportação e as telas genéricas da interface web.

export type TipoCampo =
  | 'texto'
  | 'texto_longo'
  | 'inteiro'
  | 'decimal'
  | 'moeda'
  | 'data'
  | 'data_hora'
  | 'hora'
  | 'booleano'
  | 'opcao'
  | 'multi_opcao'
  | 'ref'
  | 'cpf'
  | 'cnpj'
  | 'cns'
  | 'cep'
  | 'telefone'
  | 'email'
  | 'cor'
  | 'json'
  | 'arquivo'
  | 'segredo';

export interface Campo {
  nome: string;
  tipo: TipoCampo;
  rotulo: string;
  obrigatorio?: boolean;
  /** Tamanho máximo para textos, valor máximo para números. */
  max?: number;
  min?: number;
  casas?: number;
  opcoes?: [string, string][];
  /** Entidade referenciada (tipo ref). */
  ref?: string;
  /** Filtro fixo aplicado às opções da referência, ex. { ativo: true }. */
  refFiltro?: Record<string, unknown>;
  maiusculo?: boolean;
  unico?: boolean;
  /** Valor padrão (literal SQL gerado a partir do valor JS). */
  padrao?: string | number | boolean;
  /** Texto exibido ao posicionar o cursor sobre o campo (TR 1.1.2.1.23). */
  ajuda?: string;
  aba?: string;
  /** Exibido nas colunas padrão da consulta. */
  lista?: boolean;
  /** Usado na busca rápida e no autocompletar (TR 1.1.1.58). */
  busca?: boolean;
  somenteLeitura?: boolean;
  /** Não exibido na interface (preenchido por regras de negócio). */
  oculto?: boolean;
  /** Largura no formulário, em colunas de 12. */
  largura?: number;
  /** Campo calculado por SQL, somente leitura (ex.: idade). */
  sqlCalculado?: string;
  /** Exige permissão específica para visualizar (dados sensíveis). */
  permissaoLeitura?: string;
}

export interface Filho {
  entidade: string;
  campo: string;
  titulo?: string;
}

export interface Entidade {
  /** Identificador usado na API: /api/e/:nome */
  nome: string;
  /** Tabela física: esquema.tabela */
  tabela: string;
  titulo: string;
  tituloSingular: string;
  /** Módulo do Anexo V do edital (sigla). */
  modulo: string;
  /** Caminho no menu, ex.: 'Cadastros/Endereços'. */
  menu?: string;
  campos: Campo[];
  /** Campos que compõem a descrição do registro em listas e referências. */
  rotulo: string[];
  ordemPadrao?: string;
  unicos?: string[][];
  /** Itens do Termo de Referência atendidos (matriz de rastreabilidade). */
  tr?: string[];
  /** Prefixo das permissões; padrão = nome. */
  permissao?: string;
  abas?: string[];
  clonavel?: boolean;
  filhos?: Filho[];
  /** Tabela já povoada pelo sistema: inclusão/exclusão restritas. */
  somenteLeitura?: boolean;
  /** Tabela criada por migração SQL própria; o sincronizador não gera DDL. */
  ddlManual?: boolean;
  /** Campo booleano que indica situação ativa/inativa. */
  campoAtivo?: string;
  descricao?: string;
}

export type Acao = 'consultar' | 'incluir' | 'alterar' | 'excluir' | 'exportar';
export const ACOES: Acao[] = ['consultar', 'incluir', 'alterar', 'excluir', 'exportar'];
