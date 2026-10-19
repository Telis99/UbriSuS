// Componentes compartilhados das telas do laboratório: situação dos exames, formulário de resultado
// gerado pelo layout do exame (variáveis, referências e alertas) e utilitários de impressão.
import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Autocomplete, Badge, Group, Menu, Select, Stack, Table, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertTriangle, IconListDetails } from '@tabler/icons-react';
import { api } from '@/api';
import { notificarErro } from '@/componentes/comum';

export const SITUACAO_ITEM: Record<string, { rotulo: string; cor: string }> = {
  AGUARDANDO_COLETA: { rotulo: 'Aguardando coleta', cor: 'gray' },
  COLETADO: { rotulo: 'Coletado', cor: 'blue' },
  EM_ANALISE: { rotulo: 'Em análise', cor: 'cyan' },
  DIGITADO_PARCIAL: { rotulo: 'Digitado parcial', cor: 'yellow' },
  DIGITADO: { rotulo: 'Digitado', cor: 'orange' },
  LIBERADO: { rotulo: 'Liberado', cor: 'green' },
  CANCELADO: { rotulo: 'Cancelado', cor: 'dark' },
};
export const SITUACAO_REQ: Record<string, { rotulo: string; cor: string }> = {
  RECEBIDA: { rotulo: 'Recebida', cor: 'gray' },
  COLETA_PARCIAL: { rotulo: 'Coleta parcial', cor: 'yellow' },
  COLETADA: { rotulo: 'Coletada', cor: 'blue' },
  LIBERADA_PARCIAL: { rotulo: 'Liberada parcial', cor: 'lime' },
  LIBERADA: { rotulo: 'Liberada', cor: 'green' },
  ENTREGUE: { rotulo: 'Entregue', cor: 'teal' },
  NAO_RETIRADA: { rotulo: 'Não retirada', cor: 'red' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'dark' },
};

export const SituacaoItem = ({ valor }: { valor: string }) => (
  <Badge size="xs" variant="light" color={SITUACAO_ITEM[valor]?.cor ?? 'gray'}>
    {SITUACAO_ITEM[valor]?.rotulo ?? valor}
  </Badge>
);
export const SituacaoReq = ({ valor }: { valor: string }) => (
  <Badge size="sm" variant="light" color={SITUACAO_REQ[valor]?.cor ?? 'gray'}>
    {SITUACAO_REQ[valor]?.rotulo ?? valor}
  </Badge>
);

/** Abre em nova aba um PDF gerado por POST. */
export const pdfPost = (url: string, corpo: unknown) => api.arquivo(url, corpo, 'abrir', 'POST').catch(notificarErro);

/** Converte um arquivo de imagem em data URI (imagens nos modelos HTML). */
export const lerComoDataUri = (f: File) =>
  new Promise<string>((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = erro;
    r.readAsDataURL(f);
  });

export interface Variavel {
  id: number;
  codigo: string;
  rotulo: string;
  tipo: string;
  unidade_medida: string | null;
  casas_decimais: number | null;
  opcoes: string | null;
  formula: string | null;
  valor_padrao: string | null;
  obrigatoria: boolean;
  permite_alterar_rotulo: boolean;
  permite_alterar_valor: boolean;
  recuo: number | null;
  negrito: boolean;
  referencia_texto?: string;
}
export interface Avaliacao {
  valores: Record<string, any>;
  alertas: { codigo: string; rotulo: string; tipo: string; sinal?: string; mensagem: string }[];
  pendentes: string[];
  sinais: Record<string, string | null>;
}

const COR_SINAL: Record<string, string> = { BAIXO: 'orange', ALTO: 'orange', CRITICO_BAIXO: 'red', CRITICO_ALTO: 'red', ALTERADO: 'orange', NORMAL: 'teal' };
const ROTULO_SINAL: Record<string, string> = { BAIXO: '↓ baixo', ALTO: '↑ alto', CRITICO_BAIXO: '↓↓ crítico', CRITICO_ALTO: '↑↑ crítico', ALTERADO: 'alterado', NORMAL: 'normal' };

const fmt = (v: any, casas: number | null) => (v === null || v === undefined || v === '' ? '' : typeof v === 'number' ? v.toLocaleString('pt-BR', { minimumFractionDigits: casas ?? 0, maximumFractionDigits: casas ?? 2 }) : String(v));

/** Avaliação em tempo real (fórmulas, referências e Delta-Check) com atraso de digitação (TR 1.2.47.43.47, 1.2.47.43.56). */
export function useAvaliacao(url: string | null, valores: Record<string, any>, extras: Record<string, unknown> = {}) {
  const [aval, setAval] = useState<Avaliacao | null>(null);
  const [debounced] = useDebouncedValue(valores, 350);
  const chaveExtras = JSON.stringify(extras);
  useEffect(() => {
    if (!url) return;
    api.post<Avaliacao>(url, { valores: debounced, ...extras }).then(setAval).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, debounced, chaveExtras]);
  return aval;
}

/**
 * Formulário de resultado conforme as variáveis do exame: texto, texto longo, numérico, lista
 * e cálculo, com a referência do paciente e o alerta de valor fora da referência (TR 1.2.47.43.46).
 */
export function FormResultado({
  layout,
  valores,
  rotulos,
  aoMudar,
  aoMudarRotulo,
  avaliacao,
  bloqueado,
  predefinidos = [],
  aoConcluir,
}: {
  layout: Variavel[];
  valores: Record<string, any>;
  rotulos: Record<string, string>;
  aoMudar: (codigo: string, v: any) => void;
  aoMudarRotulo?: (codigo: string, v: string) => void;
  avaliacao: Avaliacao | null;
  bloqueado?: boolean;
  predefinidos?: { id: number; variavel_codigo: string | null; texto: string }[];
  aoConcluir?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const iniciado = Object.values(valores).some((x) => x !== null && x !== undefined && x !== '');
  // Enter avança para o próximo campo; no último, conclui (digitação sequencial).
  const proximo = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'Enter' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    e.preventDefault();
    const campos = ref.current?.querySelectorAll<HTMLInputElement>('[data-campo]');
    const lista = campos ? Array.from(campos) : [];
    const atual = lista.findIndex((c) => Number(c.dataset.campo) === idx);
    if (atual >= 0 && atual < lista.length - 1) lista[atual + 1].focus();
    else aoConcluir?.();
  };
  return (
    <div ref={ref}>
      <Table fz="sm" verticalSpacing={4} withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Exame</Table.Th>
            <Table.Th w={260}>Resultado</Table.Th>
            <Table.Th>Referência</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {layout.map((v, idx) => {
            const rot = rotulos[v.codigo] ?? v.rotulo;
            const pad = (v.recuo ?? 0) * 14;
            if (v.tipo === 'TITULO')
              return (
                <Table.Tr key={v.codigo}>
                  <Table.Td colSpan={3} pl={pad + 8}>
                    <Text fw={700} size="sm">
                      {rot}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            const sinal = avaliacao?.sinais?.[v.codigo];
            const pendente = avaliacao?.pendentes?.includes(v.codigo);
            const calculado = v.tipo === 'CALCULO' && !v.permite_alterar_valor;
            const valor = calculado ? fmt(avaliacao?.valores?.[v.codigo] ?? valores[v.codigo], v.casas_decimais) : (valores[v.codigo] ?? '');
            const comum = { size: 'xs' as const, disabled: bloqueado, 'data-campo': idx, onKeyDown: (e: React.KeyboardEvent) => proximo(e, idx), error: pendente && iniciado && !bloqueado ? ' ' : undefined };
            const textos = predefinidos.filter((p) => !p.variavel_codigo || p.variavel_codigo === v.codigo);
            let entrada: React.ReactNode;
            if (v.tipo === 'TEXTO_LONGO') entrada = <Textarea {...comum} autosize minRows={2} value={valor} onChange={(e) => aoMudar(v.codigo, e.currentTarget.value)} />;
            else if (v.tipo === 'LISTA') {
              const ops = (v.opcoes ?? '').split(';').map((o) => o.trim()).filter(Boolean);
              entrada = v.permite_alterar_valor ? (
                <Autocomplete {...comum} data={ops} value={valor} onChange={(x) => aoMudar(v.codigo, x)} />
              ) : (
                <Select {...comum} data={ops} value={valor || null} onChange={(x) => aoMudar(v.codigo, x ?? '')} searchable clearable />
              );
            } else
              entrada = (
                <TextInput
                  {...comum}
                  inputMode={v.tipo === 'NUMERICO' || v.tipo === 'CALCULO' ? 'decimal' : undefined}
                  readOnly={calculado}
                  variant={calculado ? 'filled' : 'default'}
                  value={valor}
                  onChange={(e) => aoMudar(v.codigo, e.currentTarget.value)}
                  rightSection={v.unidade_medida ? <Text size="10px" c="dimmed" pr={4}>{v.unidade_medida}</Text> : undefined}
                  rightSectionWidth={v.unidade_medida ? Math.min(90, 12 + v.unidade_medida.length * 6) : undefined}
                  title={calculado ? `Calculado: ${v.formula}` : undefined}
                />
              );
            return (
              <Table.Tr key={v.codigo}>
                <Table.Td pl={pad + 8}>
                  {v.permite_alterar_rotulo && aoMudarRotulo && !bloqueado ? (
                    <TextInput size="xs" variant="unstyled" value={rot} onChange={(e) => aoMudarRotulo(v.codigo, e.currentTarget.value)} title="Texto da linha editável (TR 1.2.47.6.1)" />
                  ) : (
                    <Text size="sm" fw={v.negrito ? 700 : 400}>
                      {rot}
                      {v.obrigatoria ? '' : <Text span size="xs" c="dimmed"> (opcional)</Text>}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <div style={{ flex: 1 }}>{entrada}</div>
                    {!!textos.length && (v.tipo === 'TEXTO' || v.tipo === 'TEXTO_LONGO') && !bloqueado && (
                      <Menu>
                        <Menu.Target>
                          <Tooltip label="Resultados pré-definidos">
                            <ActionIcon variant="subtle" size="sm">
                              <IconListDetails size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {textos.map((t) => (
                            <Menu.Item key={t.id} onClick={() => aoMudar(v.codigo, v.tipo === 'TEXTO_LONGO' && valores[v.codigo] ? `${valores[v.codigo]}\n${t.texto}` : t.texto)}>
                              <Text size="xs">{t.texto}</Text>
                            </Menu.Item>
                          ))}
                        </Menu.Dropdown>
                      </Menu>
                    )}
                    {sinal && sinal !== 'NORMAL' && (
                      <Badge size="xs" color={COR_SINAL[sinal]} variant="filled">
                        {ROTULO_SINAL[sinal]}
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {v.referencia_texto}
                  </Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </div>
  );
}

export function ListaAlertas({ avaliacao }: { avaliacao: Avaliacao | null }) {
  if (!avaliacao?.alertas?.length) return null;
  return (
    <Stack gap={4}>
      {avaliacao.alertas.map((a, i) => (
        <Alert key={i} py={4} color={a.tipo === 'CRITICO' ? 'red' : a.tipo === 'DELTA' ? 'grape' : a.tipo === 'EQUIPAMENTO' ? 'blue' : 'orange'} icon={<IconAlertTriangle size={16} />}>
          <Text size="xs">{a.mensagem}</Text>
        </Alert>
      ))}
    </Stack>
  );
}
