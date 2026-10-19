// Validações compartilhadas entre API e interface web (TR 1.1.1.5: validações também no front end).
// Este arquivo não pode importar módulos do Node: é empacotado também pelo Vite.

export const somenteDigitos = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

export function validarCpf(valor: string | null | undefined): boolean {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(cpf[t])) return false;
  }
  return true;
}

export function validarCnpj(valor: string | null | undefined): boolean {
  const cnpj = somenteDigitos(valor);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + p * Number(base[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(cnpj.slice(0, 12)) === Number(cnpj[12]) && calc(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

/** Cartão Nacional de Saúde: definitivos iniciam com 1 ou 2, provisórios com 7, 8 ou 9. */
export function validarCns(valor: string | null | undefined): boolean {
  const cns = somenteDigitos(valor);
  if (cns.length !== 15 || !'12789'.includes(cns[0])) return false;
  let soma = 0;
  for (let i = 0; i < 15; i++) soma += Number(cns[i]) * (15 - i);
  return soma % 11 === 0;
}

export const validarEmail = (v: string | null | undefined) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v ?? '');
export const validarCep = (v: string | null | undefined) => somenteDigitos(v).length === 8;
export const validarTelefone = (v: string | null | undefined) => {
  const n = somenteDigitos(v).length;
  return n === 10 || n === 11;
};

export function formatarCpf(v: string | null | undefined) {
  const d = somenteDigitos(v);
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : (v ?? '');
}

export function formatarCns(v: string | null | undefined) {
  const d = somenteDigitos(v);
  return d.length === 15 ? d.replace(/(\d{3})(\d{4})(\d{4})(\d{4})/, '$1 $2 $3 $4') : (v ?? '');
}

/** Classificação da qualidade da senha do operador (TR 1.1.2.1.39). */
export function forcaSenha(senha: string): 'fraca' | 'media' | 'forte' {
  let pontos = 0;
  if (senha.length >= 8) pontos++;
  if (senha.length >= 12) pontos++;
  if (/[a-z]/.test(senha) && /[A-Z]/.test(senha)) pontos++;
  if (/\d/.test(senha)) pontos++;
  if (/[^A-Za-z0-9]/.test(senha)) pontos++;
  return pontos <= 2 ? 'fraca' : pontos <= 3 ? 'media' : 'forte';
}

/**
 * Política de senha do cidadão e do ACS: mínimo 8 caracteres com 1 número,
 * 1 letra e 1 caractere especial (TR 1.1.1.82.1, 1.2.41.4, 1.2.49.6).
 */
export function senhaAtendePolitica(senha: string): string | null {
  if (senha.length < 8) return 'A senha deve ter no mínimo 8 caracteres.';
  if (!/\d/.test(senha)) return 'A senha deve conter ao menos 1 número.';
  if (!/[A-Za-z]/.test(senha)) return 'A senha deve conter ao menos 1 letra.';
  if (!/[^A-Za-z0-9]/.test(senha)) return 'A senha deve conter ao menos 1 caractere especial.';
  return null;
}

/** Idade em anos, meses e dias (TR 1.2.10.17.1, 1.2.16.12.2). */
export function idadeDetalhada(nascimento: string | Date, referencia: Date = new Date()) {
  const n = typeof nascimento === 'string' ? new Date(nascimento + 'T00:00:00') : nascimento;
  let anos = referencia.getFullYear() - n.getFullYear();
  let meses = referencia.getMonth() - n.getMonth();
  let dias = referencia.getDate() - n.getDate();
  if (dias < 0) {
    meses--;
    dias += new Date(referencia.getFullYear(), referencia.getMonth(), 0).getDate();
  }
  if (meses < 0) {
    anos--;
    meses += 12;
  }
  return { anos, meses, dias };
}

export function idadeTexto(nascimento: string | Date | null | undefined, referencia?: Date) {
  if (!nascimento) return '';
  const { anos, meses, dias } = idadeDetalhada(nascimento, referencia);
  const p = (n: number, s: string, pl: string) => `${n} ${n === 1 ? s : pl}`;
  return `${p(anos, 'ano', 'anos')}, ${p(meses, 'mês', 'meses')} e ${p(dias, 'dia', 'dias')}`;
}

/** Normaliza texto para comparação: maiúsculas, sem acentos e espaços duplicados. */
export function normalizarNome(v: string | null | undefined) {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
