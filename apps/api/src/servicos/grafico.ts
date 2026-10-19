// Gráficos de linhas e barras em SVG para os relatórios impressos (TR 1.2.21.2.1, 1.2.21.5, 1.2.26.11 a 1.2.26.13).

export interface Grafico {
  tipo: 'linha' | 'barra';
  /** Campo da categoria (eixo X). */
  x: string;
  /** Campo do valor (eixo Y). */
  y: string;
  /** Campo que separa as séries (uma linha/cor por valor). */
  serie?: string;
  titulo?: string;
}

const CORES = ['#1c7ed6', '#e03131', '#2f9e44', '#f08c00', '#7048e8', '#0c8599', '#c2255c', '#5c940d', '#495057', '#d9480f'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function svgGrafico(g: Grafico, linhas: Record<string, any>[], largura = 760, altura = 260): string {
  const categorias = [...new Set(linhas.map((l) => String(l[g.x] ?? '')))];
  const series = g.serie ? [...new Set(linhas.map((l) => String(l[g.serie!] ?? '')))] : [g.titulo ?? g.y];
  const doPonto = (cat: string, s: string) => linhas.filter((l) => String(l[g.x] ?? '') === cat && (!g.serie || String(l[g.serie] ?? '') === s));
  const valor = (cat: string, s: string) => doPonto(cat, s).reduce((t, l) => t + (Number(l[g.y]) || 0), 0);
  const max = Math.max(1, ...categorias.flatMap((c) => series.map((s) => valor(c, s))));
  const m = { e: 50, d: 10, t: 14, b: 46 };
  const w = largura - m.e - m.d;
  const h = altura - m.t - m.b;
  const px = (i: number) => m.e + (categorias.length <= 1 ? w / 2 : (i * w) / (categorias.length - 1));
  const py = (v: number) => m.t + h - (v / max) * h;
  const partes: string[] = [];
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    partes.push(`<line x1="${m.e}" x2="${m.e + w}" y1="${py(v)}" y2="${py(v)}" stroke="#ddd"/>`);
    partes.push(`<text x="${m.e - 4}" y="${py(v) + 3}" font-size="9" text-anchor="end">${Math.round(v).toLocaleString('pt-BR')}</text>`);
  }
  const passo = Math.ceil(categorias.length / 14);
  categorias.forEach((c, i) => {
    if (i % passo) return;
    const x = g.tipo === 'barra' ? m.e + ((i + 0.5) * w) / categorias.length : px(i);
    partes.push(`<text x="${x}" y="${m.t + h + 14}" font-size="8" text-anchor="middle">${esc(c.slice(0, 12))}</text>`);
  });
  series.forEach((s, si) => {
    const cor = CORES[si % CORES.length];
    if (g.tipo === 'linha') {
      // Séries sem valor em uma categoria não são desenhadas nesse ponto (ex.: realizado x previsto).
      const presentes = categorias.map((c, i) => [c, i] as const).filter(([c]) => doPonto(c, s).length);
      const pts = presentes.map(([c, i]) => `${px(i)},${py(valor(c, s))}`).join(' ');
      partes.push(`<polyline fill="none" stroke="${cor}" stroke-width="2" points="${pts}"/>`);
      presentes.forEach(([c, i]) => partes.push(`<circle cx="${px(i)}" cy="${py(valor(c, s))}" r="2.5" fill="${cor}"/>`));
    } else {
      const bw = w / categorias.length / (series.length + 0.5);
      categorias.forEach((c, i) => {
        const v = valor(c, s);
        const x = m.e + (i * w) / categorias.length + bw * (si + 0.25);
        partes.push(`<rect x="${x}" y="${py(v)}" width="${bw * 0.9}" height="${m.t + h - py(v)}" fill="${cor}"/>`);
      });
    }
    partes.push(`<rect x="${m.e + si * 110}" y="${altura - 14}" width="10" height="8" fill="${cor}"/><text x="${m.e + si * 110 + 14}" y="${altura - 7}" font-size="9">${esc(s.slice(0, 18))}</text>`);
  });
  partes.push(`<line x1="${m.e}" x2="${m.e}" y1="${m.t}" y2="${m.t + h}" stroke="#888"/><line x1="${m.e}" x2="${m.e + w}" y1="${m.t + h}" y2="${m.t + h}" stroke="#888"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}" viewBox="0 0 ${largura} ${altura}" font-family="Helvetica">${partes.join('')}</svg>`;
}
