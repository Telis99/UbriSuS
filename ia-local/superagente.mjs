#!/usr/bin/env node
// Super agente local do projeto UbriSUS: coordena agentes especialistas que trabalham com um modelo
// do Ollama (padrão: Qwen 3.5 4B), tendo o Edital e o Termo de Referência como lei.
//
// Uso (na raiz do projeto):
//   node ia-local/superagente.mjs                    conversa interativa
//   node ia-local/superagente.mjs "tarefa..."        executa uma tarefa e encerra
//   node ia-local/superagente.mjs --agente nome "..."  fala direto com um especialista
//   node ia-local/superagente.mjs --verificar        confere Ollama, modelo e base de conhecimento
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { carregarBase } from './lib/conhecimento.mjs';
import { executarFerramenta, ferramentasPara, limitar, listarAgentes } from './lib/ferramentas.mjs';
import { conversar, verificarOllama } from './lib/ollama.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');
const cfg = JSON.parse(readFileSync(join(aqui, 'config.json'), 'utf8'));
if (process.env.OLLAMA_MODELO) cfg.modelo = cfg.modeloAgentes = process.env.OLLAMA_MODELO;
if (process.env.OLLAMA_HOST) cfg.ollamaUrl = process.env.OLLAMA_HOST.startsWith('http') ? process.env.OLLAMA_HOST : `http://${process.env.OLLAMA_HOST}`;
const args = process.argv.slice(2);
if (args.includes('--auto')) cfg.autoAprovar = true;

const ler = (p) => readFileSync(join(aqui, p), 'utf8');
const LEI = ler('prompts/lei.md');
const cor = (c, t) => (process.stdout.isTTY ? `\x1b[${c}m${t}\x1b[0m` : t);

let base = carregarBase(raiz);
const terminal = createInterface({ input: process.stdin, output: process.stdout });

async function aprovar(pergunta, detalhe) {
  if (cfg.autoAprovar) return true;
  console.log(cor('33', `\n⚠ ${pergunta}`));
  if (detalhe) console.log(cor('2', limitar(String(detalhe), 2500)));
  const r = (await terminal.question(cor('33', 'Aprovar? (s/n) '))).trim().toLowerCase();
  return r === 's' || r === 'sim';
}

function memoria() {
  const p = join(aqui, 'memoria/diario.md');
  if (!existsSync(p)) return '';
  const linhas = readFileSync(p, 'utf8').trim().split('\n');
  return `\nÚltimas anotações do diário do projeto:\n${linhas.slice(-15).join('\n')}\n`;
}

function promptDe(agente) {
  if (agente === 'superagente') {
    const equipe = listarAgentes(raiz).map((g) => `- ${g.nome}: ${g.especialidade}`).join('\n') || '(nenhum ainda)';
    return `${LEI}\n${ler('prompts/superagente.md')}\nEquipe atual:\n${equipe}\n${memoria()}`;
  }
  const g = listarAgentes(raiz).find((x) => x.nome === agente);
  if (!g) return null;
  return `${LEI}\n${ler('prompts/especialista.md')
    .replace('{nome}', g.nome)
    .replace('{especialidade}', g.especialidade)
    .replace('{missao}', g.missao)
    .replace('{itens_tr}', g.itens_tr || 'definidos na tarefa')}${memoria()}`;
}

/** Laço de um agente: conversa com o modelo e executa as ferramentas pedidas até a resposta final. */
async function executarAgente(agente, tarefa, profundidade, historico = []) {
  const sistema = promptDe(agente);
  if (!sistema) return `Agente "${agente}" não existe. Crie-o com criar_agente.`;
  const modelo = profundidade === 0 ? cfg.modelo : cfg.modeloAgentes;
  const mensagens = [{ role: 'system', content: sistema }, ...historico, { role: 'user', content: tarefa }];
  const ferramentas = ferramentasPara(agente, profundidade, cfg);
  const recuo = '  '.repeat(profundidade);
  const ctx = {
    cfg,
    raiz,
    get base() {
      return base;
    },
    agente,
    aprovar,
    recarregarBase: () => (base = carregarBase(raiz)),
    delegar: async (outro, t) => {
      console.log(cor('35', `${recuo}↳ ${agente} delega a ${outro}: ${t.slice(0, 160)}`));
      const r = await executarAgente(outro, t, profundidade + 1);
      console.log(cor('35', `${recuo}↲ ${outro} terminou.`));
      return `Relatório de ${outro}:\n${r}`;
    },
  };
  for (let passo = 0; passo < cfg.maxPassos; passo++) {
    const msg = await conversar(cfg, modelo, mensagens, ferramentas);
    mensagens.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    if (!msg.tool_calls?.length) {
      if (profundidade === 0) historico.push({ role: 'user', content: tarefa }, { role: 'assistant', content: msg.content ?? '' });
      return msg.content ?? '';
    }
    for (const chamada of msg.tool_calls) {
      const nome = chamada.function?.name;
      let argumentos = chamada.function?.arguments ?? {};
      if (typeof argumentos === 'string') {
        try {
          argumentos = JSON.parse(argumentos);
        } catch {
          argumentos = {};
        }
      }
      console.log(cor('36', `${recuo}• [${agente}] ${nome} ${limitar(JSON.stringify(argumentos), 160)}`));
      let resultado;
      try {
        resultado = String(await executarFerramenta(nome, argumentos, ctx));
      } catch (e) {
        resultado = `Erro: ${e.message}`;
      }
      mensagens.push({ role: 'tool', tool_name: nome, content: limitar(resultado, cfg.limiteSaidaFerramenta) });
    }
  }
  mensagens.push({ role: 'user', content: 'Limite de passos atingido. Pare agora e escreva o relatório do que foi feito e do que falta.' });
  return (await conversar(cfg, modelo, mensagens, [])).content ?? '';
}

async function verificar() {
  const o = await verificarOllama(cfg);
  if (!o.ok) {
    console.log(cor('31', o.erro));
    return false;
  }
  const tem = (m) => o.modelos.some((x) => x === m || x === `${m}:latest`);
  console.log(cor('32', `Ollama ok em ${cfg.ollamaUrl}. Modelos: ${o.modelos.join(', ') || '(nenhum)'}`));
  for (const m of new Set([cfg.modelo, cfg.modeloAgentes]))
    if (!tem(m)) {
      console.log(cor('31', `Modelo "${m}" não está instalado. Rode: ollama pull ${m}  (ou ajuste "modelo" em ia-local/config.json)`));
      return false;
    }
  console.log(cor('32', `Base de conhecimento: ${base.docs.length} trechos (edital, TR com ${base.requisitos.length} itens, convenções, aprendizados).`));
  console.log(cor('32', `Agentes especialistas: ${listarAgentes(raiz).map((g) => g.nome).join(', ') || 'nenhum'}`));
  return true;
}

async function principal() {
  if (args.includes('--verificar')) return verificar();
  if (!(await verificar())) return;
  const iAg = args.indexOf('--agente');
  const agente = iAg >= 0 ? args[iAg + 1] : 'superagente';
  const tarefa = args.filter((x, i) => !x.startsWith('--') && (iAg < 0 || (i !== iAg + 1))).join(' ').trim();
  if (tarefa) {
    console.log('\n' + (await executarAgente(agente, tarefa, 0)));
    return;
  }
  console.log(cor('1', `\nSuper agente UbriSUS (${cfg.modelo}). Escreva a tarefa; "sair" encerra, "/agentes" lista a equipe, "/limpar" zera a conversa.\n`));
  const historico = [];
  for (;;) {
    const entrada = (await terminal.question(cor('1', 'você> '))).trim();
    if (!entrada) continue;
    if (['sair', 'exit', 'quit'].includes(entrada)) break;
    if (entrada === '/agentes') {
      console.log(listarAgentes(raiz).map((g) => `- ${g.nome}: ${g.especialidade}`).join('\n'));
      continue;
    }
    if (entrada === '/limpar') {
      historico.length = 0;
      continue;
    }
    try {
      const r = await executarAgente(agente, entrada, 0, historico);
      console.log('\n' + cor('32', `${agente}> `) + r + '\n');
      while (historico.length > 12) historico.shift();
    } catch (e) {
      console.log(cor('31', `Erro: ${e.message}`));
    }
  }
}

principal()
  .catch((e) => console.error(cor('31', e.stack ?? e.message)))
  .finally(() => terminal.close());
