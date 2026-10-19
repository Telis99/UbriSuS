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
  max?: number;
  min?: number;
  casas?: number;
  opcoes?: [string, string][];
  ref?: string;
  refFiltro?: Record<string, unknown>;
  maiusculo?: boolean;
  unico?: boolean;
  padrao?: string | number | boolean;
  ajuda?: string;
  aba?: string;
  lista?: boolean;
  busca?: boolean;
  somenteLeitura?: boolean;
  oculto?: boolean;
  largura?: number;
  calculado?: boolean;
}

export interface Meta {
  nome: string;
  titulo: string;
  tituloSingular: string;
  modulo: string;
  menu?: string;
  rotulo: string[];
  ordemPadrao?: string;
  abas?: string[];
  clonavel?: boolean;
  filhos?: { entidade: string; campo: string; titulo?: string }[];
  somenteLeitura?: boolean;
  descricao?: string;
  tr?: string[];
  campos: Campo[];
  acoes: Record<'consultar' | 'incluir' | 'alterar' | 'excluir' | 'exportar', boolean>;
}

export interface Eu {
  id: number;
  nome: string;
  login: string;
  email: string | null;
  administrador: boolean;
  encarregadoDados: boolean;
  permissoes: string[];
  modulos: string[] | null;
  unidades: { id: number; nome: string }[];
  unidadeAtual: number | null;
  profissionalId: number | null;
  gruposProfissionais: string[];
  precisaTrocarSenha: boolean;
  precisaAceitarTermos: boolean;
  termosUso?: string | null;
}

export interface Alerta {
  tipo: string;
  nivel: 'info' | 'aviso' | 'perigo';
  mensagem: string;
  bloqueante?: boolean;
  dados?: any;
}

export const OPCOES_FORMATO: { valor: string; rotulo: string }[] = [
  { valor: 'pdf', rotulo: 'PDF (.pdf)' },
  { valor: 'xlsx', rotulo: 'Excel (.xlsx)' },
  { valor: 'xls', rotulo: 'Excel 97-2003 (.xls)' },
  { valor: 'docx', rotulo: 'Word (.docx)' },
  { valor: 'doc', rotulo: 'Word 97-2003 (.doc)' },
  { valor: 'csv', rotulo: 'CSV (.csv)' },
  { valor: 'xml', rotulo: 'XML (.xml)' },
  { valor: 'html', rotulo: 'HTML (.html)' },
  { valor: 'txt', rotulo: 'Texto (.txt)' },
];
