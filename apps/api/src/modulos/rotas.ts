// Rotas específicas dos módulos (processos que vão além do cadastro genérico).
import type { FastifyInstance } from 'fastify';
import { rotasCadastros } from './cadastros/rotas.js';

export async function registrarRotasModulos(app: FastifyInstance) {
  await rotasCadastros(app);
}

/** Rotinas periódicas (lembretes, expiração de reservas, etc.). */
export function iniciarTarefasAgendadas() {}
