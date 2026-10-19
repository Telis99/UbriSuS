// Cálculos do laboratório: fórmulas das variáveis de resultado, escolha do valor de referência por
// sexo e faixa etária, alertas de valores fora da referência e validação "Delta-Check".
// Arquivo sem dependências do Node: a mesma lógica é reproduzida na tela de digitação.

/** Converte texto digitado (vírgula ou ponto decimal) em número; null quando vazio/inválido. */
export function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return null;
  const normal = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Formata com as casas decimais configuradas para a variável (TR 1.2.47.16). */
export function formatar(v: number | null, casas: number | null | undefined) {
  if (v === null) return '';
  const c = casas ?? 2;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
}

// ---------------------------------------------------------------------------
// Avaliador de fórmulas (TR 1.2.47.6.2.1, 1.2.47.6.2.2, 1.2.47.27.1)
// Operadores + - * / ^, comparações (> < >= <= = <>), parênteses e funções
// MIN, MAX, ABS, RAIZ, LOG, LN, POT, ARRED(x; casas) e SE(condição; sim; não).
// ---------------------------------------------------------------------------
type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokens(expr: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch) || (ch === ',' && /[0-9]/.test(expr[i + 1] ?? '') && /[0-9]/.test(expr[i - 1] ?? ''))) {
      let j = i;
      while (j < expr.length && /[0-9.,]/.test(expr[j]) && !(expr[j] === ',' && !/[0-9]/.test(expr[j + 1] ?? ''))) j++;
      const n = Number(expr.slice(i, j).replace(',', '.'));
      if (!Number.isFinite(n)) throw new Error(`Número inválido na fórmula: ${expr.slice(i, j)}`);
      out.push({ t: 'num', v: n });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
      out.push({ t: 'id', v: expr.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }
    const dois = expr.slice(i, i + 2);
    if (['>=', '<=', '<>'].includes(dois)) {
      out.push({ t: 'op', v: dois });
      i += 2;
      continue;
    }
    if ('+-*/^()<>=;,'.includes(ch)) {
      out.push({ t: 'op', v: ch === ',' ? ';' : ch });
      i++;
      continue;
    }
    throw new Error(`Caractere inválido na fórmula: "${ch}"`);
  }
  return out;
}

const FUNCOES: Record<string, (...a: number[]) => number> = {
  MIN: (...a) => Math.min(...a),
  MAX: (...a) => Math.max(...a),
  ABS: (a) => Math.abs(a),
  RAIZ: (a) => Math.sqrt(a),
  LOG: (a) => Math.log10(a),
  LN: (a) => Math.log(a),
  POT: (a, b) => Math.pow(a, b),
  ARRED: (a, c = 0) => Math.round(a * 10 ** c) / 10 ** c,
  SE: (c, a, b) => (c ? a : b),
};

/** Variáveis (códigos) usadas pela fórmula — para validar a configuração. */
export function variaveisDaFormula(expr: string): string[] {
  return [...new Set(tokens(expr).filter((t, i, arr) => t.t === 'id' && !(arr[i + 1]?.t === 'op' && arr[i + 1].v === '(')).map((t) => t.v as string))];
}

/** Calcula a fórmula; devolve null quando alguma variável usada ainda não tem valor. */
export function calcular(expr: string, valores: Record<string, number | null | undefined>): number | null {
  const tk = tokens(expr);
  let p = 0;
  let faltou = false;
  const ver = (v: string) => tk[p]?.t === 'op' && tk[p].v === v;
  const esperar = (v: string) => {
    if (!ver(v)) throw new Error(`Fórmula inválida: esperado "${v}".`);
    p++;
  };
  const primario = (): number => {
    const t = tk[p++];
    if (!t) throw new Error('Fórmula incompleta.');
    if (t.t === 'num') return t.v;
    if (t.t === 'op' && t.v === '(') {
      const v = comparacao();
      esperar(')');
      return v;
    }
    if (t.t === 'op' && t.v === '-') return -potencia();
    if (t.t === 'op' && t.v === '+') return potencia();
    if (t.t === 'id') {
      if (ver('(')) {
        const fn = FUNCOES[t.v];
        if (!fn) throw new Error(`Função desconhecida: ${t.v}`);
        p++;
        const args: number[] = [];
        if (!ver(')')) {
          args.push(comparacao());
          while (ver(';')) {
            p++;
            args.push(comparacao());
          }
        }
        esperar(')');
        return fn(...args);
      }
      const v = valores[t.v];
      if (v === null || v === undefined || !Number.isFinite(v)) {
        faltou = true;
        return 0;
      }
      return v;
    }
    throw new Error(`Fórmula inválida próximo de "${t.v}".`);
  };
  const potencia = (): number => {
    const b = primario();
    if (ver('^')) {
      p++;
      return Math.pow(b, potencia());
    }
    return b;
  };
  const termo = (): number => {
    let v = potencia();
    while (ver('*') || ver('/')) {
      const op = tk[p++].v;
      const d = potencia();
      v = op === '*' ? v * d : v / d;
    }
    return v;
  };
  const soma = (): number => {
    let v = termo();
    while (ver('+') || ver('-')) {
      const op = tk[p++].v;
      const d = termo();
      v = op === '+' ? v + d : v - d;
    }
    return v;
  };
  const comparacao = (): number => {
    let v = soma();
    while (['>', '<', '>=', '<=', '=', '<>'].some(ver)) {
      const op = tk[p++].v;
      const d = soma();
      v = Number(op === '>' ? v > d : op === '<' ? v < d : op === '>=' ? v >= d : op === '<=' ? v <= d : op === '=' ? v === d : v !== d);
    }
    return v;
  };
  const r = comparacao();
  if (p < tk.length) throw new Error('Fórmula inválida: há termos sobrando.');
  if (faltou || !Number.isFinite(r)) return null;
  return r;
}

// ---------------------------------------------------------------------------
// Valores de referência por sexo e faixa etária (TR 1.2.47.28)
// ---------------------------------------------------------------------------
export interface Referencia {
  id?: number;
  variavel_id?: number;
  sexo?: string | null;
  idade_min?: number | null;
  idade_max?: number | null;
  unidade_idade?: string | null;
  minimo?: number | string | null;
  maximo?: number | string | null;
  critico_min?: number | string | null;
  critico_max?: number | string | null;
  texto_referencia?: string | null;
  valor_normal?: string | null;
}

const FATOR_DIAS: Record<string, number> = { DIAS: 1, MESES: 30.4375, ANOS: 365.25 };

/** Escolhe a referência aplicável ao paciente: a específica do sexo tem prioridade sobre a de ambos. */
export function escolherReferencia(refs: Referencia[], sexo: string | null | undefined, idadeDias: number | null): Referencia | null {
  const aplicaveis = refs.filter((r) => {
    if (r.sexo && r.sexo !== 'A' && r.sexo !== sexo) return false;
    const f = FATOR_DIAS[r.unidade_idade ?? 'ANOS'] ?? 365.25;
    if (idadeDias === null) return r.idade_min == null && r.idade_max == null;
    if (r.idade_min != null && idadeDias < Number(r.idade_min) * f) return false;
    if (r.idade_max != null && idadeDias >= (Number(r.idade_max) + 1) * f) return false;
    return true;
  });
  aplicaveis.sort((a, b) => Number(!a.sexo || a.sexo === 'A') - Number(!b.sexo || b.sexo === 'A'));
  return aplicaveis[0] ?? null;
}

/** Texto da referência para o laudo, montado a partir dos limites quando não informado. */
export function textoReferencia(r: Referencia | null, unidade?: string | null, casas?: number | null) {
  if (!r) return '';
  if (r.texto_referencia) return r.texto_referencia;
  const min = numero(r.minimo);
  const max = numero(r.maximo);
  const u = unidade ? ` ${unidade}` : '';
  if (min !== null && max !== null) return `${formatar(min, casas)} a ${formatar(max, casas)}${u}`;
  if (min !== null) return `Superior a ${formatar(min, casas)}${u}`;
  if (max !== null) return `Inferior a ${formatar(max, casas)}${u}`;
  return r.valor_normal ?? '';
}

export type Sinal = 'NORMAL' | 'BAIXO' | 'ALTO' | 'CRITICO_BAIXO' | 'CRITICO_ALTO' | 'ALTERADO';

/** Classifica o valor frente à referência (alerta ao operador, TR 1.2.47.43.47). */
export function classificar(valor: unknown, tipo: string, r: Referencia | null): Sinal | null {
  if (!r || valor === null || valor === undefined || valor === '') return null;
  if (tipo === 'NUMERICO' || tipo === 'CALCULO') {
    const v = numero(valor);
    if (v === null) return null;
    const cmin = numero(r.critico_min);
    const cmax = numero(r.critico_max);
    const min = numero(r.minimo);
    const max = numero(r.maximo);
    if (cmin !== null && v < cmin) return 'CRITICO_BAIXO';
    if (cmax !== null && v > cmax) return 'CRITICO_ALTO';
    if (min !== null && v < min) return 'BAIXO';
    if (max !== null && v > max) return 'ALTO';
    return 'NORMAL';
  }
  if (r.valor_normal) return String(valor).trim().toUpperCase() === r.valor_normal.trim().toUpperCase() ? 'NORMAL' : 'ALTERADO';
  return null;
}

export const DESCRICAO_SINAL: Record<Sinal, string> = {
  NORMAL: 'dentro da referência',
  BAIXO: 'abaixo da referência',
  ALTO: 'acima da referência',
  CRITICO_BAIXO: 'VALOR CRÍTICO (abaixo do limite de pânico)',
  CRITICO_ALTO: 'VALOR CRÍTICO (acima do limite de pânico)',
  ALTERADO: 'diferente do resultado esperado',
};

/** Delta-Check: variação percentual em relação ao resultado anterior do paciente (TR 1.2.47.43.54, 1.2.47.43.56). */
export function deltaCheck(atual: unknown, anterior: unknown, limitePercentual: number | string | null | undefined) {
  const a = numero(atual);
  const b = numero(anterior);
  const lim = numero(limitePercentual);
  if (a === null || b === null || lim === null || lim <= 0) return null;
  const variacao = b === 0 ? (a === 0 ? 0 : 100) : (Math.abs(a - b) / Math.abs(b)) * 100;
  return { variacao: Math.round(variacao * 10) / 10, excedeu: variacao > lim };
}

/** Idade em dias na data de referência. */
export function idadeEmDias(nascimento: string | Date | null | undefined, ref: Date = new Date()) {
  if (!nascimento) return null;
  const n = typeof nascimento === 'string' ? new Date(nascimento.slice(0, 10) + 'T12:00:00') : nascimento;
  return Math.floor((ref.getTime() - n.getTime()) / 86_400_000);
}

export interface VariavelLayout {
  id: number;
  codigo: string;
  rotulo: string;
  tipo: string;
  unidade_medida?: string | null;
  casas_decimais?: number | null;
  formula?: string | null;
  opcoes?: string | null;
  obrigatoria?: boolean;
  delta_percentual?: number | string | null;
}

/** Recalcula as variáveis do tipo cálculo, em ordem, a partir dos valores digitados. */
export function aplicarFormulas(variaveis: VariavelLayout[], valores: Record<string, any>, extras: Record<string, number | null> = {}) {
  const saida: Record<string, any> = { ...valores };
  for (let passada = 0; passada < 3; passada++) {
    const nums: Record<string, number | null> = { ...extras };
    for (const v of variaveis) nums[v.codigo.toUpperCase()] = numero(saida[v.codigo]);
    for (const v of variaveis) {
      if (v.tipo !== 'CALCULO' || !v.formula) continue;
      try {
        const r = calcular(v.formula, nums);
        const arred = r === null ? null : Math.round(r * 10 ** (v.casas_decimais ?? 2)) / 10 ** (v.casas_decimais ?? 2);
        saida[v.codigo] = arred;
        nums[v.codigo.toUpperCase()] = arred;
      } catch {
        saida[v.codigo] = null;
      }
    }
  }
  return saida;
}
