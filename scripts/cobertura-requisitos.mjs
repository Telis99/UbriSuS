// Matriz de rastreabilidade: cruza os itens do Termo de Referência (docs/requisitos/requisitos.json)
// com as referências "TR x.y.z" e listas tr: [...] do código-fonte, gerando a cobertura por módulo
// e a matriz em docs/requisitos/matriz-rastreabilidade.md e .csv.
//
// Uso: node scripts/cobertura-requisitos.mjs [--faltantes <prefixo>]
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const raiz = new URL('..', import.meta.url).pathname;
const requisitos = JSON.parse(readFileSync(join(raiz, 'docs/requisitos/requisitos.json'), 'utf8'));
const ids = new Set(requisitos.map((r) => r.id));

function arquivos(dir, out = []) {
  for (const nome of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'dados'].includes(nome)) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivos(p, out);
    else if (/\.(ts|tsx|sql|mjs)$/.test(nome)) out.push(p);
  }
  return out;
}

// Referências: "TR 1.2.3.4", "TR 1.2.3.4, 1.2.3.5", "1.2.3.4 a 1.2.3.9" e strings '1.2.3.4' em listas tr.
const referencias = new Map();
const anotar = (id, arquivo) => {
  if (!ids.has(id)) return;
  if (!referencias.has(id)) referencias.set(id, new Set());
  referencias.get(id).add(arquivo);
};
const faixa = (a, b, arquivo) => {
  const pa = a.split('.');
  const pb = b.split('.');
  if (pa.length !== pb.length || pa.slice(0, -1).join('.') !== pb.slice(0, -1).join('.')) return anotar(a, arquivo), anotar(b, arquivo);
  for (let i = Number(pa.at(-1)); i <= Number(pb.at(-1)); i++) anotar([...pa.slice(0, -1), i].join('.'), arquivo);
};
for (const arq of arquivos(join(raiz, 'apps'))) {
  const rel = relative(raiz, arq);
  const txt = readFileSync(arq, 'utf8');
  for (const m of txt.matchAll(/TR\s+((?:1\.[\d.]+\d)(?:\s*(?:,|e|a|\/)\s*1\.[\d.]+\d)*)/g)) {
    const trecho = m[1];
    for (const f of trecho.matchAll(/(1\.[\d.]+\d)\s+a\s+(1\.[\d.]+\d)/g)) faixa(f[1], f[2], rel);
    for (const x of trecho.matchAll(/1\.[\d.]+\d/g)) anotar(x[0], rel);
  }
  for (const m of txt.matchAll(/tr:\s*\[([^\]]*)\]/g)) for (const x of m[1].matchAll(/'(1\.[\d.]+\d)'/g)) anotar(x[1], rel);
  for (const m of txt.matchAll(/tr:\s*'(1\.[\d.]+\d)'/g)) anotar(m[1], rel);
  for (const m of txt.matchAll(/ajuda:\s*'[^']*?(1\.\d+\.[\d.]+\d)[^']*'/g)) anotar(m[1], rel);
}

// Um item agrupador (ex.: "1.2.24.2 ... listar, minimamente:") é coberto quando seus subitens são cobertos e vice-versa.
const filhos = new Map();
for (const r of requisitos) {
  const pai = r.id.split('.').slice(0, -1).join('.');
  if (ids.has(pai)) filhos.set(pai, [...(filhos.get(pai) ?? []), r.id]);
}
const coberto = (id) => referencias.has(id);
let mudou = true;
const herdados = new Set();
while (mudou) {
  mudou = false;
  for (const r of requisitos) {
    if (coberto(r.id) || herdados.has(r.id)) continue;
    const fs = filhos.get(r.id);
    const pai = r.id.split('.').slice(0, -1).join('.');
    // Pai coberto cobre filhos que são apenas enumerações de campos/opções (texto curto).
    const enumeracao = r.texto.length < 90 && (coberto(pai) || herdados.has(pai));
    if ((fs && fs.length && fs.every((f) => coberto(f) || herdados.has(f))) || enumeracao) {
      herdados.add(r.id);
      mudou = true;
    }
  }
}
const situacao = (id) => (coberto(id) ? 'IMPLEMENTADO' : herdados.has(id) ? 'IMPLEMENTADO (itens/agrupador)' : 'PENDENTE');

// Cobertura por módulo (seção de 3 níveis).
const secoes = new Map();
for (const r of requisitos) {
  const s = r.id.split('.').slice(0, 3).join('.');
  const e = secoes.get(s) ?? { secao: s, modulo: r.moduloNome, total: 0, ok: 0 };
  e.total++;
  if (situacao(r.id) !== 'PENDENTE') e.ok++;
  secoes.set(s, e);
}
const total = requisitos.length;
const ok = requisitos.filter((r) => situacao(r.id) !== 'PENDENTE').length;

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '0.0');
const linhasMd = [
  '# Matriz de rastreabilidade do Termo de Referência',
  '',
  `Pregão Eletrônico nº 71/2025 — Prefeitura Municipal de Cabreúva/SP. Gerada por \`npm run requisitos:cobertura\` em ${new Date().toISOString().slice(0, 10)}.`,
  '',
  `**Cobertura geral: ${ok} de ${total} itens (${pct(ok, total)}%).**`,
  '',
  '| Seção | Módulo | Itens | Atendidos | % |',
  '|---|---|---:|---:|---:|',
  ...[...secoes.values()].map((s) => `| ${s.secao} | ${s.modulo} | ${s.total} | ${s.ok} | ${pct(s.ok, s.total)}% |`),
  '',
  '## Itens',
  '',
  '| Item | Situação | Requisito | Implementação |',
  '|---|---|---|---|',
  ...requisitos.map((r) => `| ${r.id} | ${situacao(r.id)} | ${r.texto.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 160)} | ${[...(referencias.get(r.id) ?? [])].slice(0, 3).join('<br>')} |`),
];
writeFileSync(join(raiz, 'docs/requisitos/matriz-rastreabilidade.md'), linhasMd.join('\n') + '\n');
const csv = ['item;modulo;situacao;requisito;arquivos', ...requisitos.map((r) => [r.id, r.moduloNome, situacao(r.id), `"${r.texto.replace(/"/g, '""').replace(/\s+/g, ' ')}"`, [...(referencias.get(r.id) ?? [])].join(' ')].join(';'))];
writeFileSync(join(raiz, 'docs/requisitos/matriz-rastreabilidade.csv'), '﻿' + csv.join('\r\n'));

console.log(`Cobertura: ${ok}/${total} (${pct(ok, total)}%)`);
const arg = process.argv.indexOf('--faltantes');
if (arg > 0) {
  const prefixo = process.argv[arg + 1] ?? '';
  for (const r of requisitos.filter((x) => x.id.startsWith(prefixo) && situacao(x.id) === 'PENDENTE')) console.log(r.id, r.texto.replace(/\s+/g, ' ').slice(0, 200));
} else {
  for (const s of [...secoes.values()].sort((a, b) => a.ok / a.total - b.ok / b.total).slice(0, 80)) console.log(`${s.secao.padEnd(10)} ${String(s.ok).padStart(4)}/${String(s.total).padEnd(4)} ${pct(s.ok, s.total).padStart(5)}%  ${s.modulo}`);
}
