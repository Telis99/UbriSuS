// Agenda do dia (TR 1.2.12.15, 1.2.12.41 a 1.2.12.44, 1.2.15.20): transferência, cancelamento, falta,
// confirmação, reimpressão de comprovante e transferência em lote; lista de espera e relatórios.
import { useEffect, useState } from 'react';
import { Badge, Button, Checkbox, Grid, Group, Menu, Modal, Paper, ScrollArea, Select, Stack, Switch, Table, Text, Textarea, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconArrowsExchange, IconCalendarEvent, IconDots, IconFileReport, IconPrinter, IconRefresh } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useAuth } from '@/auth/Auth';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { abrirPdf, COR_RISCO, fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, Situacao } from '@/componentes/comum';
import { confirmar, pedirTexto } from '@/genericos/dialogos';
import { registrarTela } from './registro';

const iso = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM-DD') : null);

function ModalTransferir({ agendamento, aoFechar }: { agendamento: any; aoFechar: (ok: boolean) => void }) {
  const [agendaId, setAgendaId] = useState<number | null>(null);
  const [data, setData] = useState<Date | null>(new Date());
  const [livres, setLivres] = useState<any[]>([]);
  const [horarioId, setHorarioId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  useEffect(() => {
    if (!agendaId || !data) return setLivres([]);
    api
      .get('/api/agendamento/horarios', { agendaId, data: iso(data) })
      .then((r) => setLivres(r.horarios.filter((h: any) => h.situacao === 'LIVRE')))
      .catch(notificarErro);
  }, [agendaId, data]);
  async function transferir() {
    try {
      await api.post(`/api/agendamento/${agendamento.agendamento_id}/transferir`, horarioId ? { horarioId: Number(horarioId), motivo } : { agendaId, data: iso(data), motivo });
      notificarOk('Agendamento transferido e paciente notificado.');
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} title={`Transferir agendamento de ${agendamento.paciente}`}>
      <Stack gap="xs">
        <SelecaoRef entidade="agenda" rotulo="Agenda de destino" valor={agendaId} aoMudar={setAgendaId} />
        <DateInput label="Data" value={data} onChange={setData} valueFormat="DD/MM/YYYY" minDate={new Date()} />
        <Select
          label="Horário livre"
          placeholder={livres.length ? 'Selecione' : 'Sem horário livre: será criado encaixe'}
          data={livres.map((h) => ({ value: String(h.id), label: `${h.hora} (${h.tipo_vaga})` }))}
          value={horarioId}
          onChange={setHorarioId}
          clearable
        />
        <Textarea label="Motivo da transferência" required value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button disabled={!agendaId || motivo.trim().length < 3} onClick={() => void transferir()}>
            Transferir
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ModalLote({ ids, aoFechar }: { ids: number[]; aoFechar: (ok: boolean) => void }) {
  const [prof, setProf] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [encaixe, setEncaixe] = useState(true);
  async function enviar() {
    try {
      const r = await api.post('/api/agendamento/transferir-lote', { ids, profissionalDestinoId: prof, motivo, criarEncaixe: encaixe });
      notificarOk(`${r.transferidos} transferido(s), ${r.encaixes} encaixe(s), ${r.listaEspera} para a lista de espera.`);
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} title={`Transferir ${ids.length} paciente(s) para outro profissional`}>
      <Stack gap="xs">
        <SelecaoRef entidade="profissional" rotulo="Profissional de destino" valor={prof} aoMudar={setProf} obrigatorio />
        <Switch label="Sem horário livre: criar encaixe (senão, incluir na lista de espera)" checked={encaixe} onChange={(e) => setEncaixe(e.currentTarget.checked)} />
        <Textarea label="Motivo" required value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button disabled={!prof || motivo.trim().length < 3} onClick={() => void enviar()}>
            Transferir
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TelaAgendaDia() {
  useTituloJanela('Agenda do dia');
  const { eu } = useAuth();
  const [data, setData] = useState<Date | null>(new Date());
  const [f, setF] = useState<Record<string, number | null>>({ unidadeId: eu?.unidadeAtual ?? null });
  const [linhas, setLinhas] = useState<any[]>([]);
  const [marcados, setMarcados] = useState<number[]>([]);
  const [transferindo, setTransferindo] = useState<any>(null);
  const [lote, setLote] = useState(false);

  const carregar = () => {
    if (!data) return;
    api
      .get('/api/agendamento/horarios', { data: iso(data), ...f })
      .then((r) => (setLinhas(r.horarios), setMarcados([])))
      .catch(notificarErro);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(carregar, [data, f]);

  async function acao(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      notificarOk(msg);
      carregar();
    } catch (e) {
      notificarErro(e);
    }
  }

  async function cancelar(l: any) {
    const motivo = await pedirTexto('Cancelar agendamento', 'Motivo do cancelamento');
    if (!motivo) return;
    const espera = await confirmar('Lista de espera', 'Incluir o paciente na lista de espera para reagendamento?', 'Sim, incluir');
    await acao(() => api.post(`/api/agendamento/${l.agendamento_id}/cancelar`, { motivo, incluirListaEspera: espera }), 'Agendamento cancelado.');
  }

  async function falta(l: any, tipo: 'FALTA' | 'ATRASO') {
    const justificativa = await pedirTexto(tipo === 'FALTA' ? 'Registrar falta' : 'Registrar atraso', 'Justificativa (deixe em branco se não justificada)', { obrigatorio: false });
    if (justificativa === null) return;
    await acao(() => api.post(`/api/agendamento/${l.agendamento_id}/falta`, { tipo, justificativa: justificativa || undefined, justificada: !!justificativa }), `${tipo === 'FALTA' ? 'Falta' : 'Atraso'} registrado.`);
  }

  async function excluir(l: any) {
    if (!(await confirmar('Excluir agendamento', 'A exclusão estorna a cota e libera o horário. Confirma?', 'Excluir', true))) return;
    await acao(() => api.delete(`/api/agendamento/${l.agendamento_id}/excluir`), 'Agendamento excluído.');
  }

  const comPaciente = linhas.filter((l) => l.agendamento_id);
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Agenda do dia</Title>
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={carregar}>
            Atualizar
          </Button>
          <Button size="xs" variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/agendamento/agenda-impressa?data=${iso(data)}${f.agendaId ? `&agendaId=${f.agendaId}` : ''}${f.profissionalId ? `&profissionalId=${f.profissionalId}` : ''}${f.unidadeId ? `&unidadeId=${f.unidadeId}` : ''}`)}>
            Imprimir agenda
          </Button>
          <Button size="xs" leftSection={<IconArrowsExchange size={14} />} disabled={!marcados.length} onClick={() => setLote(true)}>
            Transferir selecionados ({marcados.length})
          </Button>
        </Group>
      </Group>
      <Paper withBorder p="sm">
        <Grid gutter="xs">
          <Grid.Col span={{ base: 12, sm: 4, lg: 2 }}>
            <DateInput label="Data" value={data} onChange={setData} valueFormat="DD/MM/YYYY" />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4, lg: 2.5 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade" valor={f.unidadeId} aoMudar={(v) => setF({ ...f, unidadeId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 4, lg: 2.5 }}>
            <SelecaoRef entidade="profissional" rotulo="Profissional" valor={f.profissionalId} aoMudar={(v) => setF({ ...f, profissionalId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, lg: 2.5 }}>
            <SelecaoRef entidade="especialidade" rotulo="Especialidade" valor={f.especialidadeId} aoMudar={(v) => setF({ ...f, especialidadeId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, lg: 2.5 }}>
            <SelecaoRef entidade="agenda" rotulo="Agenda" valor={f.agendaId} aoMudar={(v) => setF({ ...f, agendaId: v })} />
          </Grid.Col>
        </Grid>
      </Paper>
      <Text size="xs" c="dimmed">
        {linhas.length} horário(s) · {comPaciente.length} agendado(s) · {linhas.filter((l) => l.situacao === 'LIVRE').length} livre(s)
      </Text>
      <Paper withBorder>
        <ScrollArea>
          <Table fz="xs" striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={30}>
                  <Checkbox size="xs" checked={!!comPaciente.length && marcados.length === comPaciente.length} onChange={(e) => setMarcados(e.currentTarget.checked ? comPaciente.map((l) => l.agendamento_id) : [])} />
                </Table.Th>
                <Table.Th>Agenda</Table.Th>
                <Table.Th>Hora</Table.Th>
                <Table.Th>Vaga</Table.Th>
                <Table.Th>Paciente</Table.Th>
                <Table.Th>Telefone</Table.Th>
                <Table.Th>Senha</Table.Th>
                <Table.Th>Solicitante</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {linhas.map((l) => (
                <Table.Tr key={l.id} style={{ opacity: l.situacao === 'BLOQUEADO' ? 0.5 : 1 }}>
                  <Table.Td>
                    {l.agendamento_id && (
                      <Checkbox size="xs" checked={marcados.includes(l.agendamento_id)} onChange={(e) => setMarcados(e.currentTarget.checked ? [...marcados, l.agendamento_id] : marcados.filter((x) => x !== l.agendamento_id))} />
                    )}
                  </Table.Td>
                  <Table.Td style={{ borderLeft: `4px solid ${l.cor ?? '#228be6'}` }}>{l.agenda}</Table.Td>
                  <Table.Td fw={600}>{l.hora !== '00:00' ? l.hora : `#${l.ordem}`}</Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color={l.tipo_vaga === 'URGENCIA' ? 'yellow' : l.tipo_vaga === 'ENCAIXE' ? 'violet' : 'blue'}>
                      {l.tipo_vaga}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {l.paciente ?? (l.situacao === 'BLOQUEADO' ? `Bloqueado ${l.motivo_bloqueio ?? ''}` : <Text size="xs" c="green">Livre</Text>)}
                    {l.urgente && (
                      <Badge size="xs" color="red" ml={4}>
                        urgente
                      </Badge>
                    )}
                    {l.encaixe && (
                      <Badge size="xs" color="violet" ml={4}>
                        encaixe
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{l.celular}</Table.Td>
                  <Table.Td>{l.senha}</Table.Td>
                  <Table.Td>{l.unidade_solicitante ?? l.profissional_solicitante}</Table.Td>
                  <Table.Td>
                    <Situacao valor={l.situacao_agendamento} />
                  </Table.Td>
                  <Table.Td>
                    {l.agendamento_id && (
                      <Menu withinPortal position="bottom-end">
                        <Menu.Target>
                          <Button size="compact-xs" variant="subtle">
                            <IconDots size={14} />
                          </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item onClick={() => void abrirPdf(`/api/agendamento/${l.agendamento_id}/comprovante`)}>Reimprimir comprovante</Menu.Item>
                          <Menu.Item onClick={() => void acao(() => api.post(`/api/agendamento/${l.agendamento_id}/confirmar-presenca`), 'Presença confirmada.')}>Confirmar presença</Menu.Item>
                          <Menu.Item onClick={() => setTransferindo(l)}>Transferir</Menu.Item>
                          <Menu.Item onClick={() => void falta(l, 'FALTA')}>Registrar falta</Menu.Item>
                          <Menu.Item onClick={() => void falta(l, 'ATRASO')}>Registrar atraso</Menu.Item>
                          <Menu.Item onClick={() => void acao(() => api.post(`/api/agendamento/${l.agendamento_id}/realizado`), 'Marcado como atendido.')}>Marcar como atendido</Menu.Item>
                          <Menu.Divider />
                          <Menu.Item color="orange" onClick={() => void cancelar(l)}>
                            Cancelar
                          </Menu.Item>
                          <Menu.Item color="red" onClick={() => void excluir(l)}>
                            Excluir (estorna cota)
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      {transferindo && <ModalTransferir agendamento={transferindo} aoFechar={(ok) => (setTransferindo(null), ok && carregar())} />}
      {lote && <ModalLote ids={marcados} aoFechar={(ok) => (setLote(false), ok && carregar())} />}
    </Stack>
  );
}

function TelaListaEspera() {
  useTituloJanela('Lista de espera');
  const { abrir } = useJanelas();
  const [f, setF] = useState<Record<string, any>>({});
  const [linhas, setLinhas] = useState<any[]>([]);
  useEffect(() => {
    api.get('/api/lista-espera/resumo', f).then(setLinhas).catch(notificarErro);
  }, [f]);
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Lista de espera</Title>
      <Paper withBorder p="sm">
        <Grid gutter="xs">
          <Grid.Col span={{ base: 12, sm: 5 }}>
            <SelecaoRef entidade="especialidade" rotulo="Especialidade" valor={f.especialidadeId} aoMudar={(v) => setF({ ...f, especialidadeId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 5 }}>
            <SelecaoRef entidade="procedimento" rotulo="Procedimento" valor={f.procedimentoId} aoMudar={(v) => setF({ ...f, procedimentoId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 2 }}>
            <Select
              label="Regulação"
              clearable
              value={f.regulada ?? null}
              onChange={(v) => setF({ ...f, regulada: v ?? undefined })}
              data={[
                { value: 'true', label: 'Regulada' },
                { value: 'false', label: 'Não regulada' },
              ]}
            />
          </Grid.Col>
        </Grid>
      </Paper>
      <Text size="xs" c="dimmed">
        {linhas.length} paciente(s) aguardando · ordenados por prioridade e data de inclusão
      </Text>
      <Paper withBorder>
        <Table fz="xs" striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Prioridade</Table.Th>
              <Table.Th>Incluído em</Table.Th>
              <Table.Th>Paciente</Table.Th>
              <Table.Th>Especialidade / procedimento</Table.Th>
              <Table.Th>Origem</Table.Th>
              <Table.Th>Justificativa</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {linhas.map((l) => (
              <Table.Tr key={l.id}>
                <Table.Td>
                  <Badge size="xs" color={COR_RISCO[l.prioridade] ?? 'blue'}>
                    {l.prioridade ?? 'AZUL'}
                  </Badge>
                  {l.regulada && (
                    <Badge size="xs" variant="outline" ml={4}>
                      regulada
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{fmtDataHora(l.incluido_em)}</Table.Td>
                <Table.Td fw={500}>{l.paciente}</Table.Td>
                <Table.Td>{l.especialidade ?? l.procedimento}</Table.Td>
                <Table.Td>{l.origem}</Table.Td>
                <Table.Td>{l.justificativa}</Table.Td>
                <Table.Td>
                  <Button
                    size="compact-xs"
                    variant="light"
                    leftSection={<IconCalendarEvent size={12} />}
                    onClick={() => abrir(`/t/agendamento?paciente=${l.paciente_id}&listaEspera=${l.id}${l.procedimento ? '&tipo=EXAME' : ''}`, 'Agendamento')}
                  >
                    Agendar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

const RELATORIOS: [string, string][] = [
  ['analitico-periodo', 'Agendamentos por período (analítico)'],
  ['sintetico-prestador', 'Agendamentos por prestador (sintético)'],
  ['analitico-procedimento', 'Agendamentos por procedimento (analítico)'],
  ['sintetico-procedimento', 'Agendamentos por procedimento (sintético)'],
  ['analitico-solicitante', 'Agendamentos por solicitante (analítico)'],
];

function TelaRelatoriosAgendamento() {
  useTituloJanela('Relatórios de agendamento');
  const [tipo, setTipo] = useState<string>('analitico-periodo');
  const [de, setDe] = useState<Date | null>(dayjs().startOf('month').toDate());
  const [ate, setAte] = useState<Date | null>(dayjs().endOf('month').toDate());
  const [formato, setFormato] = useState('pdf');
  const emitir = () =>
    api
      .arquivo(`/api/agendamento/relatorio/${tipo}?de=${iso(de)}&ate=${iso(ate)}&formato=${formato}`, undefined, formato === 'pdf' ? 'abrir' : 'baixar', 'GET')
      .catch(notificarErro);
  return (
    <Stack p="md" gap="sm" maw={640}>
      <Title order={4}>Relatórios de agendamento</Title>
      <Select label="Relatório" data={RELATORIOS.map(([value, label]) => ({ value, label }))} value={tipo} onChange={(v) => setTipo(v ?? tipo)} />
      <Group grow>
        <DateInput label="De" value={de} onChange={setDe} valueFormat="DD/MM/YYYY" />
        <DateInput label="Até" value={ate} onChange={setAte} valueFormat="DD/MM/YYYY" />
        <Select
          label="Formato"
          value={formato}
          onChange={(v) => setFormato(v ?? 'pdf')}
          data={['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'xml', 'html', 'txt'].map((x) => ({ value: x, label: x.toUpperCase() }))}
        />
      </Group>
      <Group>
        <Button leftSection={<IconFileReport size={16} />} onClick={() => void emitir()}>
          Emitir
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Período de {fmtData(iso(de))} a {fmtData(iso(ate))}. Todo relatório recebe código de emissão com QR para validação.
      </Text>
    </Stack>
  );
}

registrarTela({ id: 'agenda-dia', titulo: 'Agenda do dia', menu: 'Agendamento', padrao: '/t/agenda-dia', permissao: 'agendamento:consultar', modulo: 'AGE', palavras: ['transferir', 'cancelar', 'falta', 'comprovante'], ordem: 2, render: () => <TelaAgendaDia /> });
registrarTela({ id: 'lista-espera', titulo: 'Lista de espera', menu: 'Agendamento', padrao: '/t/lista-espera', permissao: 'lista_espera:consultar', modulo: 'AGE', palavras: ['fila de espera', 'demanda'], ordem: 3, render: () => <TelaListaEspera /> });
registrarTela({ id: 'relatorios-agendamento', titulo: 'Relatórios', menu: 'Agendamento', padrao: '/t/agendamento-relatorios', permissao: 'agendamento:exportar', modulo: 'AGE', ordem: 9, render: () => <TelaRelatoriosAgendamento /> });
