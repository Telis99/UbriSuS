// Agendamento de consultas e exames (TR 1.2.10, 1.2.12): disponibilidade por unidade/especialidade/
// profissional, calendário colorido, horários com cotas, encaixe, urgência, lista de espera e comprovante.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Grid, Group, NumberInput, Paper, ScrollArea, SegmentedControl, Stack, Table, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core';
import { Calendar } from '@mantine/dates';
import { IconCalendarPlus, IconClockPlus, IconListCheck, IconPrinter, IconUserSearch } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useTituloJanela } from '@/shell/Janelas';
import { BuscaPaciente, CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { abrirPdf, comConfirmacao, fmtData, notificarErro, notificarOk, SelecaoRef, Situacao, TabelaSimples } from '@/componentes/comum';
import { pedirTexto } from '@/genericos/dialogos';
import { registrarTela } from './registro';

interface Agenda {
  agenda_id: number;
  nome: string;
  tipo: string;
  unidade: string;
  profissional?: string;
  especialidade?: string;
  especialidade_id?: number;
  cor?: string;
  local?: string;
  primeira_data?: string;
  primeira_urgencia?: string;
}

interface DiaCalendario {
  data: string;
  total: number;
  livres: number;
  livres_urgencia: number;
  ocupados: number;
  especial: boolean;
  campanha?: string;
  bloqueado: boolean;
  motivo_bloqueio?: string;
}

interface Cota {
  procedimento_id: number;
  codigo: string;
  nome: string;
  cota_diaria?: number;
  cota_mensal?: number;
  disponivel_dia: number | null;
  disponivel_mes: number | null;
  estrutura?: string;
}

/** Cores do calendário: verde = vagas, vermelho = lotado, cinza = bloqueado, roxo = campanha, laranja = feriado (TR 1.2.12.8). */
function corDia(d: DiaCalendario | undefined, feriado: boolean) {
  if (feriado) return 'var(--mantine-color-orange-2)';
  if (!d) return undefined;
  if (d.bloqueado) return 'var(--mantine-color-gray-3)';
  if (d.especial) return 'var(--mantine-color-grape-2)';
  if (d.livres > 0) return 'var(--mantine-color-green-2)';
  if (d.livres_urgencia > 0) return 'var(--mantine-color-yellow-2)';
  return 'var(--mantine-color-red-2)';
}

function TelaAgendamento({ query }: { query: URLSearchParams }) {
  useTituloJanela('Agendamento');
  const [pacienteId, setPacienteId] = useState<number | null>(query.get('paciente') ? Number(query.get('paciente')) : null);
  const { paciente, recarregar } = usePaciente(pacienteId, 'agendamento');
  const [historico, setHistorico] = useState<any>(null);
  const [tipo, setTipo] = useState<string>(query.get('tipo') ?? 'CONSULTA');
  const [filtro, setFiltro] = useState<Record<string, number | null>>({
    especialidadeId: query.get('especialidade') ? Number(query.get('especialidade')) : null,
    procedimentoId: query.get('procedimento') ? Number(query.get('procedimento')) : null,
  });
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [mes, setMes] = useState(new Date());
  const [cal, setCal] = useState<{ dias: DiaCalendario[]; feriados: { data: string; descricao: string }[]; primeiraEletiva?: string; primeiraUrgencia?: string } | null>(null);
  const [data, setData] = useState<string | null>(null);
  const [horarios, setHorarios] = useState<{ horarios: any[]; cotas: Cota[] } | null>(null);
  const [selecionado, setSelecionado] = useState<any>(null);
  const [encaixe, setEncaixe] = useState<{ hora: string } | null>(null);
  const [urgente, setUrgente] = useState(false);
  const [procs, setProcs] = useState<Record<number, number>>({});
  const [observacao, setObservacao] = useState('');
  const [espera, setEspera] = useState<any[]>([]);
  const listaEsperaId = query.get('listaEspera') ? Number(query.get('listaEspera')) : undefined;

  useEffect(() => {
    if (!pacienteId) return setHistorico(null);
    api.get(`/api/agendamento/paciente/${pacienteId}`).then(setHistorico).catch(notificarErro);
  }, [pacienteId]);

  useEffect(() => {
    api
      .get<Agenda[]>('/api/agendamento/disponibilidade', { tipo, ...filtro })
      .then((r) => {
        setAgendas(r);
        if (agenda && !r.some((a) => a.agenda_id === agenda.agenda_id)) setAgenda(null);
      })
      .catch(notificarErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, filtro]);

  // Alerta de pacientes na lista de espera para a mesma especialidade/procedimento (TR 1.2.12.39).
  useEffect(() => {
    const esp = agenda?.especialidade_id ?? filtro.especialidadeId;
    if (!esp && !filtro.procedimentoId) return setEspera([]);
    api.get('/api/lista-espera/resumo', { especialidadeId: esp, procedimentoId: filtro.procedimentoId }).then(setEspera).catch(() => setEspera([]));
  }, [agenda, filtro.especialidadeId, filtro.procedimentoId]);

  const carregarCalendario = () => {
    if (!agenda) return setCal(null);
    api.get('/api/agendamento/calendario', { agendaId: agenda.agenda_id, mes: dayjs(mes).format('YYYY-MM') }).then(setCal).catch(notificarErro);
  };
  useEffect(carregarCalendario, [agenda, mes]);

  const carregarHorarios = () => {
    if (!agenda || !data) return setHorarios(null);
    api.get('/api/agendamento/horarios', { agendaId: agenda.agenda_id, data }).then(setHorarios).catch(notificarErro);
  };
  useEffect(() => {
    setSelecionado(null);
    setEncaixe(null);
    carregarHorarios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agenda, data]);

  const dias = useMemo(() => new Map((cal?.dias ?? []).map((d) => [d.data, d])), [cal]);
  const feriados = useMemo(() => new Map((cal?.feriados ?? []).map((f) => [f.data, f.descricao])), [cal]);

  async function confirmarAgendamento() {
    if (!pacienteId || !agenda) return;
    const procedimentos = Object.entries(procs)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ procedimentoId: Number(id), quantidade: q }));
    if (agenda.tipo === 'EXAME' && !procedimentos.length) return notificarErro(new Error('Selecione ao menos um procedimento.'));
    const base: Record<string, unknown> = {
      pacienteId,
      urgente,
      tipo: agenda.tipo,
      procedimentos: procedimentos.length ? procedimentos : undefined,
      observacao: observacao || undefined,
      listaEsperaId,
      ...(encaixe ? { agendaId: agenda.agenda_id, data, hora: encaixe.hora || undefined } : { horarioId: selecionado?.id }),
    };
    try {
      const ag = await comConfirmacao((ok) => api.post('/api/agendamento', { ...base, confirmarAvisos: ok }), 'Avisos do agendamento');
      if (!ag) return;
      notificarOk(`Agendamento realizado${ag.senha ? ` — senha ${ag.senha}` : ''}.`);
      void abrirPdf(`/api/agendamento/${ag.id}/comprovante`);
      setSelecionado(null);
      setEncaixe(null);
      setProcs({});
      setObservacao('');
      carregarHorarios();
      carregarCalendario();
      api.get(`/api/agendamento/paciente/${pacienteId}`).then(setHistorico);
    } catch (e) {
      notificarErro(e);
    }
  }

  async function incluirEspera() {
    if (!pacienteId) return;
    const justificativa = await pedirTexto('Incluir na lista de espera', 'Justificativa', { longo: true, obrigatorio: false });
    if (justificativa === null) return;
    try {
      await api.post('/api/lista-espera', {
        pacienteId,
        especialidadeId: agenda?.especialidade_id ?? filtro.especialidadeId ?? undefined,
        procedimentoId: filtro.procedimentoId ?? undefined,
        justificativa: justificativa || undefined,
      });
      notificarOk('Paciente incluído na lista de espera.');
      api.get(`/api/agendamento/paciente/${pacienteId}`).then(setHistorico);
    } catch (e) {
      notificarErro(e);
    }
  }

  const podeConfirmar = !!pacienteId && !!agenda && (!!selecionado || !!encaixe);

  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Agendamento de consultas e exames</Title>
        <SegmentedControl
          size="xs"
          value={tipo}
          onChange={(v) => (setTipo(v), setAgenda(null), setData(null))}
          data={[
            { value: 'CONSULTA', label: 'Consultas' },
            { value: 'EXAME', label: 'Exames' },
          ]}
        />
      </Group>

      {!pacienteId ? (
        <Paper withBorder p="sm">
          <Group gap={6} mb={6}>
            <IconUserSearch size={18} />
            <Text fw={600} size="sm">
              Selecione o paciente
            </Text>
          </Group>
          <BuscaPaciente aoSelecionar={setPacienteId} />
        </Paper>
      ) : (
        paciente && (
          <Stack gap={6}>
            <CabecalhoPaciente paciente={paciente} compacto aoAtualizar={recarregar} />
            <Group gap="xs">
              <Button size="compact-xs" variant="subtle" onClick={() => setPacienteId(null)}>
                Trocar paciente
              </Button>
              <Button size="compact-xs" variant="subtle" leftSection={<IconListCheck size={14} />} onClick={() => void incluirEspera()}>
                Incluir na lista de espera
              </Button>
            </Group>
            {historico && (historico.pendentes.length > 0 || historico.absenteismos.length > 0 || historico.listaEspera.length > 0) && (
              <Grid>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Text size="xs" fw={600}>
                    Agendamentos pendentes
                  </Text>
                  <TabelaSimples
                    linhas={historico.pendentes}
                    colunas={[
                      { titulo: 'Data', valor: (l: any) => `${fmtData(l.data)} ${l.hora ?? ''}` },
                      { titulo: 'Especialidade', valor: (l: any) => l.especialidade ?? l.tipo },
                      { titulo: 'Profissional', valor: (l: any) => l.profissional },
                    ]}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Text size="xs" fw={600} c="red">
                    Absenteísmo (faltas e atrasos)
                  </Text>
                  <TabelaSimples
                    linhas={historico.absenteismos}
                    colunas={[
                      { titulo: 'Data', valor: (l: any) => fmtData(l.data) },
                      { titulo: 'Especialidade', valor: (l: any) => l.especialidade },
                      { titulo: 'Situação', valor: (l: any) => <Situacao valor={l.situacao} /> },
                    ]}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <Text size="xs" fw={600}>
                    Na lista de espera
                  </Text>
                  <TabelaSimples
                    linhas={historico.listaEspera}
                    colunas={[
                      { titulo: 'Desde', valor: (l: any) => fmtData(l.incluido_em) },
                      { titulo: 'Para', valor: (l: any) => l.especialidade ?? l.procedimento },
                      { titulo: 'Prioridade', valor: (l: any) => l.prioridade },
                    ]}
                  />
                </Grid.Col>
              </Grid>
            )}
          </Stack>
        )
      )}

      <Paper withBorder p="sm">
        <Grid gutter="xs">
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade prestadora" valor={filtro.unidadeId} aoMudar={(v) => setFiltro({ ...filtro, unidadeId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            <SelecaoRef entidade="especialidade" rotulo="Especialidade" valor={filtro.especialidadeId} aoMudar={(v) => setFiltro({ ...filtro, especialidadeId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            <SelecaoRef entidade="profissional" rotulo="Profissional" valor={filtro.profissionalId} aoMudar={(v) => setFiltro({ ...filtro, profissionalId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
            {tipo === 'EXAME' ? (
              <SelecaoRef entidade="procedimento" rotulo="Procedimento / exame" valor={filtro.procedimentoId} aoMudar={(v) => setFiltro({ ...filtro, procedimentoId: v })} />
            ) : (
              <SelecaoRef entidade="convenio" rotulo="Convênio" valor={filtro.convenioId} aoMudar={(v) => setFiltro({ ...filtro, convenioId: v })} />
            )}
          </Grid.Col>
        </Grid>
      </Paper>

      {espera.length > 0 && (
        <Alert color="yellow" py={6} icon={<IconListCheck size={16} />}>
          Há {espera.length} paciente(s) aguardando na lista de espera para esta {tipo === 'EXAME' ? 'especialidade/procedimento' : 'especialidade'}. Considere convocá-los antes de liberar a vaga.
        </Alert>
      )}

      <Grid gutter="sm">
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Paper withBorder>
            <Text size="xs" fw={600} p="xs">
              Agendas disponíveis ({agendas.length})
            </Text>
            <ScrollArea h={420}>
              <Table highlightOnHover fz="xs">
                <Table.Tbody>
                  {agendas.map((a) => (
                    <Table.Tr
                      key={a.agenda_id}
                      style={{ cursor: 'pointer', background: agenda?.agenda_id === a.agenda_id ? 'var(--mantine-color-blue-light)' : undefined }}
                      onClick={() => (setAgenda(a), setData(a.primeira_data ?? null), a.primeira_data && setMes(new Date(a.primeira_data + 'T12:00')))}
                    >
                      <Table.Td style={{ borderLeft: `4px solid ${a.cor ?? '#228be6'}` }}>
                        <Text size="xs" fw={600}>
                          {a.especialidade ?? a.nome}
                        </Text>
                        <Text size="xs">{a.profissional ?? a.local}</Text>
                        <Text size="xs" c="dimmed">
                          {a.unidade}
                        </Text>
                      </Table.Td>
                      <Table.Td ta="right">
                        <Tooltip label="Primeira data com vaga eletiva">
                          <Badge size="xs" color={a.primeira_data ? 'green' : 'red'} variant="light">
                            {a.primeira_data ? fmtData(a.primeira_data) : 'sem vagas'}
                          </Badge>
                        </Tooltip>
                        {a.primeira_urgencia && (
                          <Badge size="xs" color="yellow" variant="light" mt={2} display="block">
                            urg. {fmtData(a.primeira_urgencia)}
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5, lg: 3 }}>
          <Paper withBorder p="xs">
            {agenda ? (
              <Stack gap={6} align="center">
                <Calendar
                  locale="pt-br"
                  date={mes}
                  onDateChange={setMes}
                  size="sm"
                  getDayProps={(d) => {
                    const iso = dayjs(d).format('YYYY-MM-DD');
                    return {
                      selected: iso === data,
                      onClick: () => setData(iso),
                      style: { background: iso === data ? undefined : corDia(dias.get(iso), feriados.has(iso)) },
                    };
                  }}
                  renderDay={(d) => {
                    const iso = dayjs(d).format('YYYY-MM-DD');
                    const info = dias.get(iso);
                    const titulo = feriados.get(iso) ?? (info?.bloqueado ? (info.motivo_bloqueio ?? 'Bloqueado') : info?.campanha ?? (info ? `${info.livres} vaga(s) livre(s)` : ''));
                    return (
                      <div title={titulo}>
                        {d.getDate()}
                        {info && info.livres > 0 && <div style={{ fontSize: 8, lineHeight: 1 }}>{info.livres}</div>}
                      </div>
                    );
                  }}
                />
                <Group gap={4}>
                  <Badge size="xs" color="green">
                    vagas
                  </Badge>
                  <Badge size="xs" color="red">
                    lotado
                  </Badge>
                  <Badge size="xs" color="yellow">
                    só urgência
                  </Badge>
                  <Badge size="xs" color="grape">
                    campanha
                  </Badge>
                  <Badge size="xs" color="orange">
                    feriado
                  </Badge>
                  <Badge size="xs" color="gray">
                    bloqueado
                  </Badge>
                </Group>
                {cal?.primeiraEletiva && (
                  <Text size="xs">
                    Primeira vaga eletiva: <b>{fmtData(cal.primeiraEletiva)}</b>
                    {cal.primeiraUrgencia && (
                      <>
                        {' '}
                        · urgência: <b>{fmtData(cal.primeiraUrgencia)}</b>
                      </>
                    )}
                  </Text>
                )}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed" p="md">
                Selecione uma agenda para ver o calendário.
              </Text>
            )}
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 7, lg: 5 }}>
          <Paper withBorder p="xs">
            {data && horarios ? (
              <Stack gap={6}>
                <Group justify="space-between">
                  <Text size="sm" fw={600}>
                    {dayjs(data).format('dddd, DD/MM/YYYY')}
                  </Text>
                  <Group gap={4}>
                    <Button size="compact-xs" variant="light" leftSection={<IconClockPlus size={14} />} onClick={() => (setSelecionado(null), setEncaixe({ hora: '' }))}>
                      Encaixe
                    </Button>
                    <Button size="compact-xs" variant="subtle" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/agendamento/agenda-impressa?data=${data}&agendaId=${agenda!.agenda_id}`)}>
                      Imprimir agenda
                    </Button>
                  </Group>
                </Group>
                {horarios.cotas.length > 0 && (
                  <Table fz="xs" withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Procedimento</Table.Th>
                        <Table.Th>Cota dia</Table.Th>
                        <Table.Th>Cota mês</Table.Th>
                        <Table.Th>Qtde.</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {horarios.cotas.map((c) => (
                        <Table.Tr key={c.procedimento_id}>
                          <Table.Td>
                            {c.codigo} - {c.nome}
                          </Table.Td>
                          <Table.Td c={c.disponivel_dia === 0 ? 'red' : undefined}>{c.disponivel_dia ?? '∞'}</Table.Td>
                          <Table.Td c={c.disponivel_mes === 0 ? 'red' : undefined}>{c.disponivel_mes ?? '∞'}</Table.Td>
                          <Table.Td w={80}>
                            <NumberInput size="xs" min={0} max={c.disponivel_dia ?? 99} value={procs[c.procedimento_id] ?? 0} onChange={(v) => setProcs({ ...procs, [c.procedimento_id]: Number(v) || 0 })} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
                <ScrollArea h={260}>
                  <Table fz="xs" highlightOnHover>
                    <Table.Tbody>
                      {horarios.horarios.map((h) => {
                        const livre = h.situacao === 'LIVRE';
                        const sel = selecionado?.id === h.id;
                        return (
                          <Table.Tr
                            key={h.id}
                            style={{ cursor: livre ? 'pointer' : 'default', background: sel ? 'var(--mantine-color-blue-light)' : undefined, opacity: h.situacao === 'BLOQUEADO' ? 0.5 : 1 }}
                            onClick={() => livre && (setSelecionado(h), setEncaixe(null), setUrgente(h.tipo_vaga === 'URGENCIA'))}
                          >
                            <Table.Td w={60} fw={600}>
                              {h.hora !== '00:00' ? h.hora : `#${h.ordem}`}
                            </Table.Td>
                            <Table.Td w={90}>
                              <Badge size="xs" variant="light" color={h.tipo_vaga === 'URGENCIA' ? 'yellow' : h.tipo_vaga === 'ENCAIXE' ? 'violet' : 'blue'}>
                                {h.tipo_vaga}
                              </Badge>
                            </Table.Td>
                            <Table.Td>
                              {livre ? (
                                <Text size="xs" c="green">
                                  Livre
                                </Text>
                              ) : h.situacao === 'BLOQUEADO' ? (
                                <Text size="xs" c="dimmed">
                                  Bloqueado {h.motivo_bloqueio ? `— ${h.motivo_bloqueio}` : ''}
                                </Text>
                              ) : (
                                <Group gap={4}>
                                  <Text size="xs">{h.paciente}</Text>
                                  <Situacao valor={h.situacao_agendamento} />
                                  {h.urgente && (
                                    <Badge size="xs" color="red">
                                      urgente
                                    </Badge>
                                  )}
                                </Group>
                              )}
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
                {encaixe && (
                  <Alert color="violet" py={6}>
                    <Group align="flex-end">
                      <Text size="xs">Encaixe entre os horários já agendados.</Text>
                      <TextInput size="xs" label="Hora (opcional)" placeholder="HH:MM" value={encaixe.hora} onChange={(e) => setEncaixe({ hora: e.currentTarget.value })} w={110} />
                    </Group>
                  </Alert>
                )}
                <Checkbox size="xs" label="Agendamento de urgência (vaga reservada)" checked={urgente} onChange={(e) => setUrgente(e.currentTarget.checked)} />
                <Textarea size="xs" placeholder="Observação" value={observacao} onChange={(e) => setObservacao(e.currentTarget.value)} autosize minRows={1} />
                <Button leftSection={<IconCalendarPlus size={16} />} disabled={!podeConfirmar} onClick={() => void confirmarAgendamento()}>
                  {pacienteId ? 'Confirmar agendamento e imprimir comprovante' : 'Selecione o paciente'}
                </Button>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed" p="md">
                Selecione o dia no calendário.
              </Text>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

registrarTela({
  id: 'agendamento',
  titulo: 'Agendar consulta / exame',
  menu: 'Agendamento',
  padrao: '/t/agendamento',
  permissao: 'agendamento:incluir',
  modulo: 'AGE',
  palavras: ['marcar consulta', 'agendar exame', 'vaga', 'encaixe', 'cota'],
  ordem: 1,
  render: ({ query }) => <TelaAgendamento query={query} />,
});
