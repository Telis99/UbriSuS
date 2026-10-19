import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, definirAoExpirarSessao } from '@/api';
import type { Eu } from '@/tipos';

interface ContextoAuth {
  eu: Eu | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
  pode: (permissao: string, modulo?: string) => boolean;
}

const Ctx = createContext<ContextoAuth>(null as any);

export function ProvedorAuth({ children }: { children: ReactNode }) {
  const [eu, setEu] = useState<Eu | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    try {
      setEu(await api.get<Eu>('/api/auth/eu'));
    } catch {
      setEu(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    definirAoExpirarSessao(() => setEu(null));
    void recarregar();
  }, [recarregar]);

  const sair = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setEu(null);
  }, []);

  // Espelha a regra de permissões da API (rotina:acao, rotina:*, MODULO:acao, *).
  const pode = useCallback(
    (permissao: string, modulo?: string) => {
      if (!eu) return false;
      if (eu.administrador || eu.permissoes.includes('*') || eu.permissoes.includes(permissao)) return true;
      const [rotina, acao] = permissao.split(':');
      if (eu.permissoes.includes(`${rotina}:*`)) return true;
      return !!modulo && (eu.permissoes.includes(`${modulo}:${acao}`) || eu.permissoes.includes(`${modulo}:*`));
    },
    [eu],
  );

  return <Ctx.Provider value={{ eu, carregando, recarregar, sair, pode }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
