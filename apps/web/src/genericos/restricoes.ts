// Tratamento das restrições de acesso a formulários: justificativa obrigatória para
// impressão/extração e liberação por supervisor (TR 1.1.1.33).
import { api, definirLiberacaoSupervisor, ErroApi } from '@/api';
import { pedirCredenciais, pedirTexto } from './dialogos';

export async function pedirJustificativaSeNecessario<T>(executar: (justificativa?: string) => Promise<T>, justificativa?: string): Promise<T | undefined> {
  try {
    return await executar(justificativa);
  } catch (e) {
    const err = e as ErroApi;
    if (err.status !== 428) throw e;
    if (err.detalhes?.exigeJustificativa) {
      const j = await pedirTexto('Justificativa obrigatória', 'Informe o motivo da impressão ou extração', { longo: true });
      if (!j) return undefined;
      return pedirJustificativaSeNecessario(executar, j);
    }
    if (err.detalhes?.exigeSupervisor) {
      const cred = await pedirCredenciais('Liberação do supervisor');
      if (!cred) return undefined;
      const r = await api.post('/api/supervisor/liberar', { ...cred, rotina: err.detalhes.rotina });
      definirLiberacaoSupervisor(r.token);
      try {
        return await executar(justificativa);
      } finally {
        definirLiberacaoSupervisor(null);
      }
    }
    throw e;
  }
}
