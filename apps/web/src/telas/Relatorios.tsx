// Central de relatórios por módulo: filtros declarados pela API, visualização em tela com gráfico
// e emissão em PDF/DOCX/XLSX/CSV/... com código de validação (TR 1.1.2.1.21, 1.1.1.62).
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Grid, Group, Menu, NavLink, NumberInput, Paper, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconChartLine, IconClockHour4, IconDownload, IconEye, IconPrinter } from '@tabler/icons-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useTituloJanela } from '@/shell/Janelas';
import { notificarErro, notificarOk, SelecaoRef } from '@/componentes/comum';
import { registrarTela } from './registro';

interface Filtro {
  nome: string;
  rotulo: string;
  tipo: 'data' | 'ref' | 'opcao' | 'texto' | 'inteiro' | 'booleano' | 'mes';
  ref?: string;
  opcoes?: [string, string][];
  obrigatorio?: boolean;
  padrao?: unknown;
}
interface Relatorio {
  id: string;
  modulo: string;
  grupo?: string;
  titulo: string;
  tr?: string[];
  filtros: Filtro[];
}
interface Coluna {
  campo: string;
  titulo: string;
  formato?: string;
}
interface Resultado {
  titulo: string;
  colunas: Coluna[];
  linhas: Record<string, any>[];
  grafico?: { tipo: 'linha' | 'barra'; x: string; y: string; serie?: string; dados?: Record<string, any>[] };
  filtrosTexto?: string[];
}

const NOMES_MODULO: Record<string, string> = { FAR: 'Farmácia', IMU: 'Imunização', FAT: 'Faturamento', AGE: 'Agendamento', AMB: 'Ambulatório', PEP: 'Prontuário', IND: 'Indicadores', TFD: 'TFD', TRA: 'Transporte', REG: 'Regulação', LAB: 'Laboratório' };
const CORES = ['#1c7ed6', '#e03131', '#2f9e44', '#f08c00', '#7048e8', '#0c8599', '#c2255c'];
const FORMATOS = ['pdf', 'xlsx', 'docx', 'csv', 'html', 'xml', 'txt', 'xls', 'doc'];

function valorPadrao(f: Filtro) {
  if (f.padrao === 'hoje') return dayjs().format('YYYY-MM-DD');
  if (f.padrao === 'inicio_mes') return dayjs().startOf('month').format('YYYY-MM-DD');
  return f.padrao;
}

function fmt(v: any, f?: string) {
  if (v == null || v === '') return '';
  switch (f) {
    case 'moeda':
      return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    case 'decimal':
      return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    case 'inteiro':
      return Number(v).toLocaleString('pt-BR');
    case 'percentual':
      return `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
    case 'data':
      return dayjs(v).format('DD/MM/YYYY');
    default:
      return String(v);
  }
}

function GraficoResultado({ r }: { r: Resultado }) {
  const g = r.grafico!;
  const { dados, series } = useMemo(() => {
    const fonte = g.dados ?? r.linhas;
    const series = g.serie ? [...new Set(fonte.map((l) => String(l[g.serie!])))] : [g.y];
    const mapa = new Map<string, Record<string, any>>();
    for (const l of fonte) {
      const x = String(l[g.x]);
      const o = mapa.get(x) ?? { x };
      const s = g.serie ? String(l[g.serie]) : g.y;
      o[s] = (o[s] ?? 0) + Number(l[g.y] ?? 0);
      mapa.set(x, o);
    }
    return { dados: [...mapa.values()].sort((a, b) => String(a.x).localeCompare(String(b.x))), series };
  }, [r, g]);
  const Grafico = g.tipo === 'barra' ? BarChart : LineChart;
  return (
    <div style={{ height: 280 }}>
      <ResponsiveContainer>
        <Grafico data={dados}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" fontSize={10} />
          <YAxis fontSize={10} />
          <Tooltip />
          <Legend />
          {series.map((s, i) => (g.tipo === 'barra' ? <Bar key={s} dataKey={s} fill={CORES[i % CORES.length]} /> : <Line key={s} dataKey={s} stroke={CORES[i % CORES.length]} connectNulls={false} dot />))}
        </Grafico>
      </ResponsiveContainer>
    </div>
  );
}

// Relatórios visualizados em tela (tabela e gráfico), gravados em arquivo no formato escolhido ou abertos em PDF
// para impressão na impressora selecionada no navegador; emissões longas seguem em segundo plano com aviso ao
// concluir (TR 1.1.2.1.15, 1.1.2.1.31).
function TelaRelatorios({ modulo, inicial }: { modulo: string; inicial?: string }) {
  useTituloJanela(`Relatórios - ${NOMES_MODULO[modulo] ?? modulo}`);
  const [lista, setLista] = useState<Relatorio[]>([]);
  const [sel, setSel] = useState<Relatorio | null>(null);
  const [filtros, setFiltros] = useState<Record<string, any>>({});
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [formato, setFormato] = useState('pdf');
  const [zebrado, setZebrado] = useState(true);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    api
      .get<Relatorio[]>('/api/catalogo-relatorios', { modulo })
      .then((r) => {
        setLista(r);
        const i = r.find((x) => x.id === inicial) ?? null;
        if (i) escolher(i);
      })
      .catch(notificarErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulo]);

  function escolher(r: Relatorio) {
    setSel(r);
    setResultado(null);
    setFiltros(Object.fromEntries(r.filtros.filter((f) => f.padrao !== undefined).map((f) => [f.nome, valorPadrao(f)])));
  }

  async function visualizar() {
    if (!sel) return;
    try {
      setResultado(await api.post(`/api/catalogo-relatorios/${sel.id}`, { filtros, formato: 'json' }));
    } catch (e) {
      notificarErro(e);
    }
  }
  async function emitir(segundoPlano = false) {
    if (!sel) return;
    try {
      if (segundoPlano) {
        await api.post(`/api/catalogo-relatorios/${sel.id}`, { filtros, formato, segundoPlano: true, zebrado });
        notificarOk('Relatório em emissão; você será notificado quando estiver pronto.');
      } else await api.arquivo(`/api/catalogo-relatorios/${sel.id}`, { filtros, formato, zebrado }, formato === 'pdf' ? 'abrir' : 'baixar');
    } catch (e) {
      notificarErro(e);
    }
  }

  const grupos = useMemo(() => {
    const m = new Map<string, Relatorio[]>();
    for (const r of lista.filter((x) => !busca || (x.titulo + (x.tr ?? []).join(' ')).toLowerCase().includes(busca.toLowerCase()))) m.set(r.grupo ?? 'Geral', [...(m.get(r.grupo ?? 'Geral') ?? []), r]);
    return [...m.entries()];
  }, [lista, busca]);

  const campo = (f: Filtro) => {
    const v = filtros[f.nome];
    const set = (x: any, rotulo?: string) => setFiltros({ ...filtros, [f.nome]: x, ...(rotulo ? { [`${f.nome}__rotulo`]: rotulo } : {}) });
    switch (f.tipo) {
      case 'data':
        return <DateInput label={f.rotulo} required={f.obrigatorio} valueFormat="DD/MM/YYYY" clearable value={v ? new Date(v + 'T12:00') : null} onChange={(d) => set(d ? dayjs(d).format('YYYY-MM-DD') : null)} />;
      case 'ref':
        return <SelecaoRef entidade={f.ref!} rotulo={f.rotulo} obrigatorio={f.obrigatorio} valor={v} aoMudar={(x, r) => set(x, r)} />;
      case 'opcao':
        return <Select label={f.rotulo} required={f.obrigatorio} clearable data={(f.opcoes ?? []).map(([value, label]) => ({ value, label }))} value={v ?? null} onChange={(x) => set(x)} />;
      case 'inteiro':
        return <NumberInput label={f.rotulo} required={f.obrigatorio} value={v ?? ''} onChange={(x) => set(x === '' ? null : Number(x))} />;
      case 'booleano':
        return <Checkbox mt="lg" label={f.rotulo} checked={v === true || v === 'true'} onChange={(e) => set(e.currentTarget.checked)} />;
      default:
        return <TextInput label={f.rotulo} required={f.obrigatorio} value={v ?? ''} onChange={(e) => set(e.currentTarget.value)} />;
    }
  };

  return (
    <Grid p="md" gutter="md">
      <Grid.Col span={{ base: 12, md: 4, lg: 3 }}>
        <Paper withBorder p="xs">
          <TextInput size="xs" placeholder="Buscar relatório ou item do TR" value={busca} onChange={(e) => setBusca(e.currentTarget.value)} mb="xs" />
          <ScrollArea h="calc(100vh - 220px)">
            {grupos.map(([g, rs]) => (
              <div key={g}>
                <Text size="xs" fw={700} c="dimmed" mt="xs" tt="uppercase">
                  {g}
                </Text>
                {rs.map((r) => (
                  <NavLink key={r.id} label={r.titulo} active={sel?.id === r.id} onClick={() => escolher(r)} styles={{ label: { fontSize: 13 } }} />
                ))}
              </div>
            ))}
          </ScrollArea>
        </Paper>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 8, lg: 9 }}>
        {sel ? (
          <Stack gap="sm">
            <Group justify="space-between">
              <Title order={4}>{sel.titulo}</Title>
              <Group gap={4}>
                {(sel.tr ?? []).map((t) => (
                  <Badge key={t} size="xs" variant="outline">
                    TR {t}
                  </Badge>
                ))}
              </Group>
            </Group>
            <Paper withBorder p="sm">
              <Grid gutter="xs">
                {sel.filtros.map((f) => (
                  <Grid.Col key={f.nome} span={{ base: 12, sm: 6, lg: 4 }}>
                    {campo(f)}
                  </Grid.Col>
                ))}
              </Grid>
              <Group mt="sm" justify="space-between">
                <Group gap="xs">
                  <Button leftSection={<IconEye size={16} />} variant="light" onClick={() => void visualizar()}>
                    Visualizar
                  </Button>
                  <Select w={110} data={FORMATOS.map((x) => ({ value: x, label: x.toUpperCase() }))} value={formato} onChange={(v) => setFormato(v ?? 'pdf')} />
                  <Button leftSection={formato === 'pdf' ? <IconPrinter size={16} /> : <IconDownload size={16} />} onClick={() => void emitir()}>
                    {formato === 'pdf' ? 'Imprimir' : 'Exportar'}
                  </Button>
                  <Menu>
                    <Menu.Target>
                      <Button variant="subtle" leftSection={<IconClockHour4 size={16} />}>
                        Mais
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => void emitir(true)}>Emitir em segundo plano</Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
                <Checkbox label="Linhas zebradas" checked={zebrado} onChange={(e) => setZebrado(e.currentTarget.checked)} />
              </Group>
            </Paper>
            {resultado && (
              <Paper withBorder p="sm">
                {resultado.filtrosTexto?.map((t) => (
                  <Text key={t} size="sm">
                    {t}
                  </Text>
                ))}
                {resultado.grafico && resultado.linhas.length > 0 && (
                  <>
                    <Group gap={4} mt="xs">
                      <IconChartLine size={16} />
                      <Text size="sm" fw={600}>
                        Gráfico
                      </Text>
                    </Group>
                    <GraficoResultado r={resultado} />
                  </>
                )}
                <Text size="xs" c="dimmed" my="xs">
                  {resultado.linhas.length} registro(s)
                </Text>
                <ScrollArea h={420}>
                  <Table striped highlightOnHover fz="xs" withTableBorder stickyHeader>
                    <Table.Thead>
                      <Table.Tr>
                        {resultado.colunas.map((c) => (
                          <Table.Th key={c.campo}>{c.titulo}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {resultado.linhas.slice(0, 1000).map((l, i) => (
                        <Table.Tr key={i}>
                          {resultado.colunas.map((c) => (
                            <Table.Td key={c.campo} ta={['moeda', 'decimal', 'inteiro', 'percentual'].includes(c.formato ?? '') ? 'right' : undefined}>
                              {fmt(l[c.campo], c.formato)}
                            </Table.Td>
                          ))}
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Paper>
            )}
          </Stack>
        ) : (
          <Text c="dimmed" p="md">
            Selecione um relatório na lista.
          </Text>
        )}
      </Grid.Col>
    </Grid>
  );
}

registrarTela({
  id: 'relatorios-modulo',
  titulo: 'Relatórios',
  padrao: '/t/relatorios/:modulo',
  render: ({ params, query }) => <TelaRelatorios modulo={params.modulo} inicial={query.get('r') ?? undefined} />,
});

/** Entrada de menu "Relatórios" para cada módulo com relatórios no catálogo. */
export function registrarMenuRelatorios(modulo: string, menu: string, permissao?: string) {
  registrarTela({ id: `relatorios-${modulo}`, titulo: 'Relatórios', menu, padrao: `/t/relatorios/${modulo}`, permissao, modulo, ordem: 90, palavras: ['relatório', 'imprimir', 'exportar'], render: () => <TelaRelatorios modulo={modulo} /> });
}
