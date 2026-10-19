// Utilitários do aplicativo do cidadão: sessão, pessoa selecionada (titular ou dependente) e carregamento de dados.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Alert, Badge, Card, Center, Group, Loader, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api, ErroApi } from '@/api';

export interface Membro {
  id: number;
  nome: string;
  sexo: string;
  nascimento: string;
  parentesco: string | null;
  situacao: string;
  cns: string | null;
  titular: boolean;
}

export interface Sessao {
  conta: any;
  membros: Membro[];
  funcionalidades: Record<string, boolean>;
  naoLidas: number;
}

interface Contexto {
  sessao: Sessao | null;
  carregando: boolean;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
  pessoa: Membro | null;
  setPessoaId: (id: number) => void;
}

const Ctx = createContext<Contexto>(null as any);
export const useCidadao = () => useContext(Ctx);

export function ProvedorCidadao({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [pessoaId, setPessoaId] = useState<number | null>(null);
  const recarregar = useCallback(async () => {
    try {
      const s = await api.get<Sessao>('/api/cidadao/eu');
      setSessao(s);
    } catch {
      setSessao(null);
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    void recarregar();
  }, [recarregar]);
  const sair = useCallback(async () => {
    await api.post('/api/cidadao/sair').catch(() => {});
    setSessao(null);
    setPessoaId(null);
  }, []);
  const pessoa = sessao ? (sessao.membros.find((m) => m.id === pessoaId) ?? sessao.membros[0] ?? null) : null;
  return <Ctx.Provider value={{ sessao, carregando, recarregar, sair, pessoa, setPessoaId }}>{children}</Ctx.Provider>;
}

export const avisoErro = (e: unknown) => notifications.show({ color: 'red', title: 'Atenção', message: (e as Error).message });
export const avisoOk = (m: string) => notifications.show({ color: 'teal', message: m });
export const fmtData = (v?: string | null) => (v ? dayjs(String(v).slice(0, 10)).format('DD/MM/YYYY') : '');
export const fmtDataHora = (v?: string | null) => (v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '');
export const diaSemana = (v: string) => dayjs(v).format('dddd');
export const primeiroNome = (n?: string | null) => (n ?? '').split(' ')[0];

/** Carrega dados da API do cidadão; trata o bloqueio de integrantes em pré-cadastro (TR 1.2.41.6.3). */
export function useDados<T>(url: string | null, deps: unknown[] = []) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<ErroApi | null>(null);
  const [carregando, setCarregando] = useState(false);
  const carregar = useCallback(async () => {
    if (!url) return;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await api.get<T>(url));
    } catch (e) {
      setErro(e as ErroApi);
      setDados(null);
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  return { dados, erro, carregando, recarregar: carregar };
}

export function Estado({ erro, carregando, vazio, children }: { erro?: ErroApi | null; carregando?: boolean; vazio?: boolean; children?: ReactNode }) {
  if (carregando)
    return (
      <Center py="xl">
        <Loader size="sm" />
      </Center>
    );
  if (erro?.detalhes?.preCadastro)
    return (
      <Alert color="orange" icon={<IconAlertTriangle />} title="Cadastro aguardando validação">
        {erro.message}
      </Alert>
    );
  if (erro) return <Alert color="red">{erro.message}</Alert>;
  if (vazio)
    return (
      <Text c="dimmed" ta="center" py="md" size="sm">
        Nenhum registro encontrado.
      </Text>
    );
  return <>{children}</>;
}

export function Secao({ titulo, icone, children, extra }: { titulo: string; icone?: ReactNode; children: ReactNode; extra?: ReactNode }) {
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          {icone && (
            <ThemeIcon variant="light" size="md" radius="xl">
              {icone}
            </ThemeIcon>
          )}
          <Title order={4}>{titulo}</Title>
        </Group>
        {extra}
      </Group>
      {children}
    </Stack>
  );
}

export function Cartao({ children, onClick, cor }: { children: ReactNode; onClick?: () => void; cor?: string }) {
  return (
    <Card withBorder radius="md" padding="sm" onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined, borderLeft: cor ? `4px solid var(--mantine-color-${cor}-6)` : undefined }}>
      {children}
    </Card>
  );
}

const CORES: Record<string, string> = {
  AGENDADO: 'blue',
  SOLICITADO: 'yellow',
  CONFIRMADO: 'cyan',
  PRESENTE: 'teal',
  ATENDIDO: 'green',
  CANCELADO: 'gray',
  TRANSFERIDO: 'violet',
  FALTA: 'red',
  AGUARDANDO: 'blue',
  BLOQUEADO: 'red',
  REQUISITADO: 'gray',
  COLETADO: 'cyan',
  REALIZADO: 'green',
  AVALIADO: 'green',
};
const NOMES: Record<string, string> = {
  AGENDADO: 'Agendado',
  SOLICITADO: 'Aguardando confirmação',
  CONFIRMADO: 'Confirmado',
  PRESENTE: 'Na unidade',
  ATENDIDO: 'Realizado',
  CANCELADO: 'Cancelado',
  TRANSFERIDO: 'Transferido',
  FALTA: 'Falta',
  AGUARDANDO: 'Aguardando',
  BLOQUEADO: 'Bloqueado',
  REQUISITADO: 'Solicitado',
  COLETADO: 'Coletado',
  REALIZADO: 'Realizado',
  AVALIADO: 'Avaliado',
};
export const Etiqueta = ({ valor }: { valor?: string | null }) =>
  valor ? (
    <Badge size="sm" variant="light" color={CORES[valor] ?? 'gray'} style={{ flexShrink: 0 }}>
      {NOMES[valor] ?? valor.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  ) : null;

/** Abre documento PDF (carteira de vacinação, resultado de exame) em nova aba. */
export const abrirDocumento = (url: string) => window.open(url, '_blank', 'noopener');

export const PARENTESCOS: [string, string][] = [
  ['CONJUGE', 'Cônjuge / companheiro(a)'],
  ['FILHO', 'Filho(a)'],
  ['ENTEADO', 'Enteado(a)'],
  ['NETO', 'Neto(a) / bisneto(a)'],
  ['PAI_MAE', 'Pai / mãe'],
  ['SOGRO', 'Sogro(a)'],
  ['IRMAO', 'Irmão / irmã'],
  ['GENRO_NORA', 'Genro / nora'],
  ['OUTRO_PARENTE', 'Outro parente'],
  ['NAO_PARENTE', 'Não parente'],
];
export const nomeParentesco = (v?: string | null) => (v === 'RESPONSAVEL' ? 'Responsável familiar' : (PARENTESCOS.find(([k]) => k === v)?.[1] ?? 'Titular'));
