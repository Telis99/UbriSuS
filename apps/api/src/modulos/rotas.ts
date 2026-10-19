// Rotas específicas dos módulos (processos que vão além do cadastro genérico).
import type { FastifyInstance } from 'fastify';
import { rotasAgendamento, rotinaDiariaAgendamento } from './agendamento/rotas.js';
import { rotasAtendimento } from './atendimento/rotas.js';
import { rotasFarmacia } from './farmacia/rotas.js';
import { rotasImunizacao } from './imunizacao/rotas.js';
import { rotasCatalogo } from '../servicos/catalogo.js';
import { rotasCadastros } from './cadastros/rotas.js';
import { rotasSuporte } from './suporte/rotas.js';

export async function registrarRotasModulos(app: FastifyInstance) {
  await rotasCadastros(app);
  await rotasSuporte(app);
  await rotasAgendamento(app);
  await rotasAtendimento(app);
  await rotasFarmacia(app);
  await rotasImunizacao(app);
  await rotasCatalogo(app);
}

const tarefasDiarias: (() => Promise<unknown>)[] = [rotinaDiariaAgendamento];
export function registrarTarefaDiaria(fn: () => Promise<unknown>) {
  tarefasDiarias.push(fn);
}

/** Rotinas periódicas: geração de horários, lembretes e vencimentos (executadas na subida e a cada 6 horas). */
export function iniciarTarefasAgendadas() {
  const executar = async () => {
    for (const t of tarefasDiarias) await t().catch((e) => console.error('tarefa agendada:', e));
  };
  setTimeout(executar, 10_000).unref();
  setInterval(executar, 6 * 3_600_000).unref();
}
