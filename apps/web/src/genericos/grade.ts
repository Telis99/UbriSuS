// Integração do AG Grid com a API: tradução dos filtros e textos em português.
import type { Campo } from '@/tipos';

const MAPA_OPERADORES: Record<string, string> = {
  contains: 'contem',
  notContains: 'nao_contem',
  equals: 'igual',
  notEqual: 'diferente',
  startsWith: 'inicia',
  endsWith: 'termina',
  lessThan: 'menor',
  greaterThan: 'maior',
  lessThanOrEqual: 'menor_igual',
  greaterThanOrEqual: 'maior_igual',
  inRange: 'entre',
  blank: 'vazio',
  notBlank: 'preenchido',
};

export interface FiltroApi {
  campo: string;
  op: string;
  valor?: unknown;
  valor2?: unknown;
}

function condicao(campo: string, m: any, tipoCampo?: string): FiltroApi | null {
  const op = MAPA_OPERADORES[m.type];
  if (!op) return null;
  if (m.filterType === 'date') {
    return { campo, op, valor: m.dateFrom?.slice(0, 10), valor2: m.dateTo?.slice(0, 10) };
  }
  let valor = m.filter;
  if (tipoCampo === 'booleano' && typeof valor === 'string') valor = /^(s|sim|true|1)/i.test(valor.trim());
  return { campo, op, valor, valor2: m.filterTo };
}

/** Converte o filterModel do AG Grid nos filtros da API (condições combinadas com E). */
export function filtrosDaGrade(modelo: Record<string, any>, campos: Campo[]): FiltroApi[] {
  const filtros: FiltroApi[] = [];
  for (const [col, m] of Object.entries(modelo ?? {})) {
    const tipo = campos.find((c) => c.nome === col)?.tipo;
    if (m.conditions) {
      for (const c of m.conditions) {
        const f = condicao(col, c, tipo);
        if (f) filtros.push(f);
      }
    } else {
      const f = condicao(col, m, tipo);
      if (f) filtros.push(f);
    }
  }
  return filtros;
}

/** Descrição legível dos filtros aplicados, impressa nos relatórios (TR 1.1.1.64.1.4.3). */
export function descreverFiltros(filtros: FiltroApi[], campos: Campo[], q?: string): string[] {
  const nomes: Record<string, string> = {
    contem: 'contém',
    nao_contem: 'não contém',
    igual: 'igual a',
    diferente: 'diferente de',
    inicia: 'inicia com',
    termina: 'termina com',
    menor: 'menor que',
    maior: 'maior que',
    menor_igual: 'até',
    maior_igual: 'a partir de',
    entre: 'entre',
    vazio: 'vazio',
    preenchido: 'preenchido',
  };
  const out = filtros.map((f) => {
    const rot = campos.find((c) => c.nome === f.campo)?.rotulo ?? f.campo;
    return `${rot} ${nomes[f.op] ?? f.op}${f.valor !== undefined ? ' ' + String(f.valor) : ''}${f.valor2 ? ' e ' + String(f.valor2) : ''}`;
  });
  if (q) out.unshift(`Pesquisa: ${q}`);
  return out;
}

export const OPCOES_TEXTO = ['contains', 'notContains', 'equals', 'notEqual', 'startsWith', 'endsWith', 'blank', 'notBlank'];
export const OPCOES_NUMERO = ['equals', 'notEqual', 'lessThan', 'greaterThan', 'lessThanOrEqual', 'greaterThanOrEqual', 'inRange', 'blank', 'notBlank'];

export const TEXTOS_GRADE: Record<string, string> = {
  selectAll: '(Selecionar tudo)',
  searchOoo: 'Pesquisar...',
  blanks: '(Vazio)',
  noMatches: 'Nenhum resultado',
  filterOoo: 'Filtrar...',
  equals: 'Igual a',
  notEqual: 'Diferente de',
  blank: 'Vazio',
  notBlank: 'Preenchido',
  empty: 'Escolha uma opção',
  lessThan: 'Menor que',
  greaterThan: 'Maior que',
  lessThanOrEqual: 'Menor ou igual a',
  greaterThanOrEqual: 'Maior ou igual a',
  inRange: 'Entre',
  inRangeStart: 'De',
  inRangeEnd: 'Até',
  contains: 'Contém',
  notContains: 'Não contém',
  startsWith: 'Inicia com',
  endsWith: 'Termina com',
  dateFormatOoo: 'dd/mm/aaaa',
  andCondition: 'E',
  orCondition: 'OU',
  applyFilter: 'Aplicar',
  resetFilter: 'Limpar',
  clearFilter: 'Limpar',
  cancelFilter: 'Cancelar',
  textFilter: 'Filtro de texto',
  numberFilter: 'Filtro numérico',
  dateFilter: 'Filtro de data',
  loadingOoo: 'Carregando...',
  loadingError: 'Erro ao carregar',
  noRowsToShow: 'Nenhum registro encontrado',
  enabled: 'Ativo',
  pinColumn: 'Fixar coluna',
  pinLeft: 'Fixar à esquerda',
  pinRight: 'Fixar à direita',
  noPin: 'Não fixar',
  autosizeThiscolumn: 'Ajustar esta coluna',
  autosizeAllColumns: 'Ajustar todas as colunas',
  resetColumns: 'Restaurar colunas',
  columnMenu: 'Menu da coluna',
  ariaFilterInput: 'Valor do filtro',
  ariaSortableColumn: 'Pressione ENTER para ordenar',
  sortAscending: 'Ordenar crescente',
  sortDescending: 'Ordenar decrescente',
  sortUnSort: 'Remover ordenação',
  page: 'Página',
  of: 'de',
  to: 'a',
  more: 'mais',
  nextPage: 'Próxima página',
  lastPage: 'Última página',
  firstPage: 'Primeira página',
  previousPage: 'Página anterior',
};

export function formatarCelula(c: Campo, v: any): string {
  if (v === null || v === undefined || v === '') return '';
  switch (c.tipo) {
    case 'data':
      return String(v).slice(0, 10).split('-').reverse().join('/');
    case 'data_hora':
      return new Date(v).toLocaleString('pt-BR');
    case 'booleano':
      return v ? 'Sim' : 'Não';
    case 'moeda':
      return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    case 'decimal':
      return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: c.casas ?? 4 });
    case 'opcao':
      return c.opcoes?.find(([o]) => o === v)?.[1] ?? String(v);
    case 'multi_opcao':
      return (v as string[]).map((x) => c.opcoes?.find(([o]) => o === x)?.[1] ?? x).join(', ');
    case 'cpf':
      return String(v).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    case 'cns':
      return String(v).replace(/(\d{3})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4');
    case 'cnpj':
      return String(v).replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    case 'cep':
      return String(v).replace(/(\d{5})(\d{3})/, '$1-$2');
    case 'telefone':
      return String(v).replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) $2-$3');
    default:
      return String(v);
  }
}
