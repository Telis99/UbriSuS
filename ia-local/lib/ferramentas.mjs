// Ferramentas que o super agente e os agentes especializados podem usar.
// Leitura é livre; gravação de arquivos e comandos fora da lista exigem aprovação do usuário.
import { execFileSync, execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

const IGNORAR = new Set(['node_modules', '.git', 'dist', 'storage', '.dados', 'coverage']);

const def = (name, description, props = {}, required = Object.keys(props)) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties: props, required } },
});
const txt = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });

export const DEFINICOES = {
  consultar_edital: def('consultar_edital', 'Busca trechos do Edital e do Termo de Referência (a lei do projeto), itens do TR, convenções do código e aprendizados dos agentes.', { consulta: txt('palavras-chave em português') }),
  requisito: def('requisito', 'Texto completo de um item do Termo de Referência, seus subitens, situação (IMPLEMENTADO/PENDENTE) e arquivos que o implementam.', { id: txt('número do item, ex.: 1.2.42.2.24') }),
  pendencias: def('pendencias', 'Lista os itens do TR ainda pendentes de uma seção (ex.: 1.2.42). Sem seção, mostra a cobertura por módulo.', { secao: txt('prefixo do item, ex.: 1.2.29') }, []),
  buscar_internet: def('buscar_internet', 'Pesquisa na internet (legislação, manuais do Ministério da Saúde/DATASUS, leiautes, documentação técnica). Use quando a base local não bastar.', { consulta: txt('termos da pesquisa') }),
  ler_pagina: def('ler_pagina', 'Baixa uma página da internet e devolve o texto principal.', { url: txt('endereço http(s)') }),
  listar_arquivos: def('listar_arquivos', 'Lista arquivos de uma pasta do projeto.', { pasta: txt('caminho relativo à raiz, ex.: apps/api/src/modulos') }),
  ler_arquivo: def('ler_arquivo', 'Lê um arquivo do projeto (ou um intervalo de linhas).', { caminho: txt('caminho relativo'), inicio: num('linha inicial (opcional)'), fim: num('linha final (opcional)') }, ['caminho']),
  procurar_no_codigo: def('procurar_no_codigo', 'Procura um texto ou expressão regular nos arquivos do projeto e devolve arquivo:linha.', { texto: txt('texto ou regex'), pasta: txt('pasta (opcional, padrão apps)') }, ['texto']),
  escrever_arquivo: def('escrever_arquivo', 'Cria ou substitui um arquivo inteiro do projeto (pede aprovação ao usuário).', { caminho: txt('caminho relativo'), conteudo: txt('conteúdo completo') }),
  substituir_trecho: def('substituir_trecho', 'Troca um trecho exato de um arquivo por outro (pede aprovação ao usuário).', { caminho: txt('caminho relativo'), antigo: txt('trecho exato atual'), novo: txt('novo trecho') }),
  executar_comando: def('executar_comando', 'Executa um comando no terminal na raiz do projeto (ex.: npm run typecheck). Comandos fora da lista segura pedem aprovação.', { comando: txt('comando') }),
  registrar_aprendizado: def('registrar_aprendizado', 'Guarda um conhecimento aprendido (com fontes) na base do agente, para consultas futuras de todos os agentes.', { titulo: txt('assunto'), conteudo: txt('o que foi aprendido, objetivo e verificável'), fontes: txt('URLs ou itens do TR') }),
  criar_agente: def('criar_agente', 'Cria (ou atualiza) um agente especialista com missão própria. Ele poderá pesquisar na internet e registrar aprendizados para se tornar especialista.', { nome: txt('identificador curto, ex.: especialista-bpa'), especialidade: txt('área de especialidade'), missao: txt('o que o agente deve fazer e como'), itens_tr: txt('seções/itens do TR sob sua responsabilidade (opcional)') }, ['nome', 'especialidade', 'missao']),
  listar_agentes: def('listar_agentes', 'Lista os agentes especialistas disponíveis.', {}, []),
  delegar: def('delegar', 'Entrega uma tarefa a um agente especialista e recebe o relatório dele.', { agente: txt('nome do agente'), tarefa: txt('tarefa detalhada, com itens do TR e critérios de aceite') }),
  anotar_memoria: def('anotar_memoria', 'Registra no diário do projeto o que foi decidido ou feito (memória entre sessões).', { anotacao: txt('resumo curto') }),
};

/** Ferramentas oferecidas a cada tipo de agente. */
export function ferramentasPara(papel, profundidade, cfg) {
  const base = ['consultar_edital', 'requisito', 'pendencias', 'buscar_internet', 'ler_pagina', 'listar_arquivos', 'ler_arquivo', 'procurar_no_codigo', 'escrever_arquivo', 'substituir_trecho', 'executar_comando', 'registrar_aprendizado', 'anotar_memoria', 'listar_agentes'];
  const extras = profundidade < cfg.profundidadeMaxima ? ['criar_agente', 'delegar'] : [];
  return [...base, ...extras].map((n) => DEFINICOES[n]);
}

function dentroDaRaiz(raiz, caminho) {
  const abs = normalize(join(raiz, String(caminho ?? '')));
  if (!abs.startsWith(normalize(raiz + sep)) && abs !== normalize(raiz)) throw new Error('Caminho fora da pasta do projeto.');
  return abs;
}

const limitar = (t, n) => (t.length > n ? t.slice(0, n) + `\n... (cortado, ${t.length - n} caracteres a mais)` : t);

function textoDeHtml(html) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

async function pesquisar(cfg, consulta) {
  const cab = { 'user-agent': 'Mozilla/5.0 (super-agente local)' };
  // SearXNG próprio (o mesmo que pode servir o Open WebUI), quando configurado.
  if (cfg.searxngUrl) {
    const r = await fetch(`${cfg.searxngUrl.replace(/\/$/, '')}/search?format=json&language=pt-BR&q=${encodeURIComponent(consulta)}`, { headers: cab });
    if (r.ok) return ((await r.json()).results ?? []).slice(0, 8).map((x) => `- ${x.title}\n  ${x.url}\n  ${(x.content ?? '').slice(0, 220)}`).join('\n');
  }
  let html = '';
  for (const url of [`https://html.duckduckgo.com/html/?kl=br-pt&q=`, `https://lite.duckduckgo.com/lite/?kl=br-pt&q=`]) {
    try {
      const r = await fetch(url + encodeURIComponent(consulta), { headers: cab, signal: AbortSignal.timeout(20_000) });
      if (r.ok) html = await r.text();
    } catch {
      // tenta o próximo endereço
    }
    if (html.includes('http')) break;
  }
  if (!html) throw new Error('pesquisa na internet indisponível (verifique a conexão ou configure searxngUrl em ia-local/config.json)');
  const itens = [];
  for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)) {
    let url = m[1];
    const u = url.match(/uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]);
    itens.push(`- ${textoDeHtml(m[2])}\n  ${url}\n  ${textoDeHtml(m[3]).slice(0, 220)}`);
    if (itens.length >= 8) break;
  }
  // Leiaute alternativo (versão "lite" ou mudança no HTML): extrai os links externos da página.
  if (!itens.length)
    for (const m of html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      let url = m[1];
      const u = url.match(/uddg=([^&]+)/);
      if (u) url = decodeURIComponent(u[1]);
      const titulo = textoDeHtml(m[2]);
      if (!/^https?:\/\//.test(url) || /duckduckgo\.com/.test(url) || titulo.length < 4) continue;
      itens.push(`- ${titulo}\n  ${url}`);
      if (itens.length >= 8) break;
    }
  return itens.join('\n') || 'Nenhum resultado.';
}

function procurar(raiz, padrao, pasta = 'apps') {
  const re = new RegExp(padrao, 'i');
  const saida = [];
  const andar = (d) => {
    for (const n of readdirSync(d)) {
      if (IGNORAR.has(n)) continue;
      const p = join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) andar(p);
      else if (/\.(ts|tsx|mjs|js|sql|md|json|yaml|yml)$/.test(n) && st.size < 800_000) {
        readFileSync(p, 'utf8')
          .split('\n')
          .forEach((l, i) => {
            if (saida.length < 60 && re.test(l)) saida.push(`${relative(raiz, p)}:${i + 1}: ${l.trim().slice(0, 160)}`);
          });
      }
      if (saida.length >= 60) return;
    }
  };
  andar(dentroDaRaiz(raiz, pasta));
  return saida.join('\n') || 'Nada encontrado.';
}

export async function executarFerramenta(nome, a, ctx) {
  const { cfg, raiz, base, aprovar, agente } = ctx;
  switch (nome) {
    case 'consultar_edital': {
      const r = base.buscar(a.consulta ?? '', 6);
      return r.map((d) => `[${d.fonte}]\n${d.texto.slice(0, 900)}`).join('\n---\n') || 'Nada encontrado na base local.';
    }
    case 'requisito': {
      const id = String(a.id ?? '').trim();
      const itens = base.docs.filter((d) => d.id && (d.id === id || d.id.startsWith(id + '.')));
      return itens.length ? itens.slice(0, 25).map((d) => d.texto).join('\n') : `Item ${id} não existe no TR.`;
    }
    case 'pendencias': {
      const args = a.secao ? ['--faltantes', String(a.secao).replace(/[^\d.]/g, '')] : [];
      return execFileSync(process.execPath, ['scripts/cobertura-requisitos.mjs', ...args], { cwd: raiz, encoding: 'utf8' });
    }
    case 'buscar_internet':
      return pesquisar(cfg, a.consulta ?? '');
    case 'ler_pagina': {
      if (!/^https?:\/\//.test(a.url ?? '')) throw new Error('URL inválida.');
      const r = await fetch(a.url, { headers: { 'user-agent': 'Mozilla/5.0 (super-agente local)' }, signal: AbortSignal.timeout(20_000) });
      const tipo = r.headers.get('content-type') ?? '';
      if (!tipo.includes('text') && !tipo.includes('json') && !tipo.includes('xml')) return `Conteúdo ${tipo} não textual (baixe manualmente: ${a.url}).`;
      return textoDeHtml(await r.text());
    }
    case 'listar_arquivos': {
      const d = dentroDaRaiz(raiz, a.pasta ?? '.');
      return readdirSync(d)
        .filter((n) => !IGNORAR.has(n))
        .map((n) => (statSync(join(d, n)).isDirectory() ? n + '/' : n))
        .join('\n');
    }
    case 'ler_arquivo': {
      const linhas = readFileSync(dentroDaRaiz(raiz, a.caminho), 'utf8').split('\n');
      const i = Math.max(1, Number(a.inicio) || 1);
      const f = Math.min(linhas.length, Number(a.fim) || i + 199);
      return linhas.slice(i - 1, f).map((l, k) => `${i + k}: ${l}`).join('\n') + (f < linhas.length ? `\n... (arquivo tem ${linhas.length} linhas)` : '');
    }
    case 'procurar_no_codigo':
      return procurar(raiz, a.texto, a.pasta);
    case 'escrever_arquivo': {
      const p = dentroDaRaiz(raiz, a.caminho);
      if (!(await aprovar(`${agente} quer ${existsSync(p) ? 'SUBSTITUIR' : 'criar'} o arquivo ${a.caminho} (${String(a.conteudo ?? '').length} caracteres).`, a.conteudo))) return 'Usuário NÃO aprovou a gravação.';
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, a.conteudo ?? '');
      return `Arquivo ${a.caminho} gravado.`;
    }
    case 'substituir_trecho': {
      const p = dentroDaRaiz(raiz, a.caminho);
      const atual = readFileSync(p, 'utf8');
      const n = atual.split(a.antigo).length - 1;
      if (n !== 1) return `O trecho antigo aparece ${n} vezes em ${a.caminho}; ele precisa ser único e exato. Leia o arquivo de novo.`;
      if (!(await aprovar(`${agente} quer alterar ${a.caminho}`, `--- antes\n${a.antigo}\n+++ depois\n${a.novo}`))) return 'Usuário NÃO aprovou a alteração.';
      writeFileSync(p, atual.replace(a.antigo, a.novo));
      return `Trecho de ${a.caminho} alterado.`;
    }
    case 'executar_comando': {
      const cmd = String(a.comando ?? '').trim();
      const livre = cfg.comandosLivres.some((c) => cmd === c || cmd.startsWith(c + ' ')) && !/[;&|`$><]/.test(cmd);
      if (!livre && !(await aprovar(`${agente} quer executar: ${cmd}`))) return 'Usuário NÃO aprovou o comando.';
      try {
        return execSync(cmd, { cwd: raiz, encoding: 'utf8', timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'] }) || '(sem saída)';
      } catch (e) {
        return `Comando terminou com erro:\n${e.stdout ?? ''}\n${e.stderr ?? e.message}`;
      }
    }
    case 'registrar_aprendizado': {
      const d = join(raiz, 'ia-local/conhecimento');
      mkdirSync(d, { recursive: true });
      appendFileSync(join(d, `${agente}.md`), `\n\n## ${a.titulo}\n\n${a.conteudo}\n\nFontes: ${a.fontes}\n(${new Date().toLocaleString('pt-BR')})\n`);
      ctx.recarregarBase();
      return 'Aprendizado registrado na base de conhecimento.';
    }
    case 'anotar_memoria': {
      mkdirSync(join(raiz, 'ia-local/memoria'), { recursive: true });
      appendFileSync(join(raiz, 'ia-local/memoria/diario.md'), `- ${new Date().toLocaleString('pt-BR')} [${agente}] ${a.anotacao}\n`);
      return 'Anotado no diário.';
    }
    case 'criar_agente': {
      const nomeAg = String(a.nome ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
      if (!nomeAg) throw new Error('Nome inválido.');
      const d = join(raiz, 'ia-local/agentes');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, `${nomeAg}.json`), JSON.stringify({ nome: nomeAg, especialidade: a.especialidade, missao: a.missao, itens_tr: a.itens_tr ?? '', criado_por: agente, criado_em: new Date().toISOString() }, null, 2));
      return `Agente "${nomeAg}" criado. Use delegar para entregar tarefas a ele.`;
    }
    case 'listar_agentes':
      return listarAgentes(raiz).map((g) => `- ${g.nome}: ${g.especialidade}${g.itens_tr ? ` (TR ${g.itens_tr})` : ''}`).join('\n') || 'Nenhum agente criado ainda.';
    case 'delegar':
      return ctx.delegar(String(a.agente ?? ''), String(a.tarefa ?? ''));
    default:
      return `Ferramenta desconhecida: ${nome}`;
  }
}

export function listarAgentes(raiz) {
  const d = join(raiz, 'ia-local/agentes');
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(readFileSync(join(d, n), 'utf8')));
}

export { limitar };
