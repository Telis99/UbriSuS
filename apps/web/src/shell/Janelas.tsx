// Operação em múltiplas janelas na mesma sessão (TR 1.1.1.7): cada tela aberta vira
// uma aba que mantém seu estado ao alternar; qualquer aba pode ser destacada para
// uma janela própria do navegador e arrastada para outro monitor.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export interface Janela {
  chave: string;
  titulo: string;
}

interface CtxJanelas {
  janelas: Janela[];
  ativa: string;
  abrir: (caminho: string, titulo?: string) => void;
  fechar: (chave: string) => void;
  renomear: (chave: string, titulo: string) => void;
  destacar: (chave: string) => void;
}

const Ctx = createContext<CtxJanelas>(null as any);
const CHAVE_LOCAL = 'janelas_abertas';
export const emJanelaDestacada = () => new URLSearchParams(window.location.search).has('janela');

export function ProvedorJanelas({ children }: { children: ReactNode }) {
  const navegar = useNavigate();
  const local = useLocation();
  const ativa = local.pathname + local.search.replace(/[?&]janela=1/, '');
  const [janelas, setJanelas] = useState<Janela[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(CHAVE_LOCAL) ?? '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    sessionStorage.setItem(CHAVE_LOCAL, JSON.stringify(janelas));
  }, [janelas]);

  // Toda navegação abre (ou reativa) uma aba.
  useEffect(() => {
    if (ativa === '/' || emJanelaDestacada()) return;
    setJanelas((js) => (js.some((j) => j.chave === ativa) ? js : [...js, { chave: ativa, titulo: '...' }]));
  }, [ativa]);

  const abrir = useCallback(
    (caminho: string, titulo?: string) => {
      setJanelas((js) => (js.some((j) => j.chave === caminho) ? js : [...js, { chave: caminho, titulo: titulo ?? '...' }]));
      navegar(caminho);
    },
    [navegar],
  );

  const fechar = useCallback(
    (chave: string) => {
      setJanelas((js) => {
        const i = js.findIndex((j) => j.chave === chave);
        const resto = js.filter((j) => j.chave !== chave);
        if (chave === ativa) navegar(resto[Math.max(0, i - 1)]?.chave ?? '/');
        return resto;
      });
    },
    [ativa, navegar],
  );

  const renomear = useCallback((chave: string, titulo: string) => {
    setJanelas((js) => js.map((j) => (j.chave === chave && j.titulo !== titulo ? { ...j, titulo } : j)));
  }, []);

  const destacar = useCallback(
    (chave: string) => {
      const url = chave + (chave.includes('?') ? '&' : '?') + 'janela=1';
      window.open(url, '_blank', 'popup,width=1200,height=800');
      fechar(chave);
    },
    [fechar],
  );

  const valor = useMemo(() => ({ janelas, ativa, abrir, fechar, renomear, destacar }), [janelas, ativa, abrir, fechar, renomear, destacar]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useJanelas = () => useContext(Ctx);

/** Caminho da janela em que o componente está sendo exibido (abas mantidas vivas). */
export const JanelaAtual = createContext<string>('/');
export const useJanelaAtual = () => useContext(JanelaAtual);

/** Define o título da aba da janela atual. */
export function useTituloJanela(titulo: string | undefined) {
  const { renomear } = useJanelas();
  const alvo = useJanelaAtual();
  useEffect(() => {
    if (titulo) {
      renomear(alvo, titulo);
      if (emJanelaDestacada()) document.title = titulo;
    }
  }, [titulo, alvo, renomear]);
}
