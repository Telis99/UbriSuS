// Reconhecimento de voz "Speech to Text" em português para ditar textos em qualquer
// campo de texto do sistema (TR 1.1.2.1.59). Usa a Web Speech API do navegador.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconMicrophone, IconMicrophoneOff } from '@tabler/icons-react';

type Reconhecedor = any;
const Construtor: (new () => Reconhecedor) | undefined =
  typeof window !== 'undefined' ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : undefined;

export const ditadoDisponivel = !!Construtor;

/** Campos que aceitam ditado: textos livres; números, datas, booleanos etc. são exceção (TR 1.1.2.1.59.1). */
function campoAceitaDitado(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return ['text', 'search', ''].includes(el.type) && !el.readOnly && !el.disabled && el.dataset.semDitado === undefined && el.inputMode !== 'numeric';
  }
  return (el as HTMLElement).isContentEditable;
}

/** Insere texto no campo na posição do cursor e notifica o React. */
function inserirTexto(el: HTMLInputElement | HTMLTextAreaElement, texto: string) {
  const inicio = el.selectionStart ?? el.value.length;
  const fim = el.selectionEnd ?? el.value.length;
  const antes = el.value.slice(0, inicio);
  const espaco = antes && !/\s$/.test(antes) ? ' ' : '';
  let novo = antes + espaco + texto + el.value.slice(fim);
  if (el.maxLength > 0) novo = novo.slice(0, el.maxLength);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, novo);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const pos = (antes + espaco + texto).length;
  el.setSelectionRange(pos, pos);
}

interface CtxDitado {
  ouvindo: boolean;
  alternar: (alvo?: HTMLInputElement | HTMLTextAreaElement | null) => void;
}
const Ctx = createContext<CtxDitado>({ ouvindo: false, alternar: () => {} });

export function ProvedorDitado({ children }: { children: ReactNode }) {
  const [ouvindo, setOuvindo] = useState(false);
  const rec = useRef<Reconhecedor | null>(null);
  const alvo = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const ultimoFoco = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const aoFocar = (e: FocusEvent) => {
      if (campoAceitaDitado(e.target as Element)) ultimoFoco.current = e.target as HTMLInputElement;
    };
    document.addEventListener('focusin', aoFocar);
    return () => document.removeEventListener('focusin', aoFocar);
  }, []);

  const parar = useCallback(() => {
    rec.current?.stop();
    rec.current = null;
    setOuvindo(false);
  }, []);

  const alternar = useCallback(
    (campo?: HTMLInputElement | HTMLTextAreaElement | null) => {
      if (ouvindo) return parar();
      if (!Construtor) {
        notifications.show({ color: 'yellow', message: 'O navegador não oferece reconhecimento de voz. Use Chrome, Edge ou Safari atualizados.' });
        return;
      }
      const destino = campo ?? (campoAceitaDitado(document.activeElement) ? (document.activeElement as HTMLInputElement) : ultimoFoco.current);
      if (!destino) {
        notifications.show({ message: 'Clique no campo de texto onde deseja ditar e acione o microfone.' });
        return;
      }
      alvo.current = destino;
      const r = new Construtor();
      r.lang = 'pt-BR';
      r.continuous = true;
      r.interimResults = false;
      r.onresult = (ev: any) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal && alvo.current) inserirTexto(alvo.current, ev.results[i][0].transcript.trim());
        }
      };
      r.onerror = (ev: any) => {
        if (ev.error !== 'no-speech') notifications.show({ color: 'red', message: `Reconhecimento de voz: ${ev.error}` });
        parar();
      };
      r.onend = () => setOuvindo(false);
      r.start();
      rec.current = r;
      destino.focus();
      setOuvindo(true);
    },
    [ouvindo, parar],
  );

  // Atalho: Ctrl+Shift+Espaço inicia/encerra o ditado no campo em foco.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        alternar();
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [alternar]);

  return <Ctx.Provider value={{ ouvindo, alternar }}>{children}</Ctx.Provider>;
}

export const useDitado = () => useContext(Ctx);

/** Botão de microfone global (cabeçalho) ou de um campo específico. */
export function BotaoDitado({ alvo, tamanho = 'md' }: { alvo?: () => HTMLInputElement | HTMLTextAreaElement | null; tamanho?: 'xs' | 'sm' | 'md' }) {
  const { ouvindo, alternar } = useDitado();
  return (
    <Tooltip label={ouvindo ? 'Parar ditado' : 'Ditar texto por voz (Ctrl+Shift+Espaço)'}>
      <ActionIcon
        variant={ouvindo ? 'filled' : 'subtle'}
        color={ouvindo ? 'red' : 'gray'}
        size={tamanho}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => alternar(alvo?.())}
        aria-label="Ditado por voz"
      >
        {ouvindo ? <IconMicrophoneOff size={16} /> : <IconMicrophone size={16} />}
      </ActionIcon>
    </Tooltip>
  );
}
