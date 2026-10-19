// Estado do aplicativo do ACS: sessão, carga do território guardada no aparelho (cifrada), fila de
// registros coletados off-line e sincronização com o sistema de gestão (TR 1.2.49.1, 1.2.49.12).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ErroApi } from '@/api';
import { abrirCofreOffline, abrirCofreOnline, dadosDoCofre, fecharCofre, gravar, ler, novoUuid, sha256, trocarSenhaCofre } from './cofre';

export interface Carga {
  carga: { id: number; recebidaEm: string; responsavel: string; unidade: string; area: string; microarea: string; familias: number; pessoas: number; validade: string };
  familias: any[];
  pessoas: any[];
  especialidades: { id: number; nome: string }[];
  opcoes: { motivos: [string, string][]; desfechos: [string, string][]; tiposImovel: [string, string][]; parentesco: [string, string][]; sexo: [string, string][]; racaCor: [string, string][]; condicoesSaude: [string, string][]; deficiencias: [string, string][]; ficha: Record<string, { rotulo: string; tipo: string; aba?: string; opcoes: [string, string][] }> };
  hash: string;
  visitasLocais?: any[];
}

export type Pendencia =
  | { tipo: 'visita'; uuid: string; criadoEm: string; dados: any }
  | { tipo: 'pessoa'; uuid: string; criadoEm: string; id?: number | null; familiaId: number; versao?: string | null; dados: Record<string, any> }
  | { tipo: 'familia'; uuid: string; criadoEm: string; id: number; versao?: string | null; dados: Record<string, any> }
  | { tipo: 'solicitacao'; uuid: string; criadoEm: string; pessoaId?: number | null; pessoaUuid?: string | null; especialidadeId: number; justificativa: string };

interface Perfil {
  cpf: string;
  nome: string;
  unidade?: string;
  microarea?: string;
  area?: string;
}

interface Ctx {
  perfil: Perfil | null;
  online: boolean;
  carga: Carga | null;
  fila: Pendencia[];
  sincronizando: boolean;
  ultimaSincronizacao: string | null;
  mensagem: string | null;
  entrar: (cpf: string, senha: string, senhaAnterior?: string) => Promise<{ precisaTrocarSenha?: boolean; precisaSenhaAnterior?: boolean }>;
  sair: () => Promise<void>;
  trocarSenha: (atual: string, nova: string) => Promise<void>;
  receberCarga: () => Promise<void>;
  enviarCarga: (finalizar: boolean) => Promise<any>;
  cancelarCarga: (motivo: string) => Promise<void>;
  adicionar: (p: Pendencia, aplicar?: (c: Carga) => void) => Promise<void>;
}

const Contexto = createContext<Ctx>(null as any);
export const useAcs = () => useContext(Contexto);

// Credenciais mantidas apenas em memória enquanto o app está aberto, para renovar a sessão ao sincronizar.
let credenciais: { cpf: string; senha: string } | null = null;

/** Agrupa a fila em um lote: alterações do mesmo integrante/domicílio são mescladas. */
function montarRegistros(fila: Pendencia[]) {
  const familias = new Map<number, any>();
  const pessoas = new Map<string, any>();
  const visitas: any[] = [];
  const solicitacoes: any[] = [];
  for (const p of fila) {
    if (p.tipo === 'familia') {
      const a = familias.get(p.id);
      familias.set(p.id, { id: p.id, versao: a?.versao ?? p.versao ?? null, dados: { ...(a?.dados ?? {}), ...p.dados } });
    } else if (p.tipo === 'pessoa') {
      const chave = p.id ? `id:${p.id}` : `uuid:${p.uuid}`;
      const a = pessoas.get(chave);
      pessoas.set(chave, { uuid: a?.uuid ?? p.uuid, id: p.id ?? null, familiaId: p.familiaId, versao: a?.versao ?? p.versao ?? null, dados: { ...(a?.dados ?? {}), ...p.dados } });
    } else if (p.tipo === 'visita') visitas.push({ uuid: p.uuid, ...p.dados });
    else solicitacoes.push({ uuid: p.uuid, pessoaId: p.pessoaId ?? null, pessoaUuid: p.pessoaUuid ?? null, especialidadeId: p.especialidadeId, justificativa: p.justificativa });
  }
  return { familias: [...familias.values()], pessoas: [...pessoas.values()], visitas, solicitacoes };
}

export function ProvedorAcs({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [fila, setFila] = useState<Pendencia[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimaSincronizacao, setUltima] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const filaRef = useRef<Pendencia[]>([]);
  filaRef.current = fila;

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const carregarLocal = async () => {
    setCarga(await ler<Carga>('carga'));
    setFila((await ler<Pendencia[]>('fila')) ?? []);
    setUltima(await ler<string>('ultimaSincronizacao'));
  };

  const loginOnline = async (cpf: string, senha: string) => api.post<{ precisaTrocarSenha: boolean }>('/api/acs/login', { cpf, senha });

  /** Chamada à API renovando a sessão automaticamente (a sessão do servidor expira por inatividade). */
  const chamar = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401 && credenciais) {
        await loginOnline(credenciais.cpf, credenciais.senha);
        return fn();
      }
      throw e;
    }
  }, []);

  const entrar = async (cpf: string, senha: string, senhaAnterior?: string) => {
    let r: { precisaTrocarSenha?: boolean } = {};
    let modoOnline = navigator.onLine;
    if (modoOnline) {
      try {
        r = await loginOnline(cpf, senha);
      } catch (e) {
        // Sem resposta do servidor: segue para a identificação off-line.
        if (e instanceof ErroApi && e.status < 500) throw e;
        modoOnline = false;
      }
    }
    if (modoOnline) {
      const eu = await api.get<any>('/api/acs/eu');
      const res = await abrirCofreOnline(cpf, eu.operador.nome, senha, senhaAnterior);
      if (res === 'precisa-senha-anterior') return { precisaSenhaAnterior: true };
      const p: Perfil = { cpf, nome: eu.operador.nome, unidade: eu.acesso.unidade, microarea: eu.acesso.microarea, area: eu.acesso.area };
      await gravar('perfil', p);
      setPerfil(p);
    } else {
      await abrirCofreOffline(cpf, senha);
      setPerfil((await ler<Perfil>('perfil')) ?? { cpf, nome: (await dadosDoCofre())?.nome ?? cpf });
    }
    credenciais = { cpf, senha };
    await carregarLocal();
    return r;
  };

  const sair = async () => {
    if (navigator.onLine) await api.post('/api/acs/sair').catch(() => {});
    credenciais = null;
    fecharCofre();
    setPerfil(null);
    setCarga(null);
    setFila([]);
  };

  const trocarSenha = async (atual: string, nova: string) => {
    await chamar(() => api.post('/api/acs/trocar-senha', { senhaAtual: atual, novaSenha: nova }));
    await trocarSenhaCofre(atual, nova);
    if (credenciais) credenciais.senha = nova;
  };

  const persistirFila = async (f: Pendencia[]) => {
    await gravar('fila', f.length ? f : null);
    setFila(f);
  };

  /** Recebimento da carga do território (TR 1.2.49.12.1.1). */
  const receberCarga = async () => {
    if (filaRef.current.length) throw new Error('Envie os registros pendentes antes de receber uma nova carga.');
    const c = await chamar(() => api.post<Carga>('/api/acs/carga/receber'));
    const conferencia = await sha256(JSON.stringify({ familias: c.familias, pessoas: c.pessoas }));
    // Integridade da carga recebida conferida no aparelho (TR 1.2.49.10).
    if (conferencia !== c.hash) throw new Error('Falha de integridade na carga recebida. Tente novamente.');
    c.visitasLocais = [];
    await gravar('carga', c);
    setCarga(c);
    setMensagem(`Carga recebida: ${c.carga.familias} famílias e ${c.carga.pessoas} pessoas.`);
  };

  /** Envio dos registros (sincronização) e, opcionalmente, retorno da carga (TR 1.2.49.12.1.2). */
  const enviarCarga = async (finalizar: boolean) => {
    if (!carga) throw new Error('Nenhuma carga no aparelho.');
    setSincronizando(true);
    try {
      // O lote em envio é guardado: uma nova tentativa após falha de rede reenvia o mesmo lote (sem duplicar).
      let lote = await ler<{ loteUuid: string; registros: any; hash: string; quantidade: number }>('lote');
      if (!lote) {
        const registros = montarRegistros(filaRef.current);
        lote = { loteUuid: novoUuid(), registros, hash: await sha256(JSON.stringify(registros)), quantidade: filaRef.current.length };
        await gravar('lote', lote);
      }
      const r = await chamar(() => api.post<any>('/api/acs/carga/enviar', { loteUuid: lote!.loteUuid, cargaId: carga.carga.id, hash: lote!.hash, finalizar, registros: lote!.registros }));
      const restante = filaRef.current.slice(lote.quantidade);
      await gravar('lote', null);
      const agora = new Date().toISOString();
      await gravar('ultimaSincronizacao', agora);
      setUltima(agora);
      if (finalizar) {
        await gravar('carga', null);
        await persistirFila([]);
        setCarga(null);
      } else {
        // Integrantes incluídos no aparelho recebem o código definitivo do sistema.
        const novos: Record<string, number> = r.novosIds ?? {};
        const c = { ...carga, pessoas: carga.pessoas.map((p) => (p.uuid && novos[p.uuid] ? { ...p, id: novos[p.uuid], uuid: undefined, versao: agora } : p.alterado ? { ...p, alterado: false, versao: agora } : p)) };
        c.familias = c.familias.map((f) => (f.alterado ? { ...f, alterado: false, versao: agora } : f));
        c.visitasLocais = (c.visitasLocais ?? []).map((v) => ({ ...v, sincronizada: true }));
        await gravar('carga', c);
        setCarga(c);
        await persistirFila(restante.map((p) => (p.tipo === 'solicitacao' && p.pessoaUuid && novos[p.pessoaUuid] ? { ...p, pessoaId: novos[p.pessoaUuid], pessoaUuid: null } : p)));
      }
      setMensagem(`Sincronização concluída: ${r.visitas} visita(s), ${r.pessoas} integrante(s), ${r.familias} domicílio(s), ${r.solicitacoes} solicitação(ões)${r.conflitos?.length ? `, ${r.conflitos.length} conflito(s) para análise da unidade` : ''}.`);
      return r;
    } finally {
      setSincronizando(false);
    }
  };

  /** Cancelamento da carga pelo ACS (TR 1.2.49.12.1.3). */
  const cancelarCarga = async (motivo: string) => {
    if (!carga) return;
    await chamar(() => api.post('/api/acs/carga/cancelar', { cargaId: carga.carga.id, motivo }));
    await gravar('carga', null);
    await gravar('lote', null);
    await persistirFila([]);
    setCarga(null);
  };

  const adicionar = async (p: Pendencia, aplicar?: (c: Carga) => void) => {
    if (carga && aplicar) {
      const c: Carga = structuredClone(carga);
      aplicar(c);
      await gravar('carga', c);
      setCarga(c);
    }
    await persistirFila([...filaRef.current, p]);
  };

  return (
    <Contexto.Provider value={{ perfil, online, carga, fila, sincronizando, ultimaSincronizacao, mensagem, entrar, sair, trocarSenha, receberCarga, enviarCarga, cancelarCarga, adicionar }}>
      {children}
    </Contexto.Provider>
  );
}

export const agoraIso = () => new Date().toISOString();
export { novoUuid };
