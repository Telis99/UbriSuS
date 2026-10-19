// Utilitários de tela compartilhados pelos módulos assistenciais.
import { useEffect, useRef, useState } from 'react';
import { Badge, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import { api, ErroApi } from '@/api';
import { CampoRef } from '@/genericos/campos';
import { confirmar } from '@/genericos/dialogos';

export const notificarErro = (e: unknown) => notifications.show({ color: 'red', title: 'Atenção', message: (e as Error).message });
export const notificarOk = (mensagem: string) => notifications.show({ color: 'teal', message: mensagem });

/** Seleção de registro de qualquer entidade com pesquisa (unidade, profissional, CID, procedimento...). */
export function SelecaoRef({
  entidade,
  rotulo,
  valor,
  aoMudar,
  filtro,
  obrigatorio,
  desabilitado,
}: {
  entidade: string;
  rotulo: string;
  valor: number | null | undefined;
  aoMudar: (v: number | null, rotulo?: string) => void;
  filtro?: Record<string, unknown>;
  obrigatorio?: boolean;
  desabilitado?: boolean;
}) {
  return <CampoRef campo={{ nome: entidade, tipo: 'ref', ref: entidade, rotulo, obrigatorio }} valor={valor ?? null} aoMudar={aoMudar} filtro={filtro} desabilitado={desabilitado} />;
}

/**
 * Executa uma operação que a API pode recusar com 409 pedindo confirmação de avisos
 * (agendamento em duplicidade, alergia, exames acima do limite) e repete após o aceite.
 */
export async function comConfirmacao<T>(executar: (confirmado: boolean) => Promise<T>, titulo = 'Confirmação'): Promise<T | undefined> {
  try {
    return await executar(false);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 409 && (e.detalhes?.exigeConfirmacao || e.detalhes?.alergias)) {
      if (await confirmar(titulo, e.message + ' Deseja continuar?', 'Continuar', true)) return executar(true);
      return undefined;
    }
    throw e;
  }
}

/** Abre um documento PDF gerado pela API em nova aba. */
export const abrirPdf = (url: string) => api.arquivo(url, undefined, 'abrir', 'GET').catch(notificarErro);

/** Recarrega periodicamente enquanto a tela estiver visível. */
export function useIntervalo(fn: () => void, ms: number, ativo = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => document.visibilityState === 'visible' && ref.current(), ms);
    return () => clearInterval(t);
  }, [ms, ativo]);
}

export function useCarregar<T>(fn: () => Promise<T>, deps: unknown[]): { dados: T | null; carregando: boolean; recarregar: () => Promise<void> } {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState(false);
  const recarregar = async () => {
    setCarregando(true);
    try {
      setDados(await fn());
    } catch (e) {
      notificarErro(e);
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => {
    void recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { dados, carregando, recarregar };
}

export const COR_RISCO: Record<string, string> = { VERMELHO: 'red', LARANJA: 'orange', AMARELO: 'yellow', VERDE: 'green', AZUL: 'blue' };
export const RISCOS: [string, string][] = [
  ['VERMELHO', 'Emergência'],
  ['LARANJA', 'Muito urgente'],
  ['AMARELO', 'Urgente'],
  ['VERDE', 'Pouco urgente'],
  ['AZUL', 'Não urgente'],
];

export const COR_SITUACAO: Record<string, string> = {
  AGENDADO: 'blue',
  CONFIRMADO: 'cyan',
  SOLICITADO: 'gray',
  PRESENTE: 'teal',
  REALIZADO: 'green',
  FALTA: 'red',
  ATRASO: 'orange',
  CANCELADO: 'gray',
  TRANSFERIDO: 'violet',
  NAO_ATENDIDO: 'red',
  AGUARDANDO: 'blue',
  AGUARDANDO_TRIAGEM: 'yellow',
  CHAMADO: 'cyan',
  EM_ATENDIMENTO: 'teal',
  EM_OBSERVACAO: 'grape',
  FINALIZADO: 'green',
  EVADIDO: 'red',
};

export const Situacao = ({ valor }: { valor?: string | null }) =>
  valor ? (
    <Badge component="span" size="sm" variant="light" color={COR_SITUACAO[valor] ?? 'gray'}>
      {valor.replace(/_/g, ' ')}
    </Badge>
  ) : null;

export const fmtData = (v?: string | null) => (v ? dayjs(v).format('DD/MM/YYYY') : '');
export const fmtDataHora = (v?: string | null) => (v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '');

/** Tabela simples para listagens curtas (históricos, itens). */
export function TabelaSimples<T extends Record<string, any>>({ colunas, linhas, vazio = 'Nenhum registro.' }: { colunas: { titulo: string; valor: (l: T) => React.ReactNode }[]; linhas: T[]; vazio?: string }) {
  if (!linhas.length)
    return (
      <Text size="sm" c="dimmed" p="xs">
        {vazio}
      </Text>
    );
  return (
    <Table striped highlightOnHover fz="xs" withTableBorder>
      <Table.Thead>
        <Table.Tr>
          {colunas.map((c) => (
            <Table.Th key={c.titulo}>{c.titulo}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {linhas.map((l, i) => (
          <Table.Tr key={l.id ?? i}>
            {colunas.map((c) => (
              <Table.Td key={c.titulo}>{c.valor(l)}</Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
