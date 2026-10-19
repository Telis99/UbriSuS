// Cliente mínimo da API do Ollama (chat com ferramentas), sem dependências externas.

export async function verificarOllama(cfg) {
  try {
    const r = await fetch(`${cfg.ollamaUrl}/api/tags`);
    if (!r.ok) return { ok: false, erro: `Ollama respondeu ${r.status}` };
    const modelos = ((await r.json()).models ?? []).map((m) => m.name);
    return { ok: true, modelos };
  } catch (e) {
    return { ok: false, erro: `Ollama não encontrado em ${cfg.ollamaUrl} (${e.message}). Abra o Ollama e tente de novo.` };
  }
}

/**
 * Uma rodada de conversa. Devolve a mensagem do assistente ({ content, tool_calls }).
 * Modelos pequenos às vezes escrevem a chamada de ferramenta como JSON no texto: isso também é aceito.
 */
export async function conversar(cfg, modelo, mensagens, ferramentas) {
  const corpo = {
    model: modelo,
    messages: mensagens,
    stream: false,
    think: cfg.pensar,
    options: { num_ctx: cfg.contexto, temperature: cfg.temperatura },
  };
  if (ferramentas?.length) corpo.tools = ferramentas;
  let r = await fetch(`${cfg.ollamaUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  // Modelos sem suporte a "think" recusam o parâmetro: repete sem ele.
  if (r.status === 400) {
    delete corpo.think;
    r = await fetch(`${cfg.ollamaUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  }
  if (!r.ok) throw new Error(`Ollama: ${r.status} ${(await r.text()).slice(0, 300)}`);
  const msg = (await r.json()).message ?? { role: 'assistant', content: '' };
  if (!msg.tool_calls?.length) {
    const extraida = chamadaNoTexto(msg.content ?? '');
    if (extraida) msg.tool_calls = [extraida];
  }
  return msg;
}

function chamadaNoTexto(texto) {
  const m = texto.match(/\{[\s\S]*"(?:name|ferramenta)"[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const nome = j.name ?? j.ferramenta;
    const args = j.arguments ?? j.argumentos ?? j.parameters ?? {};
    return nome ? { function: { name: nome, arguments: typeof args === 'string' ? JSON.parse(args) : args } } : null;
  } catch {
    return null;
  }
}
