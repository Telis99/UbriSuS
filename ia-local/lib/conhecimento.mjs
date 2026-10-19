// Base de conhecimento local: edital, Termo de Referência (a "lei" do projeto), itens do TR com a
// situação na matriz de rastreabilidade, convenções do código e o que os agentes aprenderam.
// Busca por relevância (BM25) em português, sem dependências e sem internet.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PARADAS = new Set(
  'a o e de da do das dos em no na nos nas um uma para por com sem ao aos as os que se ou ser deve devera devera permitir sistema possibilitar mesmo pela pelo pelas pelos como mais quando sua seu suas seus entre sobre ate apos'.split(' '),
);
const normalizar = (t) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const termos = (t) => normalizar(t).match(/[a-z0-9]{2,}/g)?.filter((x) => !PARADAS.has(x)) ?? [];

/** Divide um texto longo em trechos de ~1.200 caracteres, respeitando parágrafos. */
function trechos(texto, fonte) {
  const partes = [];
  let atual = '';
  for (const p of texto.split(/\n\s*\n/)) {
    if ((atual + p).length > 1200 && atual) {
      partes.push(atual);
      atual = '';
    }
    atual += p.trim() + '\n';
  }
  if (atual.trim()) partes.push(atual);
  return partes.map((t, i) => ({ fonte: `${fonte} #${i + 1}`, texto: t.trim() }));
}

export function carregarBase(raiz) {
  const docs = [];
  const ler = (rel) => (existsSync(join(raiz, rel)) ? readFileSync(join(raiz, rel), 'utf8') : '');
  docs.push(...trechos(ler('docs/edital/edital-pe-71-2025.txt'), 'Edital PE 71/2025'));
  docs.push(...trechos(ler('docs/edital/anexo-i-termo-de-referencia.txt'), 'Termo de Referência'));
  docs.push(...trechos(ler('docs/desenvolvimento/CONVENCOES.md'), 'Convenções do código'));
  docs.push(...trechos(ler('docs/conformidade/infraestrutura-e-servicos.md'), 'Conformidade/infraestrutura'));
  docs.push(...trechos(ler('README.md'), 'README'));
  for (const dir of ['ia-local/conhecimento']) {
    const d = join(raiz, dir);
    if (!existsSync(d)) continue;
    for (const n of readdirSync(d).filter((x) => x.endsWith('.md'))) docs.push(...trechos(readFileSync(join(d, n), 'utf8'), `Aprendizado: ${n}`));
  }
  // Cada item do TR vira um documento próprio, com a situação e os arquivos que o implementam.
  const situacao = new Map();
  const matriz = ler('docs/requisitos/matriz-rastreabilidade.csv');
  for (const linha of matriz.split(/\r?\n/).slice(1)) {
    const [id, , sit] = linha.split(';');
    const arquivos = linha.slice(linha.lastIndexOf(';') + 1);
    if (id) situacao.set(id.replace(/^﻿/, ''), { sit, arquivos });
  }
  const requisitos = JSON.parse(ler('docs/requisitos/requisitos.json') || '[]');
  for (const r of requisitos) {
    const s = situacao.get(r.id);
    docs.push({ fonte: `TR item ${r.id}`, id: r.id, texto: `Item ${r.id} (${r.moduloNome}) [${s?.sit ?? '?'}]: ${r.texto}${s?.arquivos ? `\nImplementação: ${s.arquivos}` : ''}` });
  }
  return indexar(docs, requisitos, situacao);
}

function indexar(docs, requisitos, situacao) {
  const df = new Map();
  const tf = docs.map((d) => {
    const m = new Map();
    for (const t of termos(d.texto + ' ' + d.fonte)) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    d.tamanho = [...m.values()].reduce((a, b) => a + b, 0);
    return m;
  });
  const media = docs.reduce((a, d) => a + d.tamanho, 0) / Math.max(1, docs.length);
  const N = docs.length;
  return {
    docs,
    requisitos,
    situacao,
    buscar(consulta, k = 5, filtro) {
      const q = [...new Set(termos(consulta))];
      const notas = [];
      docs.forEach((d, i) => {
        if (filtro && !filtro(d)) return;
        let s = 0;
        for (const t of q) {
          const f = tf[i].get(t);
          if (!f) continue;
          const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
          s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.tamanho / media)));
        }
        if (s > 0) notas.push([s, d]);
      });
      return notas.sort((a, b) => b[0] - a[0]).slice(0, k).map(([, d]) => d);
    },
  };
}
