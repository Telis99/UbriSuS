#!/usr/bin/env node
// Extrai os itens numerados do Termo de Referência (Anexo I) para
// docs/requisitos/requisitos.json, base da matriz de rastreabilidade.
//
// Uso: node scripts/extrair-requisitos.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const origem = join(raiz, 'docs/edital/anexo-i-termo-de-referencia.txt');
const destino = join(raiz, 'docs/requisitos/requisitos.json');

// Faixas de numeração do TR -> módulo do sistema (ordem do Anexo V do edital).
const MODULOS = [
  ['1.1.1', 'TEC', 'Características técnicas'],
  ['1.1.2', 'TEC', 'Base tecnológica'],
  ['1.2.1', 'AGE', 'Agendamento e cadastros nacionais'],
  ['1.2.13', 'FAT', 'Faturamento'],
  ['1.2.14', 'IND', 'Indicadores de gestão'],
  ['1.2.15', 'AMB', 'Ambulatório'],
  ['1.2.20', 'FAR', 'Farmácia'],
  ['1.2.31', 'PEP', 'Prontuário médico'],
  ['1.2.34', 'ODO', 'Prontuário odontológico'],
  ['1.2.35', 'TFD', 'Tratamento fora do domicílio'],
  ['1.2.36', 'ESUS', 'e-SUS AB (Atenção Primária)'],
  ['1.2.37', 'AIH', 'AIH'],
  ['1.2.39', 'IMU', 'Imunização'],
  ['1.2.40', 'TRA', 'Transporte sanitário'],
  ['1.2.41', 'APP', 'Atendimento remoto e autoatendimento'],
  ['1.2.42', 'UPA', 'UPA'],
  ['1.2.43', 'REG', 'Regulação'],
  ['1.2.44', 'RAAS', 'RAAS'],
  ['1.2.45', 'RAD', 'Radiologia'],
  ['1.2.46', 'CAPS', 'Ambulatório de saúde mental (CAPS)'],
  ['1.2.47', 'LAB', 'Laboratório'],
  ['1.2.48', 'INT', 'Interfaceamento'],
  ['1.2.49', 'ACS', 'Acesso ACS'],
  ['1.2.50', 'ECO', 'Ecografia'],
  ['1.3', 'POC', 'Prova de conceito'],
];

function compararIds(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

function moduloDe(id) {
  let atual = null;
  for (const m of MODULOS) if (compararIds(id, m[0]) >= 0) atual = m;
  return atual;
}

const linhas = readFileSync(origem, 'utf8')
  .split('\n')
  .map((l) => l.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

const itens = [];
let atual = null;
for (const linha of linhas) {
  if (/^2\. PRAZO DO CONTRATO/.test(linha)) break;
  const m = linha.match(/^(1(?:\.\d+)+)\.?\s+(.*)$/);
  if (m && (!atual || compararIds(m[1], atual.id) > 0)) {
    atual = { id: m[1], texto: m[2] };
    itens.push(atual);
  } else if (atual) {
    atual.texto += ' ' + linha;
  }
}

const ids = new Set(itens.map((i) => i.id));
const requisitos = itens
  .filter((i) => i.id.startsWith('1.1.') || i.id.startsWith('1.2.') || i.id.startsWith('1.3.'))
  .map((i) => {
    const [, sigla, nome] = moduloDe(i.id);
    const temFilhos = [...ids].some((o) => o.startsWith(i.id + '.'));
    return {
      id: i.id,
      modulo: sigla,
      moduloNome: nome,
      texto: i.texto.replace(/-\s+(?=[a-zà-ú])/g, '').trim(),
      folha: !temFilhos,
    };
  });

writeFileSync(destino, JSON.stringify(requisitos, null, 2) + '\n');
const porModulo = {};
for (const r of requisitos) porModulo[r.modulo] = (porModulo[r.modulo] ?? 0) + 1;
console.log(`${requisitos.length} itens extraídos ->`, destino);
console.log(porModulo);
