// Transporte sanitário (TR 1.2.40): agendamento simplificado (município → rota → dia/horário → vaga),
// acompanhantes, gestão das viagens (confirmação, inclusão sem agendamento, presença), adiantamentos,
// fechamento com prestação de contas e impressões (comprovante, relação de passageiros, ordem de tráfego).
import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconArmchair, IconBus, IconCalendarEvent, IconCheck, IconPlus, IconPrinter, IconReceipt, IconTrash, IconUserPlus, IconUserQuestion, IconX } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { confirmar, pedirTexto } from '@/genericos/dialogos';
import { registrarExtensaoFormulario } from '@/genericos/Formulario';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { BuscaPaciente, CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { abrirPdf, fmtData, notificarErro, notificarOk, SelecaoRef, Situacao, TabelaSimples, useCarregar } from '@/componentes/comum';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const TIPOS_VIAGEM = [
  { value: 'IDA_VOLTA', label: 'Ida e volta' },
  { value: 'IDA', label: 'Somente ida' },
  { value: 'VOLTA', label: 'Somente volta' },
];
const ROTULO_TIPO: Record<string, string> = Object.fromEntries(TIPOS_VIAGEM.map((t) => [t.value, t.label]));
const COR_VIAGEM: Record<string, string> = { ABERTA: 'blue', CONFIRMADA: 'cyan', CONCLUIDA: 'green', CANCELADA: 'gray' };
const moeda = (v: unknown) => (v == null ? '-' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const hoje = () => dayjs().format('YYYY-MM-DD');

interface Acompanhante {
  chave: number;
  indefinido: boolean;
  pessoaId?: number | null;
  nome?: string;
  documento?: string;
  parentesco?: string;
  tipoViagem: string;
  ocupaVaga: boolean;
  poltrona?: number | null;
}
let seq = 0;
const novoAcompanhante = (indefinido = false): Acompanhante => ({ chave: ++seq, indefinido, tipoViagem: 'IDA_VOLTA', ocupaVaga: true });

/** Editor de acompanhantes: definidos ou vaga reservada, tipo de viagem e se ocupa vaga (TR 1.2.40.14 a 1.2.40.16). */
function EditorAcompanhantes({ lista, aoMudar, poltronas }: { lista: Acompanhante[]; aoMudar: (l: Acompanhante[]) => void; poltronas?: number }) {
  const alterar = (k: number, p: Partial<Acompanhante>) => aoMudar(lista.map((a) => (a.chave === k ? { ...a, ...p } : a)));
  return (
    <Stack gap={6}>
      <Group justify="space-between">
        <Text size="sm" fw={600}>
          Acompanhantes
        </Text>
        <Group gap={4}>
          <Button size="compact-xs" variant="light" leftSection={<IconUserPlus size={14} />} onClick={() => aoMudar([...lista, novoAcompanhante()])}>
            Acompanhante
          </Button>
          <Tooltip label="Reserva a vaga para um acompanhante ainda não definido (TR 1.2.40.15)">
            <Button size="compact-xs" variant="light" color="orange" leftSection={<IconUserQuestion size={14} />} onClick={() => aoMudar([...lista, novoAcompanhante(true)])}>
              Reservar vaga
            </Button>
          </Tooltip>
        </Group>
      </Group>
      {!lista.length && (
        <Text size="xs" c="dimmed">
          Sem acompanhantes.
        </Text>
      )}
      {lista.map((a) => (
        <Paper key={a.chave} withBorder p={6}>
          <Group gap={6} align="end" wrap="wrap">
            {a.indefinido ? (
              <Badge color="orange" variant="light" h={30}>
                Vaga reservada — acompanhante a definir
              </Badge>
            ) : (
              <>
                <TextInput size="xs" label="Nome" w={200} value={a.nome ?? ''} onChange={(e) => alterar(a.chave, { nome: e.currentTarget.value })} />
                <TextInput size="xs" label="Documento" w={110} value={a.documento ?? ''} onChange={(e) => alterar(a.chave, { documento: e.currentTarget.value })} />
                <TextInput size="xs" label="Parentesco" w={100} value={a.parentesco ?? ''} onChange={(e) => alterar(a.chave, { parentesco: e.currentTarget.value })} />
              </>
            )}
            <Select size="xs" label="Viagem" w={130} data={TIPOS_VIAGEM} value={a.tipoViagem} onChange={(v) => alterar(a.chave, { tipoViagem: v ?? 'IDA_VOLTA' })} allowDeselect={false} />
            <NumberInput size="xs" label="Poltrona" w={80} min={1} max={poltronas} value={a.poltrona ?? ''} onChange={(v) => alterar(a.chave, { poltrona: v === '' ? null : Number(v) })} />
            <Switch size="xs" label="Ocupa vaga" checked={a.ocupaVaga} onChange={(e) => alterar(a.chave, { ocupaVaga: e.currentTarget.checked })} mb={6} />
            <ActionIcon variant="subtle" color="red" mb={4} onClick={() => aoMudar(lista.filter((x) => x.chave !== a.chave))}>
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

const corpoAcompanhantes = (l: Acompanhante[]) =>
  l.map((a) => ({ indefinido: a.indefinido, nome: a.nome || null, documento: a.documento || null, parentesco: a.parentesco || null, tipoViagem: a.tipoViagem, ocupaVaga: a.ocupaVaga, poltrona: a.poltrona ?? null }));

/** Mapa de poltronas da viagem para escolha do lugar (TR 1.2.40.18.6). */
function MapaPoltronas({ vagas, ocupadas, escolhidas, aoEscolher }: { vagas: number; ocupadas: number[]; escolhidas: (number | null | undefined)[]; aoEscolher: (n: number) => void }) {
  return (
    <SimpleGrid cols={4} spacing={4} maw={220}>
      {Array.from({ length: vagas }, (_, i) => i + 1).map((n) => {
        const ocupada = ocupadas.includes(n);
        const minha = escolhidas.includes(n);
        return (
          <UnstyledButton key={n} disabled={ocupada} onClick={() => aoEscolher(n)}>
            <Paper withBorder p={2} ta="center" bg={ocupada ? 'gray.3' : minha ? 'teal.1' : undefined} style={{ cursor: ocupada ? 'not-allowed' : 'pointer' }}>
              <Group gap={2} justify="center">
                <IconArmchair size={12} />
                <Text size="xs" fw={minha ? 700 : 400}>
                  {n}
                </Text>
              </Group>
            </Paper>
          </UnstyledButton>
        );
      })}
    </SimpleGrid>
  );
}

/** Seleção simples entre os registros ativos de um cadastro do transporte. */
function SelecaoOpcoes({ entidade, rotulo, valor, aoMudar }: { entidade: string; rotulo: string; valor: number | null | undefined; aoMudar: (v: number) => void }) {
  const { dados } = useCarregar<{ id: number; rotulo: string }[]>(() => api.get(`/api/e/${entidade}/opcoes`, { q: '', limite: 200 }), [entidade]);
  return (
    <Select
      size="xs"
      w={240}
      label={rotulo}
      searchable
      data={(dados ?? []).map((o) => ({ value: String(o.id), label: o.rotulo }))}
      value={valor ? String(valor) : null}
      onChange={(x) => x && aoMudar(Number(x))}
      allowDeselect={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Agendamento (TR 1.2.40.12, 1.2.40.13, 1.2.40.18, 1.2.40.26, 1.2.40.28)
// ---------------------------------------------------------------------------
function TelaAgendamentoTransporte({ query }: { query: URLSearchParams }) {
  useTituloJanela('Agendamento de transporte');
  const [pacienteId, setPacienteId] = useState<number | null>(query.get('paciente') ? Number(query.get('paciente')) : null);
  const { paciente, recarregar } = usePaciente(pacienteId, 'transporte');
  const [municipioId, setMunicipioId] = useState<string | null>(query.get('municipio'));
  const [rota, setRota] = useState<any>(null);
  const [dia, setDia] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({ tipoViagem: 'IDA_VOLTA', ocupaVaga: true, necessidade: 'NENHUMA', tfdLaudoId: query.get('tfd') ? Number(query.get('tfd')) : null });
  const [acompanhantes, setAcompanhantes] = useState<Acompanhante[]>([]);
  const [poltronas, setPoltronas] = useState<{ vagas: number; ocupadas: number[] } | null>(null);
  const [gravando, setGravando] = useState(false);
  const municipios = useCarregar<any[]>(() => api.get('/api/transporte/municipios-destino'), []);
  const rotas = useCarregar<any[]>(() => (municipioId ? api.get('/api/transporte/rotas', { municipioId }) : Promise.resolve([])), [municipioId]);
  const dias = useCarregar<any[]>(() => (rota ? api.get(`/api/transporte/rotas/${rota.id}/disponibilidade`, { dias: 60 }) : Promise.resolve([])), [rota?.id]);
  const historico = useCarregar<any>(() => (pacienteId ? api.get(`/api/transporte/paciente/${pacienteId}`) : Promise.resolve(null)), [pacienteId]);
  const f = (p: Record<string, any>) => setForm((x) => ({ ...x, ...p }));

  useEffect(() => {
    setRota(null);
    setDia(null);
  }, [municipioId]);
  useEffect(() => {
    if (rota) f({ localDestinoId: form.localDestinoId ?? rota.local_destino_id ?? null, motivoId: rota.motivo_id ?? null });
    setDia(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rota?.id]);
  useEffect(() => {
    setPoltronas(null);
    if (dia) api.get(`/api/transporte/agendas/${dia.agendaId}/poltronas`, { data: dia.data }).then(setPoltronas).catch(notificarErro);
  }, [dia?.agendaId, dia?.data]);
  // Processo de TFD autorizado: sugere o município do local de tratamento (TR 1.2.35.17).
  useEffect(() => {
    const t = historico.dados?.tfd?.find((x: any) => x.id === form.tfdLaudoId);
    if (t?.municipio_id && !municipioId) setMunicipioId(String(t.municipio_id));
    if (t?.local_tratamento_id) f({ localDestinoId: t.local_tratamento_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historico.dados, form.tfdLaudoId]);

  async function agendar() {
    if (!pacienteId || !dia) return;
    setGravando(true);
    try {
      const r = await api.post('/api/transporte/agendamentos', { agendaId: dia.agendaId, data: dia.data, pacienteId, ...form, acompanhantes: corpoAcompanhantes(acompanhantes) });
      notificarOk(`Transporte agendado. Protocolo ${r.protocolo}.`);
      void abrirPdf(`/api/transporte/passageiros/${r.id}/comprovante`);
      setAcompanhantes([]);
      f({ poltrona: null, observacao: '' });
      setDia(null);
      await Promise.all([dias.recarregar(), historico.recarregar()]);
    } catch (e) {
      notificarErro(e);
    } finally {
      setGravando(false);
    }
  }

  async function cancelar(id: number) {
    const motivo = await pedirTexto('Cancelar agendamento', 'Motivo do cancelamento');
    if (!motivo) return;
    await api
      .post(`/api/transporte/passageiros/${id}/cancelar`, { motivo })
      .then(() => (notificarOk('Agendamento cancelado.'), historico.recarregar(), dias.recarregar()))
      .catch(notificarErro);
  }

  if (!pacienteId || !paciente)
    return (
      <Stack>
        <Title order={4}>Agendamento de transporte - selecione o paciente</Title>
        <BuscaPaciente aoSelecionar={setPacienteId} />
      </Stack>
    );

  const vagasPorDia = dias.dados ?? [];
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <CabecalhoPaciente paciente={paciente} compacto aoAtualizar={recarregar} />
        <Button variant="subtle" size="xs" onClick={() => setPacienteId(null)}>
          Trocar paciente
        </Button>
      </Group>
      {historico.dados?.tfd?.length > 0 && (
        <Alert color="grape" title="Processos de TFD com tratamento autorizado">
          <Group gap="xs">
            {historico.dados.tfd.map((t: any) => (
              <Button
                key={t.id}
                size="compact-xs"
                variant={form.tfdLaudoId === t.id ? 'filled' : 'light'}
                color="grape"
                onClick={() => {
                  f({ tfdLaudoId: form.tfdLaudoId === t.id ? null : t.id, localDestinoId: form.tfdLaudoId === t.id ? null : (t.local_tratamento_id ?? null) });
                  if (t.municipio_id) setMunicipioId(String(t.municipio_id));
                }}
              >
                Laudo {t.numero} · {t.local_tratamento ?? '-'} ({t.municipio ?? '-'})
              </Button>
            ))}
          </Group>
        </Alert>
      )}
      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Stack gap="xs">
            <Select
              label="1. Município de destino"
              placeholder="Selecione"
              searchable
              data={(municipios.dados ?? []).map((m) => ({ value: String(m.id), label: `${m.nome}/${m.uf} (${m.rotas} rota${m.rotas > 1 ? 's' : ''})` }))}
              value={municipioId}
              onChange={setMunicipioId}
            />
            <Text size="sm" fw={600}>
              2. Rotas disponíveis
            </Text>
            {municipioId && !rotas.carregando && !rotas.dados?.length && (
              <Text size="xs" c="dimmed">
                Nenhuma rota atende o município.
              </Text>
            )}
            {(rotas.dados ?? []).map((r) => (
              <Card key={r.id} withBorder p="xs" bg={rota?.id === r.id ? 'blue.0' : undefined} style={{ cursor: 'pointer' }} onClick={() => setRota(r)}>
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={600}>
                    <IconBus size={14} /> {r.nome}
                  </Text>
                  {r.abrangencia === 'MUNICIPIO' && (
                    <Badge size="xs" variant="light">
                      municipal
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {(r.paradas ?? []).map((p: any) => `${p.ordem}. ${p.municipio}`).join(' → ')}
                </Text>
                <Text size="xs">
                  {r.local_destino ?? '-'} · {r.motivo ?? '-'}
                </Text>
                <Text size="xs">
                  Saídas: {(r.agendas ?? []).map((a: any) => `${a.hora} (${a.dias.map((d: string) => DIAS[Number(d)]).join(', ')})`).join('; ') || '-'}
                </Text>
                <Text size="xs" c={r.proximo ? 'teal' : 'red'} fw={600}>
                  {r.proximo ? `Próximo dia com vaga: ${fmtData(r.proximo.data)} às ${r.proximo.horaSaida} (${r.proximo.livres} vagas)` : 'Sem vagas nos próximos 60 dias'}
                </Text>
              </Card>
            ))}
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Text size="sm" fw={600} mb={4}>
            3. Dias e horários
          </Text>
          {!rota && (
            <Text size="xs" c="dimmed">
              Selecione a rota.
            </Text>
          )}
          <ScrollArea h={460}>
            <Stack gap={4}>
              {vagasPorDia.map((d) => (
                <Paper
                  key={`${d.agendaId}-${d.data}`}
                  withBorder
                  p={6}
                  bg={dia?.data === d.data && dia?.agendaId === d.agendaId ? 'teal.0' : d.proximo ? 'yellow.0' : !d.disponivel ? 'gray.1' : undefined}
                  style={{ cursor: d.disponivel ? 'pointer' : 'not-allowed', opacity: d.disponivel ? 1 : 0.7 }}
                  onClick={() => d.disponivel && setDia(d)}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm">
                      <IconCalendarEvent size={13} /> {DIAS[d.diaSemana]} {fmtData(d.data)} · {d.horaSaida}
                    </Text>
                    {d.disponivel ? (
                      <Badge color={d.livres > 3 ? 'teal' : 'orange'} variant="light">
                        {d.livres} de {d.vagas} vagas
                      </Badge>
                    ) : (
                      <Badge color={d.feriado ? 'red' : 'gray'} variant="light">
                        {d.motivo}
                      </Badge>
                    )}
                  </Group>
                  {d.proximo && (
                    <Text size="xs" c="orange.8" fw={600}>
                      Próximo dia com vaga disponível
                    </Text>
                  )}
                </Paper>
              ))}
            </Stack>
          </ScrollArea>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Text size="sm" fw={600} mb={4}>
            4. Dados do agendamento
          </Text>
          {!dia ? (
            <Text size="xs" c="dimmed">
              Selecione o dia e horário.
            </Text>
          ) : (
            <Stack gap={6}>
              <Alert color="teal" p="xs">
                {rota?.nome} · {fmtData(dia.data)} às {dia.horaSaida} · {dia.livres} vaga(s) livre(s) · {dia.veiculo}
              </Alert>
              <SelecaoRef entidade="local_destino" rotulo="Local de destino" valor={form.localDestinoId} aoMudar={(v) => f({ localDestinoId: v })} />
              <SelecaoRef entidade="motivo_viagem" rotulo="Motivo do transporte" valor={form.motivoId} aoMudar={(v) => f({ motivoId: v })} />
              <SelecaoRef entidade="local_embarque" rotulo="Local do embarque" valor={form.localEmbarqueId} aoMudar={(v) => f({ localEmbarqueId: v })} />
              <Group grow>
                <TextInput size="xs" type="time" label="Horário de saída" value={form.horaSaida ?? dia.horaSaida} onChange={(e) => f({ horaSaida: e.currentTarget.value })} />
                <TextInput size="xs" type="time" label="Horário do atendimento" value={form.horarioCompromisso ?? ''} onChange={(e) => f({ horarioCompromisso: e.currentTarget.value || null })} />
              </Group>
              <Group grow align="end">
                <Select size="xs" label="Tipo da viagem" data={TIPOS_VIAGEM} value={form.tipoViagem} onChange={(v) => f({ tipoViagem: v })} allowDeselect={false} />
                <Select
                  size="xs"
                  label="Necessidade"
                  data={[
                    { value: 'NENHUMA', label: 'Nenhuma' },
                    { value: 'MACA', label: 'Maca' },
                    { value: 'CADEIRA_RODAS', label: 'Cadeira de rodas' },
                  ]}
                  value={form.necessidade}
                  onChange={(v) => f({ necessidade: v })}
                  allowDeselect={false}
                />
              </Group>
              <Tooltip label="Quando não ocupa vaga (ex.: criança de colo) não é computado nas vagas da viagem (TR 1.2.40.13)">
                <Switch label="Paciente ocupa vaga" checked={form.ocupaVaga} onChange={(e) => f({ ocupaVaga: e.currentTarget.checked, poltrona: e.currentTarget.checked ? form.poltrona : null })} />
              </Tooltip>
              {poltronas && form.ocupaVaga && (
                <Stack gap={2}>
                  <Text size="xs">Poltrona do paciente {form.poltrona ? `: ${form.poltrona}` : '(opcional)'}</Text>
                  <MapaPoltronas
                    vagas={poltronas.vagas}
                    ocupadas={poltronas.ocupadas}
                    escolhidas={[form.poltrona, ...acompanhantes.map((a) => a.poltrona)]}
                    aoEscolher={(n) => f({ poltrona: form.poltrona === n ? null : n })}
                  />
                </Stack>
              )}
              <EditorAcompanhantes lista={acompanhantes} aoMudar={setAcompanhantes} poltronas={poltronas?.vagas} />
              <TextInput size="xs" label="Observação" value={form.observacao ?? ''} onChange={(e) => f({ observacao: e.currentTarget.value })} />
              <Button leftSection={<IconCheck size={16} />} loading={gravando} onClick={() => void agendar()}>
                Agendar e imprimir comprovante
              </Button>
            </Stack>
          )}
        </Grid.Col>
      </Grid>
      <Divider label="Agendamentos do paciente" />
      <TabelaSimples
        linhas={historico.dados?.viagens ?? []}
        colunas={[
          { titulo: 'Data', valor: (l: any) => `${fmtData(l.data_saida)} ${l.hora_saida}` },
          { titulo: 'Rota', valor: (l) => l.rota ?? 'Viagem extra' },
          { titulo: 'Destino', valor: (l) => [l.municipio, l.local_destino].filter(Boolean).join(' - ') },
          { titulo: 'Protocolo', valor: (l) => l.protocolo },
          { titulo: 'Poltrona', valor: (l) => l.poltrona ?? (l.ocupa_vaga ? '-' : 'não ocupa') },
          { titulo: 'Acomp.', valor: (l) => (l.indefinidos ? <Badge color="orange" size="xs">{`${l.acompanhantes} (${l.indefinidos} a definir)`}</Badge> : l.acompanhantes) },
          { titulo: 'Situação', valor: (l) => <Situacao valor={l.situacao} /> },
          {
            titulo: '',
            valor: (l) => (
              <Group gap={4} wrap="nowrap">
                <Tooltip label="Comprovante (impressora padrão)">
                  <ActionIcon variant="subtle" onClick={() => void abrirPdf(`/api/transporte/passageiros/${l.id}/comprovante?termica=false`)}>
                    <IconPrinter size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Comprovante (impressora térmica)">
                  <ActionIcon variant="subtle" onClick={() => void abrirPdf(`/api/transporte/passageiros/${l.id}/comprovante?termica=true`)}>
                    <IconReceipt size={14} />
                  </ActionIcon>
                </Tooltip>
                {['AGENDADO', 'CONFIRMADO'].includes(l.situacao) && ['ABERTA', 'CONFIRMADA'].includes(l.situacao_viagem) && (
                  <Tooltip label="Cancelar agendamento">
                    <ActionIcon variant="subtle" color="red" onClick={() => void cancelar(l.id)}>
                      <IconX size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            ),
          },
        ]}
      />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Inclusão de passageiro sem agendamento e viagem sem agendamento prévio (TR 1.2.40.17, 1.2.40.19)
// ---------------------------------------------------------------------------
interface PassageiroAvulso {
  chave: number;
  pacienteId: number | null;
  localDestinoId?: number | null;
  municipioDestinoId?: number | null;
  tipoViagem: string;
  ocupaVaga: boolean;
  poltrona?: number | null;
  acompanhantes: Acompanhante[];
}
const novoPassageiro = (): PassageiroAvulso => ({ chave: ++seq, pacienteId: null, tipoViagem: 'IDA_VOLTA', ocupaVaga: true, acompanhantes: [] });
const corpoPassageiro = (p: PassageiroAvulso) => ({
  pacienteId: p.pacienteId,
  localDestinoId: p.localDestinoId ?? null,
  municipioDestinoId: p.municipioDestinoId ?? null,
  tipoViagem: p.tipoViagem,
  ocupaVaga: p.ocupaVaga,
  poltrona: p.poltrona ?? null,
  acompanhantes: corpoAcompanhantes(p.acompanhantes),
});

function EditorPassageiro({ p, aoMudar, aoRemover }: { p: PassageiroAvulso; aoMudar: (x: PassageiroAvulso) => void; aoRemover?: () => void }) {
  return (
    <Paper withBorder p="xs">
      <Stack gap={6}>
        <Group grow align="end">
          <SelecaoRef entidade="paciente" rotulo="Paciente" obrigatorio valor={p.pacienteId} aoMudar={(v) => aoMudar({ ...p, pacienteId: v })} />
          <SelecaoRef entidade="local_destino" rotulo="Destino do paciente" valor={p.localDestinoId} aoMudar={(v) => aoMudar({ ...p, localDestinoId: v })} />
        </Group>
        <Group align="end">
          <Select size="xs" label="Tipo da viagem" w={140} data={TIPOS_VIAGEM} value={p.tipoViagem} onChange={(v) => aoMudar({ ...p, tipoViagem: v ?? 'IDA_VOLTA' })} allowDeselect={false} />
          <NumberInput size="xs" label="Poltrona" w={90} min={1} value={p.poltrona ?? ''} onChange={(v) => aoMudar({ ...p, poltrona: v === '' ? null : Number(v) })} />
          <Switch size="xs" label="Ocupa vaga" checked={p.ocupaVaga} onChange={(e) => aoMudar({ ...p, ocupaVaga: e.currentTarget.checked })} mb={6} />
          {aoRemover && (
            <ActionIcon color="red" variant="subtle" onClick={aoRemover} mb={4}>
              <IconTrash size={14} />
            </ActionIcon>
          )}
        </Group>
        <EditorAcompanhantes lista={p.acompanhantes} aoMudar={(l) => aoMudar({ ...p, acompanhantes: l })} />
      </Stack>
    </Paper>
  );
}

function ModalViagemAvulsa({ aberto, aoFechar, aoCriar }: { aberto: boolean; aoFechar: () => void; aoCriar: (id: number) => void }) {
  const [f, setF] = useState<Record<string, any>>({ dataSaida: hoje(), horaSaida: '07:00' });
  const [passageiros, setPassageiros] = useState<PassageiroAvulso[]>([novoPassageiro()]);
  const [gravando, setGravando] = useState(false);
  async function gravar() {
    setGravando(true);
    try {
      const r = await api.post('/api/transporte/viagens', { ...f, confirmar: true, passageiros: passageiros.filter((p) => p.pacienteId).map(corpoPassageiro) });
      notificarOk(`Viagem nº ${r.id} cadastrada e confirmada.`);
      setPassageiros([novoPassageiro()]);
      aoCriar(r.id);
    } catch (e) {
      notificarErro(e);
    } finally {
      setGravando(false);
    }
  }
  return (
    <Modal opened={aberto} onClose={aoFechar} title="Viagem sem agendamento prévio" size="xl">
      <Stack gap="xs">
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
          <TextInput size="xs" type="date" label="Data de saída" value={f.dataSaida} onChange={(e) => setF({ ...f, dataSaida: e.currentTarget.value })} />
          <TextInput size="xs" type="time" label="Horário de saída" value={f.horaSaida} onChange={(e) => setF({ ...f, horaSaida: e.currentTarget.value })} />
          <NumberInput size="xs" label="Valor da viagem (R$)" min={0} decimalScale={2} value={f.valorViagem ?? ''} onChange={(v) => setF({ ...f, valorViagem: v === '' ? null : Number(v) })} />
          <SelecaoRef entidade="motivo_viagem" rotulo="Motivo" obrigatorio valor={f.motivoId} aoMudar={(v) => setF({ ...f, motivoId: v })} />
          <SelecaoRef entidade="municipio" rotulo="Destino final (município)" obrigatorio valor={f.municipioDestinoId} aoMudar={(v) => setF({ ...f, municipioDestinoId: v })} />
          <SelecaoRef entidade="local_destino" rotulo="Local de destino" valor={f.localDestinoId} aoMudar={(v) => setF({ ...f, localDestinoId: v })} />
          <SelecaoRef entidade="veiculo" rotulo="Veículo" obrigatorio valor={f.veiculoId} aoMudar={(v) => setF({ ...f, veiculoId: v })} filtro={{ ativo: true }} />
          <SelecaoRef entidade="condutor" rotulo="Condutor" obrigatorio valor={f.condutorId} aoMudar={(v) => setF({ ...f, condutorId: v })} filtro={{ ativo: true }} />
          <SelecaoRef entidade="local_embarque" rotulo="Local de embarque" valor={f.localEmbarqueId} aoMudar={(v) => setF({ ...f, localEmbarqueId: v })} />
        </SimpleGrid>
        <Group justify="space-between">
          <Text fw={600} size="sm">
            Pacientes transportados
          </Text>
          <Button size="compact-xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setPassageiros([...passageiros, novoPassageiro()])}>
            Paciente
          </Button>
        </Group>
        {passageiros.map((p) => (
          <EditorPassageiro key={p.chave} p={p} aoMudar={(x) => setPassageiros(passageiros.map((y) => (y.chave === p.chave ? x : y)))} aoRemover={() => setPassageiros(passageiros.filter((y) => y.chave !== p.chave))} />
        ))}
        <Text size="xs" c="dimmed">
          A viagem é confirmada na inclusão, permitindo incluir os pacientes sem agendamento prévio (TR 1.2.40.19).
        </Text>
        <Group justify="end">
          <Button loading={gravando} onClick={() => void gravar()}>
            Cadastrar viagem
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Gestão das viagens: confirmação, passageiros, presença, adiantamentos e fechamento
// ---------------------------------------------------------------------------
function DetalheViagem({ id, aoAlterar }: { id: number; aoAlterar: () => void }) {
  const { dados, recarregar } = useCarregar<any>(() => api.get(`/api/transporte/viagens/${id}`), [id]);
  const [incluir, setIncluir] = useState<PassageiroAvulso | null>(null);
  const [identificar, setIdentificar] = useState<any>(null);
  const [adiant, setAdiant] = useState<Record<string, any>>({ data: hoje() });
  const [desp, setDesp] = useState<Record<string, any>>({ data: hoje(), quantidade: 1 });
  const [fecha, setFecha] = useState<Record<string, any>>({ dataChegada: hoje() });
  useEffect(() => {
    if (dados?.viagem) setFecha((x) => ({ ...x, kmInicial: dados.viagem.km_inicial ?? dados.viagem.km_atual ?? null, dataChegada: dados.viagem.data_saida > hoje() ? dados.viagem.data_saida : hoje() }));
  }, [dados?.viagem?.id]);
  if (!dados) return <Text c="dimmed">Carregando...</Text>;
  const v = dados.viagem;
  const aberta = ['ABERTA', 'CONFIRMADA'].includes(v.situacao);
  const recarregarTudo = async () => {
    await recarregar();
    aoAlterar();
  };
  const exec = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      notificarOk(msg);
      await recarregarTudo();
    } catch (e) {
      notificarErro(e);
    }
  };
  const ativos = dados.passageiros.filter((p: any) => p.situacao !== 'CANCELADO');
  const indefinidos = ativos.flatMap((p: any) => p.acompanhantes.filter((a: any) => a.indefinido).map((a: any) => ({ ...a, paciente: p.paciente })));

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="start">
        <Stack gap={0}>
          <Title order={5}>
            Viagem nº {v.id} · {fmtData(v.data_saida)} às {String(v.hora_saida ?? '').slice(0, 5)} <Badge color={COR_VIAGEM[v.situacao]}>{v.situacao}</Badge>{' '}
            {v.sem_agendamento && (
              <Badge color="grape" variant="light">
                sem agendamento prévio
              </Badge>
            )}
          </Title>
          <Text size="sm">
            {v.rota ?? 'Viagem extra'} · {[v.municipio, v.local_destino].filter(Boolean).join(' - ')} · {v.motivo ?? '-'}
          </Text>
          <Text size="xs" c="dimmed">
            Veículo {v.placa} {v.modelo} ({v.capacidade} lugares, {v.macas} maca, {v.cadeiras_rodas} cadeira) · Condutor {v.condutor ?? '-'} CNH {v.cnh_numero ?? '-'} · Embarque {v.local_embarque ?? '-'}
          </Text>
          <Text size="xs">
            Ocupação: <b>{dados.ocupacao.ocupadas}</b> de {dados.ocupacao.vagas} vagas (ida {dados.ocupacao.ida} / volta {dados.ocupacao.volta}) · {dados.ocupacao.pacientes} paciente(s)
            {v.confirmada_em && ` · confirmada em ${dayjs(v.confirmada_em).format('DD/MM/YYYY HH:mm')} por ${v.confirmada_por_nome ?? '-'}`}
          </Text>
        </Stack>
        <Group gap={4}>
          <Button size="xs" variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/transporte/viagens/${id}/relacao-passageiros`)}>
            Relação de passageiros
          </Button>
          <Button size="xs" variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/transporte/viagens/${id}/ordem-trafego`)}>
            Ordem de tráfego
          </Button>
          {v.situacao === 'ABERTA' && (
            <Button size="xs" color="cyan" leftSection={<IconCheck size={14} />} onClick={() => void exec(() => api.post(`/api/transporte/viagens/${id}/confirmar`, {}), 'Viagem confirmada.')}>
              Confirmar viagem
            </Button>
          )}
          {aberta && (
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={async () => {
                const motivo = await pedirTexto('Cancelar viagem', 'Motivo do cancelamento');
                if (motivo) await exec(() => api.post(`/api/transporte/viagens/${id}/cancelar`, { motivo }), 'Viagem cancelada.');
              }}
            >
              Cancelar viagem
            </Button>
          )}
        </Group>
      </Group>
      {aberta && (
        <Paper withBorder p={6}>
          <Group gap="xs" align="end">
            <SelecaoOpcoes entidade="veiculo" rotulo="Veículo" valor={v.veiculo_id} aoMudar={(x) => void exec(() => api.patch(`/api/transporte/viagens/${id}`, { veiculoId: x }), 'Veículo alterado.')} />
            <SelecaoOpcoes entidade="condutor" rotulo="Condutor" valor={v.condutor_id} aoMudar={(x) => void exec(() => api.patch(`/api/transporte/viagens/${id}`, { condutorId: x }), 'Condutor alterado.')} />
          </Group>
        </Paper>
      )}
      <Tabs defaultValue="passageiros" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="passageiros">Passageiros ({ativos.length})</Tabs.Tab>
          <Tabs.Tab value="adiantamentos">Adiantamentos</Tabs.Tab>
          <Tabs.Tab value="fechamento">Despesas e fechamento</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="passageiros" pt="xs">
          {indefinidos.length > 0 && (
            <Alert color="orange" mb="xs" p="xs">
              {indefinidos.length} acompanhante(s) a definir — a viagem não pode ser concluída sem identificá-los (TR 1.2.40.20).
            </Alert>
          )}
          <ScrollArea>
            <Table fz="xs" striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Polt.</Table.Th>
                  <Table.Th>Paciente</Table.Th>
                  <Table.Th>Destino</Table.Th>
                  <Table.Th>Viagem</Table.Th>
                  <Table.Th>Acompanhantes</Table.Th>
                  <Table.Th>Situação</Table.Th>
                  <Table.Th>Ausência</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {dados.passageiros.map((p: any) => (
                  <Table.Tr key={p.id} style={{ opacity: p.situacao === 'CANCELADO' ? 0.5 : 1 }}>
                    <Table.Td>{p.poltrona ?? (p.ocupa_vaga ? '-' : 'não ocupa')}</Table.Td>
                    <Table.Td>
                      {p.paciente}
                      <Text size="xs" c="dimmed">
                        {p.protocolo} {p.sem_agendamento ? '· sem agendamento' : ''} {p.tfd_numero ? `· TFD ${p.tfd_numero}` : ''} {p.necessidade !== 'NENHUMA' ? `· ${p.necessidade}` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>{[p.municipio_destino, p.local_destino].filter(Boolean).join(' - ')}</Table.Td>
                    <Table.Td>{ROTULO_TIPO[p.tipo_viagem]}</Table.Td>
                    <Table.Td>
                      {p.acompanhantes.map((a: any) =>
                        a.indefinido ? (
                          <Button key={a.id} size="compact-xs" color="orange" variant="light" disabled={!aberta} onClick={() => setIdentificar(a)}>
                            Identificar acompanhante
                          </Button>
                        ) : (
                          <Text key={a.id} size="xs">
                            {a.nome} · {ROTULO_TIPO[a.tipo_viagem]}
                            {a.poltrona ? ` · polt. ${a.poltrona}` : ''}
                            {a.ocupa_vaga ? '' : ' · não ocupa vaga'}
                          </Text>
                        ),
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Situacao valor={p.situacao} />
                    </Table.Td>
                    <Table.Td>
                      {p.situacao === 'FALTA' ? (
                        <Text size="xs">{p.observacao_ausencia}</Text>
                      ) : aberta && p.situacao !== 'CANCELADO' ? (
                        <Button
                          size="compact-xs"
                          color="red"
                          variant="light"
                          onClick={async () => {
                            const obs = await pedirTexto('Registrar ausência do paciente', 'Observação sobre a ausência');
                            if (obs) await exec(() => api.post(`/api/transporte/viagens/${id}/presenca`, { itens: [{ passageiroId: p.id, presente: false, observacao: obs }] }), 'Ausência registrada.');
                          }}
                        >
                          Faltou
                        </Button>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} wrap="nowrap">
                        <Tooltip label="Comprovante">
                          <ActionIcon variant="subtle" onClick={() => void abrirPdf(`/api/transporte/passageiros/${p.id}/comprovante`)}>
                            <IconPrinter size={14} />
                          </ActionIcon>
                        </Tooltip>
                        {aberta && p.situacao === 'FALTA' && (
                          <Tooltip label="Desfazer ausência">
                            <ActionIcon variant="subtle" onClick={() => void exec(() => api.post(`/api/transporte/viagens/${id}/presenca`, { itens: [{ passageiroId: p.id, presente: true }] }), 'Presença registrada.')}>
                              <IconCheck size={14} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          {aberta && (
            <Group mt="xs">
              <Tooltip label={v.situacao !== 'CONFIRMADA' ? 'Confirme a viagem para incluir pacientes sem agendamento prévio (TR 1.2.40.19)' : ''} disabled={v.situacao === 'CONFIRMADA'}>
                <Button size="xs" variant="light" leftSection={<IconUserPlus size={14} />} disabled={v.situacao !== 'CONFIRMADA'} onClick={() => setIncluir(novoPassageiro())}>
                  Incluir paciente sem agendamento
                </Button>
              </Tooltip>
            </Group>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="adiantamentos" pt="xs">
          <TabelaSimples
            linhas={dados.adiantamentos}
            colunas={[
              { titulo: 'Data', valor: (a: any) => fmtData(a.data) },
              { titulo: 'Beneficiário', valor: (a) => a.condutor ?? '-' },
              { titulo: 'Finalidade', valor: (a) => a.finalidade ?? '' },
              { titulo: 'Valor', valor: (a) => moeda(a.valor) },
              {
                titulo: '',
                valor: (a) => (
                  <Button size="compact-xs" variant="subtle" leftSection={<IconPrinter size={12} />} onClick={() => void abrirPdf(`/api/transporte/adiantamentos/${a.id}/requisicao`)}>
                    Requisição
                  </Button>
                ),
              },
            ]}
          />
          {aberta && (
            <Group mt="xs" align="end">
              <TextInput size="xs" type="date" label="Data" value={adiant.data} onChange={(e) => setAdiant({ ...adiant, data: e.currentTarget.value })} />
              <NumberInput size="xs" label="Valor (R$)" min={0} decimalScale={2} w={110} value={adiant.valor ?? ''} onChange={(x) => setAdiant({ ...adiant, valor: x === '' ? null : Number(x) })} />
              <TextInput size="xs" label="Finalidade" w={260} value={adiant.finalidade ?? ''} onChange={(e) => setAdiant({ ...adiant, finalidade: e.currentTarget.value })} />
              <Button
                size="xs"
                onClick={() =>
                  void exec(async () => {
                    const r = await api.post(`/api/transporte/viagens/${id}/adiantamentos`, { data: adiant.data, valor: adiant.valor, finalidade: adiant.finalidade || null });
                    setAdiant({ data: hoje() });
                    void abrirPdf(`/api/transporte/adiantamentos/${r.id}/requisicao`);
                  }, 'Adiantamento lançado.')
                }
              >
                Lançar e imprimir requisição
              </Button>
            </Group>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="fechamento" pt="xs">
          <SimpleGrid cols={3} mb="xs">
            <Paper withBorder p="xs">
              <Text size="xs" c="dimmed">
                Valor adiantado
              </Text>
              <Text fw={700}>{moeda(dados.contas.adiantado)}</Text>
            </Paper>
            <Paper withBorder p="xs">
              <Text size="xs" c="dimmed">
                Despesas
              </Text>
              <Text fw={700}>{moeda(dados.contas.despesas)}</Text>
            </Paper>
            <Paper withBorder p="xs">
              <Text size="xs" c="dimmed">
                Saldo (a devolver / a receber)
              </Text>
              <Text fw={700} c={dados.contas.saldo < 0 ? 'red' : 'teal'}>
                {moeda(dados.contas.saldo)}
              </Text>
            </Paper>
          </SimpleGrid>
          <TabelaSimples
            linhas={dados.despesas}
            colunas={[
              { titulo: 'Data', valor: (d: any) => fmtData(d.data) },
              { titulo: 'Grupo', valor: (d) => d.grupo },
              { titulo: 'Despesa', valor: (d) => `${d.despesa}${d.descricao ? ` - ${d.descricao}` : ''}` },
              { titulo: 'Qtd.', valor: (d) => `${Number(d.quantidade).toLocaleString('pt-BR')} ${d.unidade_medida ?? ''}` },
              { titulo: 'Unitário', valor: (d) => moeda(d.valor_unitario) },
              { titulo: 'Total', valor: (d) => moeda(d.valor_total) },
              {
                titulo: '',
                valor: (d) =>
                  aberta ? (
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={() => void exec(() => api.delete(`/api/transporte/despesas/${d.id}`), 'Despesa removida.')}>
                      <IconTrash size={12} />
                    </ActionIcon>
                  ) : null,
              },
            ]}
          />
          {aberta && (
            <Group mt="xs" align="end">
              <SelecaoOpcoes entidade="despesa_transporte" rotulo="Despesa" valor={desp.despesaId} aoMudar={(x) => setDesp({ ...desp, despesaId: x })} />
              <TextInput size="xs" type="date" label="Data" value={desp.data} onChange={(e) => setDesp({ ...desp, data: e.currentTarget.value })} />
              <NumberInput size="xs" label="Quantidade" w={90} min={0} decimalScale={3} value={desp.quantidade ?? ''} onChange={(x) => setDesp({ ...desp, quantidade: x === '' ? null : Number(x) })} />
              <NumberInput size="xs" label="Valor unitário" w={100} min={0} decimalScale={3} value={desp.valorUnitario ?? ''} onChange={(x) => setDesp({ ...desp, valorUnitario: x === '' ? null : Number(x) })} />
              <TextInput size="xs" label="Descrição" w={160} value={desp.descricao ?? ''} onChange={(e) => setDesp({ ...desp, descricao: e.currentTarget.value })} />
              <Button
                size="xs"
                variant="light"
                onClick={() =>
                  void exec(async () => {
                    await api.post(`/api/transporte/viagens/${id}/despesas`, { ...desp, descricao: desp.descricao || null });
                    setDesp({ data: desp.data, quantidade: 1 });
                  }, 'Despesa lançada.')
                }
              >
                Lançar despesa
              </Button>
            </Group>
          )}
          <Divider my="xs" label="Fechamento da viagem" />
          {v.situacao === 'CONCLUIDA' ? (
            <Alert color="green">
              Concluída: chegada em {fmtData(v.data_chegada)} às {String(v.hora_chegada ?? '').slice(0, 5)} · km {v.km_inicial} → {v.km_final} ({(v.km_final ?? 0) - (v.km_inicial ?? 0)} km) · custo por paciente {moeda(v.custo_paciente)} · fechada por{' '}
              {v.fechada_por_nome ?? '-'}
            </Alert>
          ) : v.situacao === 'CONFIRMADA' ? (
            <Group align="end">
              <TextInput size="xs" type="date" label="Data de chegada" value={fecha.dataChegada} onChange={(e) => setFecha({ ...fecha, dataChegada: e.currentTarget.value })} />
              <TextInput size="xs" type="time" label="Horário de chegada" value={fecha.horaChegada ?? ''} onChange={(e) => setFecha({ ...fecha, horaChegada: e.currentTarget.value })} />
              <NumberInput size="xs" label="Km inicial" w={110} min={0} value={fecha.kmInicial ?? ''} onChange={(x) => setFecha({ ...fecha, kmInicial: x === '' ? null : Number(x) })} />
              <NumberInput size="xs" label="Km final" w={110} min={0} value={fecha.kmFinal ?? ''} onChange={(x) => setFecha({ ...fecha, kmFinal: x === '' ? null : Number(x) })} />
              <Button
                size="xs"
                color="green"
                disabled={indefinidos.length > 0}
                onClick={async () => {
                  if (!(await confirmar('Fechar viagem', `Adiantado ${moeda(dados.contas.adiantado)} · despesas ${moeda(dados.contas.despesas)} · saldo ${moeda(dados.contas.saldo)}. Confirma o fechamento?`))) return;
                  await exec(async () => {
                    const r = await api.post(`/api/transporte/viagens/${id}/fechar`, fecha);
                    notificarOk(`Saldo da prestação de contas: ${moeda(r.saldo)} · custo por paciente ${moeda(r.custoPaciente)}.`);
                  }, 'Viagem fechada.');
                }}
              >
                Fechar viagem
              </Button>
            </Group>
          ) : (
            <Text size="xs" c="dimmed">
              Confirme a viagem para registrar o fechamento.
            </Text>
          )}
        </Tabs.Panel>
      </Tabs>

      <Modal opened={!!incluir} onClose={() => setIncluir(null)} title="Incluir paciente sem agendamento prévio" size="lg">
        {incluir && (
          <Stack>
            <EditorPassageiro p={incluir} aoMudar={setIncluir} />
            <Button
              onClick={() =>
                void exec(async () => {
                  const r = await api.post(`/api/transporte/viagens/${id}/passageiros`, corpoPassageiro(incluir));
                  setIncluir(null);
                  void abrirPdf(`/api/transporte/passageiros/${r.id}/comprovante`);
                }, 'Paciente incluído na viagem.')
              }
            >
              Incluir
            </Button>
          </Stack>
        )}
      </Modal>
      <ModalIdentificar
        acompanhante={identificar}
        aoFechar={() => setIdentificar(null)}
        aoSalvar={async (corpo) => {
          await exec(() => api.patch(`/api/transporte/acompanhantes/${identificar.id}`, corpo), 'Acompanhante identificado.');
          setIdentificar(null);
        }}
      />
    </Stack>
  );
}

function ModalIdentificar({ acompanhante, aoFechar, aoSalvar }: { acompanhante: any; aoFechar: () => void; aoSalvar: (c: Record<string, any>) => Promise<void> }) {
  const [c, setC] = useState<Record<string, any>>({});
  useEffect(() => setC({}), [acompanhante?.id]);
  return (
    <Modal opened={!!acompanhante} onClose={aoFechar} title="Identificar acompanhante (TR 1.2.40.20)">
      <Stack gap="xs">
        <SelecaoRef entidade="paciente" rotulo="Pessoa cadastrada (opcional)" valor={c.pessoaId} aoMudar={(v) => setC({ ...c, pessoaId: v })} />
        <TextInput label="Nome" value={c.nome ?? ''} onChange={(e) => setC({ ...c, nome: e.currentTarget.value })} />
        <Group grow>
          <TextInput label="Documento" value={c.documento ?? ''} onChange={(e) => setC({ ...c, documento: e.currentTarget.value })} />
          <TextInput label="Parentesco" value={c.parentesco ?? ''} onChange={(e) => setC({ ...c, parentesco: e.currentTarget.value })} />
        </Group>
        <Button disabled={!c.pessoaId && !c.nome?.trim()} onClick={() => void aoSalvar({ pessoaId: c.pessoaId ?? null, nome: c.nome || null, documento: c.documento || null, parentesco: c.parentesco || null })}>
          Gravar
        </Button>
      </Stack>
    </Modal>
  );
}

function TelaViagens({ query }: { query: URLSearchParams }) {
  useTituloJanela('Gestão de viagens');
  const [filtro, setFiltro] = useState<Record<string, any>>({ de: hoje(), ate: dayjs().add(7, 'day').format('YYYY-MM-DD'), situacao: '' });
  const [sel, setSel] = useState<number | null>(query.get('viagem') ? Number(query.get('viagem')) : null);
  const [avulsa, setAvulsa] = useState(false);
  const { dados, recarregar } = useCarregar<any[]>(() => api.get('/api/transporte/viagens', filtro), [filtro.de, filtro.ate, filtro.situacao]);
  const linhas = useMemo(() => dados ?? [], [dados]);
  return (
    <Stack gap="xs">
      <Group align="end" justify="space-between">
        <Group align="end">
          <TextInput size="xs" type="date" label="De" value={filtro.de} onChange={(e) => setFiltro({ ...filtro, de: e.currentTarget.value })} />
          <TextInput size="xs" type="date" label="Até" value={filtro.ate} onChange={(e) => setFiltro({ ...filtro, ate: e.currentTarget.value })} />
          <SegmentedControl
            size="xs"
            value={filtro.situacao}
            onChange={(v) => setFiltro({ ...filtro, situacao: v })}
            data={[
              { value: '', label: 'Todas' },
              { value: 'ABERTA', label: 'Abertas' },
              { value: 'CONFIRMADA', label: 'Confirmadas' },
              { value: 'CONCLUIDA', label: 'Concluídas' },
              { value: 'CANCELADA', label: 'Canceladas' },
            ]}
          />
        </Group>
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setAvulsa(true)}>
          Viagem sem agendamento prévio
        </Button>
      </Group>
      <Grid>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <ScrollArea h="70vh">
            <Table fz="xs" highlightOnHover striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Saída</Table.Th>
                  <Table.Th>Rota / destino</Table.Th>
                  <Table.Th>Veículo</Table.Th>
                  <Table.Th>Vagas</Table.Th>
                  <Table.Th>Situação</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {linhas.map((l) => (
                  <Table.Tr key={l.id} onClick={() => setSel(l.id)} style={{ cursor: 'pointer' }} bg={sel === l.id ? 'var(--mantine-color-blue-light)' : undefined}>
                    <Table.Td>
                      {fmtData(l.data_saida)} {l.hora_saida}
                    </Table.Td>
                    <Table.Td>
                      {l.rota ?? <i>Viagem extra</i>}
                      <Text size="xs" c="dimmed">
                        {l.municipio}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {l.veiculo}
                      <Text size="xs" c="dimmed">
                        {l.condutor}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {l.ocupadas}/{l.vagas}
                      {l.indefinidos > 0 && (
                        <Badge size="xs" color="orange" ml={4}>
                          {l.indefinidos} a definir
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" color={COR_VIAGEM[l.situacao]}>
                        {l.situacao}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {!linhas.length && (
              <Text size="sm" c="dimmed" p="xs">
                Nenhuma viagem no período.
              </Text>
            )}
          </ScrollArea>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          {sel ? (
            <DetalheViagem key={sel} id={sel} aoAlterar={() => void recarregar()} />
          ) : (
            <Text c="dimmed" size="sm">
              Selecione uma viagem.
            </Text>
          )}
        </Grid.Col>
      </Grid>
      <ModalViagemAvulsa
        aberto={avulsa}
        aoFechar={() => setAvulsa(false)}
        aoCriar={(id) => {
          setAvulsa(false);
          setSel(id);
          void recarregar();
        }}
      />
    </Stack>
  );
}

// Atalhos no cadastro genérico da viagem.
function AcoesViagem({ r }: { r: any }) {
  const { abrir } = useJanelas();
  return (
    <Group gap={4}>
      <Button variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/transporte/viagens/${r.id}/ordem-trafego`)}>
        Ordem de tráfego
      </Button>
      <Button variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/transporte/viagens/${r.id}/relacao-passageiros`)}>
        Relação de passageiros
      </Button>
      <Button onClick={() => abrir(`/t/transporte/viagens?viagem=${r.id}`, 'Gestão de viagens')}>Gerenciar viagem</Button>
    </Group>
  );
}
registrarExtensaoFormulario('viagem', { acoes: (r) => (r?.id ? <AcoesViagem r={r} /> : null) });

registrarTela({
  id: 'transporte-agendamento',
  titulo: 'Agendar transporte',
  menu: 'Transporte',
  padrao: '/t/transporte/agendamento',
  permissao: 'viagem:incluir',
  modulo: 'TRA',
  palavras: ['viagem', 'rota', 'transporte', 'vaga', 'poltrona'],
  ordem: 1,
  render: ({ query }) => <TelaAgendamentoTransporte query={query} />,
});
registrarTela({
  id: 'transporte-viagens',
  titulo: 'Gestão de viagens',
  menu: 'Transporte',
  padrao: '/t/transporte/viagens',
  permissao: 'viagem:consultar',
  modulo: 'TRA',
  palavras: ['confirmar viagem', 'fechamento', 'adiantamento', 'despesa', 'ordem de tráfego', 'relação de passageiros'],
  ordem: 2,
  render: ({ query }) => <TelaViagens query={query} />,
});
registrarMenuRelatorios('TRA', 'Transporte', 'viagem:exportar');
