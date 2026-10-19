// Painel de indicadores de gestão da saúde (TR 1.2.14): séries mensais comparando anos, rankings,
// tempo para agendamento, pirâmide etária, cobertura vacinal e contadores do período.
import { useEffect, useMemo, useState } from 'react';
import { Grid, Group, MultiSelect, NumberInput, Paper, SegmentedControl, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useTituloJanela } from '@/shell/Janelas';
import { notificarErro } from '@/componentes/comum';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const CORES = ['#1c7ed6', '#e03131', '#2f9e44', '#f08c00', '#7048e8', '#0c8599', '#c2255c'];
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function useDados<T>(url: string, params: Record<string, unknown>) {
  const [dados, setDados] = useState<T | null>(null);
  const chave = JSON.stringify(params);
  useEffect(() => {
    api.get<T>(url, params).then(setDados).catch(notificarErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, chave]);
  return dados;
}

function Cartao({ titulo, children, altura = 260 }: { titulo: string; children: React.ReactNode; altura?: number }) {
  return (
    <Paper withBorder p="sm">
      <Text size="sm" fw={600} mb={4}>
        {titulo}
      </Text>
      <div style={{ height: altura }}>
        <ResponsiveContainer>{children as any}</ResponsiveContainer>
      </div>
    </Paper>
  );
}

/** Série mensal com uma linha por ano para comparação entre os meses. */
function SerieAnual({ titulo, tipo, anos }: { titulo: string; tipo: string; anos: [number, number] }) {
  const linhas = useDados<{ ano: number; mes: number; total: string }[]>(`/api/indicadores/serie/${tipo}`, { anoInicial: anos[0], anoFinal: anos[1] });
  const { dados, series } = useMemo(() => {
    const series = [...new Set((linhas ?? []).map((l) => String(l.ano)))];
    const dados = MESES.map((m, i) => Object.fromEntries([['mes', m], ...series.map((s) => [s, Number((linhas ?? []).find((l) => String(l.ano) === s && l.mes === i + 1)?.total ?? 0) || null])]));
    return { dados, series };
  }, [linhas]);
  return (
    <Cartao titulo={titulo}>
      <LineChart data={dados}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="mes" fontSize={10} />
        <YAxis fontSize={10} />
        <Tooltip />
        <Legend />
        {series.map((s, i) => (
          <Line key={s} dataKey={s} stroke={CORES[i % CORES.length]} dot connectNulls={false} />
        ))}
      </LineChart>
    </Cartao>
  );
}

function TelaIndicadores() {
  useTituloJanela('Indicadores de gestão');
  const [aba, setAba] = useState('assistencia');
  const [anos, setAnos] = useState<[number, number]>([dayjs().year() - 1, dayjs().year()]);
  const [periodo, setPeriodo] = useState<[string, string]>([dayjs().startOf('month').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD')]);
  const [competencia, setCompetencia] = useState(dayjs().format('YYYYMM'));
  const [limite, setLimite] = useState(10);
  const [produtos, setProdutos] = useState<string[]>([]);
  const [imunos, setImunos] = useState<string[]>([]);
  const [opcoesProdutos, setOpcoesProdutos] = useState<{ value: string; label: string }[]>([]);
  const [opcoesImunos, setOpcoesImunos] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    api.get('/api/e/produto/opcoes', { q: '' }).then((r: any[]) => setOpcoesProdutos(r.map((x) => ({ value: String(x.id), label: x.rotulo })))).catch(() => {});
    api.get('/api/e/imunobiologico/opcoes', { q: '' }).then((r: any[]) => setOpcoesImunos(r.map((x) => ({ value: String(x.id), label: x.rotulo })))).catch(() => {});
  }, []);

  const contadores = useDados<Record<string, number>>('/api/indicadores/contadores', { de: periodo[0], ate: periodo[1] });
  const dias = useDados<any[]>('/api/indicadores/dias-agendamento', {});
  const faixas = useDados<any[]>('/api/indicadores/pacientes-faixa', {});
  const cobertura = useDados<any[]>('/api/indicadores/cobertura-vacinal', { anoInicial: anos[0], anoFinal: anos[1], imunobiologicos: imunos.join(',') });
  const demanda = useDados<any[]>('/api/indicadores/demanda-reprimida', { competencia, limite });
  const movimentacao = useDados<any[]>('/api/indicadores/movimentacao', { competencia, limite });
  const prodAnual = useDados<any[]>('/api/indicadores/produtos-anual', { anoInicial: anos[0], anoFinal: anos[1], produtos: produtos.join(',') });

  const coberturaGrafico = useMemo(() => {
    const siglas = [...new Set((cobertura ?? []).map((c) => c.sigla))];
    return { siglas, dados: [...new Set((cobertura ?? []).map((c) => c.ano))].map((ano) => Object.fromEntries([['ano', String(ano)], ...siglas.map((s) => [s, (cobertura ?? []).find((c) => c.ano === ano && c.sigla === s)?.cobertura ?? 0])])) };
  }, [cobertura]);
  const prodGrafico = useMemo(() => {
    const nomes = [...new Set((prodAnual ?? []).map((p) => p.produto))];
    return { nomes, dados: [...new Set((prodAnual ?? []).map((p) => p.ano))].map((ano) => Object.fromEntries([['ano', String(ano)], ...nomes.map((nm) => [nm, Number((prodAnual ?? []).find((p) => p.ano === ano && p.produto === nm)?.total ?? 0)])])) };
  }, [prodAnual]);

  const CONTADORES: [string, string][] = [
    ['consultas_basica', 'Consultas na atenção básica'],
    ['perdidas_basica', 'Consultas perdidas (atenção básica)'],
    ['consultas_especializada', 'Consultas na atenção especializada'],
    ['perdidas_especializada', 'Consultas perdidas (especializada)'],
    ['atendimentos_domiciliares', 'Atendimentos domiciliares'],
    ['visitas_acs', 'Visitas dos ACS'],
    ['procedimentos_odontologicos', 'Procedimentos odontológicos'],
    ['procedimentos_enfermagem', 'Procedimentos de enfermagem'],
    ['exames_solicitados', 'Exames solicitados'],
    ['vacinas_aplicadas', 'Vacinas aplicadas'],
  ];

  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Indicadores de gestão da saúde</Title>
        <SegmentedControl
          size="xs"
          value={aba}
          onChange={setAba}
          data={[
            { value: 'assistencia', label: 'Assistência' },
            { value: 'farmacia', label: 'Assistência farmacêutica' },
            { value: 'populacao', label: 'População e vacinação' },
          ]}
        />
      </Group>
      <Paper withBorder p="xs">
        <Group gap="xs" align="flex-end">
          <NumberInput size="xs" label="Ano inicial" w={110} value={anos[0]} onChange={(v) => setAnos([Number(v) || anos[0], anos[1]])} />
          <NumberInput size="xs" label="Ano final" w={110} value={anos[1]} onChange={(v) => setAnos([anos[0], Number(v) || anos[1]])} />
          <DateInput size="xs" label="Período de" w={130} valueFormat="DD/MM/YYYY" value={new Date(periodo[0] + 'T12:00')} onChange={(d) => d && setPeriodo([dayjs(d).format('YYYY-MM-DD'), periodo[1]])} />
          <DateInput size="xs" label="até" w={130} valueFormat="DD/MM/YYYY" value={new Date(periodo[1] + 'T12:00')} onChange={(d) => d && setPeriodo([periodo[0], dayjs(d).format('YYYY-MM-DD')])} />
          {aba === 'farmacia' && (
            <>
              <TextInput size="xs" label="Competência" w={100} value={competencia} onChange={(e) => setCompetencia(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} />
              <NumberInput size="xs" label="Nº de produtos" w={110} min={3} max={50} value={limite} onChange={(v) => setLimite(Number(v) || 10)} />
            </>
          )}
        </Group>
      </Paper>

      {aba === 'assistencia' && (
        <>
          <SimpleGrid cols={{ base: 2, md: 5 }} spacing="xs">
            {CONTADORES.map(([k, r]) => (
              <Paper key={k} withBorder p="sm">
                <Text size="xs" c="dimmed" lineClamp={2} h={32}>
                  {r}
                </Text>
                <Text fz={26} fw={700}>
                  {(contadores?.[k] ?? 0).toLocaleString('pt-BR')}
                </Text>
              </Paper>
            ))}
          </SimpleGrid>
          <Grid gutter="sm">
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <SerieAnual titulo="Consultas médicas agendadas por mês" tipo="consultas_medicas" anos={anos} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <SerieAnual titulo="Consultas odontológicas agendadas por mês" tipo="consultas_odonto" anos={anos} />
            </Grid.Col>
            <Grid.Col span={12}>
              <Cartao titulo="Dias necessários para conseguir vaga por especialidade (eletiva x urgência)" altura={300}>
                <BarChart data={(dias ?? []).map((d) => ({ ...d, eletiva: d.eletiva ?? 0, urgencia: d.urgencia ?? 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="especialidade" fontSize={9} interval={0} angle={-15} textAnchor="end" height={60} />
                  <YAxis fontSize={10} label={{ value: 'dias', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="eletiva" name="Eletiva" fill="#1c7ed6" />
                  <Bar dataKey="urgencia" name="Urgência" fill="#f08c00" />
                </BarChart>
              </Cartao>
            </Grid.Col>
          </Grid>
        </>
      )}

      {aba === 'farmacia' && (
        <Grid gutter="sm">
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <SerieAnual titulo="Dispensações de medicamentos (quantidade) por mês" tipo="dispensacoes" anos={anos} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <SerieAnual titulo="Atendimentos farmacêuticos por mês" tipo="atendimentos_farmacia" anos={anos} />
          </Grid.Col>
          <Grid.Col span={12}>
            <MultiSelect size="xs" label="Produtos para comparação anual (vazio = 5 mais dispensados)" data={opcoesProdutos} value={produtos} onChange={setProdutos} searchable clearable />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Cartao titulo="Produtos dispensados por ano">
              <BarChart data={prodGrafico.dados}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ano" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {prodGrafico.nomes.map((nm, i) => (
                  <Bar key={nm} dataKey={nm} fill={CORES[i % CORES.length]} />
                ))}
              </BarChart>
            </Cartao>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Cartao titulo={`Maior demanda reprimida (${competencia})`}>
              <BarChart data={(demanda ?? []).map((d) => ({ ...d, reprimida: Number(d.reprimida) }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={10} />
                <YAxis type="category" dataKey="produto" fontSize={9} width={120} />
                <Tooltip />
                <Bar dataKey="reprimida" name="Quantidade reprimida" fill="#e03131" />
              </BarChart>
            </Cartao>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Cartao titulo={`Maior movimentação (${competencia})`}>
              <BarChart data={(movimentacao ?? []).map((d) => ({ ...d, entradas: Number(d.entradas), saidas: Number(d.saidas), demanda: Number(d.demanda) }))} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={10} />
                <YAxis type="category" dataKey="produto" fontSize={9} width={120} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="saidas" name="Saídas" fill="#1c7ed6" />
                <Bar dataKey="entradas" name="Entradas" fill="#2f9e44" />
                <Bar dataKey="demanda" name="Demanda reprimida" fill="#e03131" />
              </BarChart>
            </Cartao>
          </Grid.Col>
        </Grid>
      )}

      {aba === 'populacao' && (
        <Grid gutter="sm">
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <Cartao titulo="Pacientes cadastrados por faixa etária" altura={300}>
              <BarChart data={faixas ?? []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="faixa" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Legend />
                <Bar dataKey="feminino" name="Feminino" stackId="s" fill="#c2255c" />
                <Bar dataKey="masculino" name="Masculino" stackId="s" fill="#1c7ed6" />
              </BarChart>
            </Cartao>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 6 }}>
            <MultiSelect size="xs" mb={4} label="Imunobiológicos (vazio = todos do calendário infantil)" data={opcoesImunos} value={imunos} onChange={setImunos} searchable clearable />
            <Cartao titulo="Cobertura vacinal (%) por ano" altura={250}>
              <BarChart data={coberturaGrafico.dados}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ano" fontSize={10} />
                <YAxis fontSize={10} domain={[0, 100]} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {coberturaGrafico.siglas.map((s, i) => (
                  <Bar key={s} dataKey={s} fill={CORES[i % CORES.length]} />
                ))}
              </BarChart>
            </Cartao>
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}

registrarTela({
  id: 'indicadores',
  titulo: 'Painel de indicadores',
  menu: 'Indicadores',
  padrao: '/t/indicadores',
  permissao: 'indicadores:consultar',
  modulo: 'IND',
  palavras: ['gráfico', 'gestão', 'dashboard', 'cobertura vacinal'],
  ordem: 1,
  render: () => <TelaIndicadores />,
});
registrarMenuRelatorios('IND', 'Indicadores', 'indicadores:exportar');
