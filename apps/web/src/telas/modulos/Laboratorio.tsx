// Laboratório (TR 1.2.47): recepção com pesquisas e destaque da UPA, conferência da requisição,
// coleta com recipientes/etiquetas/baixa de materiais, digitação sequencial por setor ou paciente,
// liberação com senha, laudos, entrega, mapas de trabalho e painel.
import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ColorSwatch,
  Divider,
  Grid,
  Group,
  Menu,
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
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import {
  IconArrowLeft,
  IconArrowRight,
  IconBarcode,
  IconCheck,
  IconDeviceFloppy,
  IconDots,
  IconEraser,
  IconFileTypePdf,
  IconFlask,
  IconLock,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconSearch,
  IconSignature,
  IconUpload,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useAuth } from '@/auth/Auth';
import { abrirPdf, comConfirmacao, fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, TabelaSimples, useCarregar } from '@/componentes/comum';
import { BuscaPaciente, CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { Formulario } from '@/genericos/Formulario';
import { confirmar, pedirSenha, pedirTexto } from '@/genericos/dialogos';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';
import { FormResultado, ListaAlertas, pdfPost, SituacaoItem, SituacaoReq, useAvaliacao, type Variavel } from './LaboratorioComum';

const hoje = () => dayjs().format('YYYY-MM-DD');
const data = (v?: string | null) => (v ? new Date(v + 'T12:00') : null);
const iso = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM-DD') : null);
const L = '/api/laboratorio';

function CampoData({ rotulo, valor, aoMudar, ...resto }: { rotulo: string; valor: string | null | undefined; aoMudar: (v: string | null) => void; clearable?: boolean; minDate?: Date }) {
  return <DateInput label={rotulo} valueFormat="DD/MM/YYYY" value={data(valor)} onChange={(d) => aoMudar(iso(d))} size="xs" {...resto} />;
}

// ---------------------------------------------------------------------------
// Recepção (TR 1.2.47.43.1 a 1.2.47.43.10)
// ---------------------------------------------------------------------------
const FILTROS_OPCAO: { nome: string; rotulo: string; opcoes: [string, string][] }[] = [
  { nome: 'coleta', rotulo: 'Coleta', opcoes: [['REALIZADA', 'Realizada'], ['NAO_REALIZADA', 'Não realizada'], ['PARCIAL', 'Parcial (mais de uma amostra)']] },
  { nome: 'presenca', rotulo: 'Presença', opcoes: [['AGENDADO', 'Agendados'], ['PRESENTE', 'Presentes'], ['FALTOU', 'Não compareceram']] },
  { nome: 'laudo', rotulo: 'Situação do laudo', opcoes: [['NAO_DIGITADO', 'Não digitado'], ['PARCIAL', 'Digitado parcialmente'], ['DIGITADO', 'Digitado'], ['ASSINADO', 'Assinado']] },
  { nome: 'impressao', rotulo: 'Impressão', opcoes: [['IMPRESSO', 'Impresso'], ['AGUARDANDO', 'Aguardando impressão']] },
  { nome: 'entrega', rotulo: 'Entrega', opcoes: [['AGUARDANDO', 'Aguardando entrega'], ['ENTREGUE', 'Entregue'], ['NAO_RETIRADA', 'Não retirado']] },
];

function TelaRecepcao() {
  useTituloJanela('Recepção e coleta');
  const [f, setF] = useState<Record<string, any>>({ de: hoje(), ate: hoje() });
  const [dados, setDados] = useState<{ linhas: any[]; destacarUpa: boolean; confirmarPresenca: boolean } | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const [aberta, setAberta] = useState<number | null>(null);
  const [coleta, setColeta] = useState<number | null>(null);
  const [nova, setNova] = useState(false);
  const carregar = () =>
    api
      .get(`${L}/recepcao`, f)
      .then((d) => (setDados(d), setSel([])))
      .catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [f]);
  const presenca = async (id: number, presente: boolean) => {
    try {
      const r = await api.post(`${L}/requisicoes/${id}/presenca`, { presente });
      notificarOk(presente ? (r.coleta ? 'Presença e coleta registradas.' : 'Presença confirmada.') : 'Falta registrada.');
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const linhas = dados?.linhas ?? [];
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Recepção e coleta</Title>
        <Group gap="xs">
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setNova(true)}>
            Receber requisição
          </Button>
          <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void carregar()}>
            Atualizar
          </Button>
        </Group>
      </Group>
      <Paper withBorder p="xs">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 6, md: 1.5 }}>
            <CampoData rotulo="De" valor={f.de} aoMudar={(v) => setF({ ...f, de: v })} clearable />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 1.5 }}>
            <CampoData rotulo="Até" valor={f.ate} aoMudar={(v) => setF({ ...f, ate: v })} clearable />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <TextInput
              size="xs"
              label="Paciente, código, prontuário, CPF, CNS, nº requisição ou amostra"
              leftSection={<IconSearch size={14} />}
              defaultValue={f.busca}
              onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, busca: e.currentTarget.value })}
              onBlur={(e) => e.currentTarget.value !== (f.busca ?? '') && setF({ ...f, busca: e.currentTarget.value })}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade solicitante" valor={f.unidadeSolicitanteId} aoMudar={(v) => setF({ ...f, unidadeSolicitanteId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <SelecaoRef entidade="procedimento" rotulo="Procedimento" valor={f.procedimentoId} aoMudar={(v) => setF({ ...f, procedimentoId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 1 }}>
            <SelecaoRef entidade="lab_secao" rotulo="Seção" valor={f.secaoId} aoMudar={(v) => setF({ ...f, secaoId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 1 }}>
            <SelecaoRef entidade="convenio" rotulo="Convênio" valor={f.convenioId} aoMudar={(v) => setF({ ...f, convenioId: v })} />
          </Grid.Col>
          {FILTROS_OPCAO.map((o) => (
            <Grid.Col key={o.nome} span={{ base: 6, md: 2 }}>
              <Select size="xs" label={o.rotulo} clearable data={o.opcoes.map(([value, label]) => ({ value, label }))} value={f[o.nome] ?? null} onChange={(v) => setF({ ...f, [o.nome]: v })} />
            </Grid.Col>
          ))}
          <Grid.Col span={{ base: 12, md: 2 }}>
            <Group gap={4}>
              <Button size="xs" variant="subtle" onClick={() => setF({ de: hoje(), ate: hoje() })}>
                Limpar filtros
              </Button>
            </Group>
          </Grid.Col>
        </Grid>
      </Paper>
      <Group gap="xs">
        <Badge variant="light">{linhas.length} requisição(ões)</Badge>
        {dados?.destacarUpa && <Badge color="orange" variant="light">UPA em destaque</Badge>}
        <Text size="xs" c="dimmed">
          {sel.length} selecionada(s):
        </Text>
        <Button size="compact-xs" variant="light" disabled={!sel.length} leftSection={<IconBarcode size={12} />} onClick={() => void pdfPost(`${L}/etiquetas`, { requisicaoIds: sel })}>
          Etiquetas em lote
        </Button>
        <Button size="compact-xs" variant="light" disabled={!sel.length} leftSection={<IconPrinter size={12} />} onClick={() => void pdfPost(`${L}/capas-faturamento`, { ids: sel })}>
          Capas de faturamento
        </Button>
        <Button size="compact-xs" variant="light" disabled={!sel.length} leftSection={<IconFileTypePdf size={12} />} onClick={() => void pdfPost(`${L}/laudos`, { requisicaoIds: sel }).then(() => carregar())}>
          Laudos em lote
        </Button>
        <Button size="compact-xs" variant="light" disabled={!sel.length} onClick={() => abrirPdf(`${L}/mapa?requisicoes=${sel.join(',')}`)}>
          Mapa de trabalho
        </Button>
      </Group>
      <Paper withBorder>
        <ScrollArea h="calc(100vh - 380px)">
          <Table fz="xs" striped highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={28}>
                  <Checkbox size="xs" checked={!!linhas.length && sel.length === linhas.length} onChange={(e) => setSel(e.currentTarget.checked ? linhas.map((l) => l.id) : [])} />
                </Table.Th>
                <Table.Th>Data</Table.Th>
                <Table.Th>Paciente</Table.Th>
                <Table.Th>Prontuário</Table.Th>
                <Table.Th>Solicitante</Table.Th>
                <Table.Th>Requisição</Table.Th>
                <Table.Th>Exames (procedimento · seção · material)</Table.Th>
                <Table.Th>Presença</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {linhas.map((l) => (
                <Table.Tr key={l.id} style={l.destaque ? { boxShadow: 'inset 4px 0 0 var(--mantine-color-orange-6)', background: 'var(--mantine-color-orange-0)' } : undefined}>
                  <Table.Td>
                    <Checkbox size="xs" checked={sel.includes(l.id)} onChange={(e) => setSel(e.currentTarget.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} />
                  </Table.Td>
                  <Table.Td>
                    {fmtData(l.data_agendada)} {l.hora_agendada ?? ''}
                  </Table.Td>
                  <Table.Td style={{ cursor: 'pointer' }} onClick={() => setAberta(l.id)}>
                    <Text size="xs" fw={600}>
                      {l.paciente}
                    </Text>
                    <Group gap={4}>
                      {l.destaque && <Badge size="xs" color="orange">UPA</Badge>}
                      {l.urgente && <Badge size="xs" color="red">Urgente</Badge>}
                      {l.convenio && l.convenio !== 'SUS' && <Badge size="xs" variant="outline">{l.convenio}</Badge>}
                    </Group>
                  </Table.Td>
                  <Table.Td>{l.prontuario ?? l.paciente_id}</Table.Td>
                  <Table.Td>
                    <Text size="xs">{l.unidade_solicitante ?? l.origem}</Text>
                    <Text size="10px" c="dimmed">
                      {l.profissional_solicitante}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ cursor: 'pointer' }} onClick={() => setAberta(l.id)}>
                    <Text size="xs" fw={600} c="blue">
                      {l.numero}
                    </Text>
                    <Text size="10px" c="dimmed">
                      Previsão {fmtData(l.previsao)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={3}>
                      {(l.exames ?? []).map((e: any) => (
                        <Tooltip key={e.id} label={`${e.exame} · ${e.procedimento} · ${e.secao ?? '-'} · ${e.material ?? '-'}`}>
                          <span>
                            <SituacaoItemCurta e={e} />
                          </span>
                        </Tooltip>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="dot" color={l.presenca === 'PRESENTE' ? 'teal' : l.presenca === 'FALTOU' ? 'red' : 'gray'}>
                      {l.presenca === 'FALTOU' ? 'Faltou' : l.presenca === 'PRESENTE' ? 'Presente' : 'Agendado'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <SituacaoReq valor={l.situacao} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={2} wrap="nowrap">
                      {l.presenca === 'AGENDADO' && dados?.confirmarPresenca && (
                        <Button size="compact-xs" variant="light" color="teal" onClick={() => void presenca(l.id, true)}>
                          Presente
                        </Button>
                      )}
                      {['RECEBIDA', 'COLETA_PARCIAL'].includes(l.situacao) && (
                        <Button size="compact-xs" leftSection={<IconFlask size={12} />} onClick={() => setColeta(l.id)}>
                          Coletar
                        </Button>
                      )}
                      <Menu withinPortal>
                        <Menu.Target>
                          <ActionIcon size="sm" variant="subtle">
                            <IconDots size={14} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item onClick={() => setAberta(l.id)}>Conferir / alterar</Menu.Item>
                          <Menu.Item onClick={() => void presenca(l.id, true)}>Confirmar presença</Menu.Item>
                          <Menu.Item onClick={() => void presenca(l.id, false)}>Registrar falta</Menu.Item>
                          <Menu.Divider />
                          <Menu.Item onClick={() => abrirPdf(`${L}/requisicoes/${l.id}/etiquetas`)}>Etiquetas</Menu.Item>
                          <Menu.Item onClick={() => abrirPdf(`${L}/requisicoes/${l.id}/comprovante`)}>Comprovante de coleta</Menu.Item>
                          <Menu.Item onClick={() => abrirPdf(`${L}/requisicoes/${l.id}/protocolo`)}>Protocolo e controle interno</Menu.Item>
                          <Menu.Item onClick={() => void pdfPost(`${L}/capas-faturamento`, { ids: [l.id] })}>Capa de faturamento</Menu.Item>
                          <Menu.Divider />
                          <Menu.Item onClick={() => abrirPdf(`${L}/requisicoes/${l.id}/laudo`).then(() => carregar())}>Imprimir laudo</Menu.Item>
                          <Menu.Item onClick={() => abrirPdf(`${L}/requisicoes/${l.id}/envelope`)}>Envelope</Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      {aberta && <ModalRequisicao id={aberta} aoFechar={() => (setAberta(null), void carregar())} aoColetar={(id) => (setAberta(null), setColeta(id))} />}
      {coleta && <ModalColeta id={coleta} aoFechar={() => (setColeta(null), void carregar())} />}
      {nova && <ModalNovaRequisicao aoFechar={(id) => (setNova(false), void carregar(), id && setAberta(id))} />}
    </Stack>
  );
}

function SituacaoItemCurta({ e }: { e: any }) {
  const cor: Record<string, string> = { AGUARDANDO_COLETA: 'gray', COLETADO: 'blue', EM_ANALISE: 'cyan', DIGITADO_PARCIAL: 'yellow', DIGITADO: 'orange', LIBERADO: 'green' };
  return (
    <Badge size="xs" variant={e.situacao === 'LIBERADO' ? 'filled' : 'light'} color={cor[e.situacao] ?? 'gray'}>
      {e.sigla}
      {e.situacao === 'LIBERADO' && e.impresso ? ' ✓' : ''}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Nova requisição: do prontuário ou externa (TR 1.2.47.19, 1.2.47.43.22)
// ---------------------------------------------------------------------------
function ModalNovaRequisicao({ aoFechar }: { aoFechar: (id?: number) => void }) {
  const [aba, setAba] = useState<string | null>('prontuario');
  const [busca, setBusca] = useState('');
  const { dados: pendentes, recarregar } = useCarregar(() => api.get<any[]>(`${L}/pendentes-prontuario`, { busca }), [busca]);
  const [f, setF] = useState<Record<string, any>>({ origem: 'EXTERNA', dataAgendada: hoje() });
  const [itens, setItens] = useState<{ exameId: number; rotulo: string; materialId: number | null }[]>([]);
  const { paciente } = usePaciente(f.pacienteId ?? null);
  const receber = async (solicitacaoId: number) => {
    try {
      const r = await comConfirmacao((ok) => api.post(`${L}/requisicoes`, { solicitacaoId, confirmarAvisos: ok }), 'Avisos da requisição');
      if (r) {
        notificarOk(`Requisição ${r.numero} recebida; previsão de entrega ${fmtData(r.data_prevista_entrega)}.`);
        void recarregar();
      }
    } catch (e) {
      notificarErro(e);
    }
  };
  const salvar = async () => {
    try {
      const r = await comConfirmacao((ok) => api.post(`${L}/requisicoes`, { ...f, itens, confirmarAvisos: ok }), 'Avisos da requisição');
      if (r) {
        notificarOk(`Requisição ${r.numero} cadastrada; previsão de entrega ${fmtData(r.data_prevista_entrega)}.`);
        aoFechar(r.id);
      }
    } catch (e) {
      notificarErro(e);
    }
  };
  return (
    <Modal opened onClose={() => aoFechar()} title="Receber requisição de exames" size="xl">
      <Tabs value={aba} onChange={setAba}>
        <Tabs.List>
          <Tabs.Tab value="prontuario">Requisições do prontuário / agendadas</Tabs.Tab>
          <Tabs.Tab value="externa">Requisição externa (balcão)</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="prontuario" pt="sm">
          <TextInput size="xs" mb="xs" placeholder="Nº da requisição ou nome do paciente" leftSection={<IconSearch size={14} />} onKeyDown={(e) => e.key === 'Enter' && setBusca(e.currentTarget.value)} />
          <ScrollArea h={420}>
            <TabelaSimples
              linhas={pendentes ?? []}
              vazio="Nenhuma requisição laboratorial pendente."
              colunas={[
                { titulo: 'Data', valor: (l: any) => fmtData(l.data_agendada ?? l.data) },
                { titulo: 'Requisição', valor: (l: any) => l.numero },
                { titulo: 'Paciente', valor: (l: any) => (<>{l.paciente} {l.origem_upa && <Badge size="xs" color="orange">UPA</Badge>}</>) },
                { titulo: 'Solicitante', valor: (l: any) => `${l.profissional ?? '-'} · ${l.unidade ?? ''}` },
                { titulo: 'Exames', valor: (l: any) => l.exames.map((e: any) => e.exame.split(' - ')[0]).join(', ') },
                { titulo: '', valor: (l: any) => <Button size="compact-xs" onClick={() => void receber(l.id)}>Receber</Button> },
              ]}
            />
          </ScrollArea>
        </Tabs.Panel>
        <Tabs.Panel value="externa" pt="sm">
          <Stack gap="xs">
            {paciente ? (
              <Group align="flex-start" wrap="nowrap">
                <div style={{ flex: 1 }}>
                  <CabecalhoPaciente paciente={paciente} compacto />
                </div>
                <Button size="xs" variant="subtle" onClick={() => setF({ ...f, pacienteId: null })}>
                  Trocar
                </Button>
              </Group>
            ) : (
              <BuscaPaciente aoSelecionar={(id) => setF({ ...f, pacienteId: id })} />
            )}
            <Grid gutter="xs">
              <Grid.Col span={6}>
                <SelecaoRef entidade="unidade" rotulo="Unidade solicitante" valor={f.unidadeSolicitanteId} aoMudar={(v) => setF({ ...f, unidadeSolicitanteId: v })} />
              </Grid.Col>
              <Grid.Col span={6}>
                <SelecaoRef entidade="profissional" rotulo="Profissional solicitante" valor={f.profissionalSolicitanteId} aoMudar={(v) => setF({ ...f, profissionalSolicitanteId: v })} />
              </Grid.Col>
              <Grid.Col span={6}>
                <TextInput size="xs" label="Solicitante externo (nome / conselho)" value={f.solicitanteExterno ?? ''} onChange={(e) => setF({ ...f, solicitanteExterno: e.currentTarget.value })} />
              </Grid.Col>
              <Grid.Col span={3}>
                <SelecaoRef entidade="convenio" rotulo="Convênio" valor={f.convenioId} aoMudar={(v) => setF({ ...f, convenioId: v })} />
              </Grid.Col>
              <Grid.Col span={3}>
                <Select size="xs" label="Origem" data={[{ value: 'EXTERNA', label: 'Externa / balcão' }, { value: 'REDE', label: 'Rede municipal' }, { value: 'UPA', label: 'UPA' }, { value: 'APOIO', label: 'Outro laboratório' }]} value={f.origem} onChange={(v) => setF({ ...f, origem: v ?? 'EXTERNA' })} />
              </Grid.Col>
              <Grid.Col span={3}>
                <CampoData rotulo="Data da coleta" valor={f.dataAgendada} aoMudar={(v) => setF({ ...f, dataAgendada: v })} />
              </Grid.Col>
              <Grid.Col span={3}>
                <TextInput size="xs" label="Hora" placeholder="07:30" value={f.horaAgendada ?? ''} onChange={(e) => setF({ ...f, horaAgendada: e.currentTarget.value || null })} />
              </Grid.Col>
              <Grid.Col span={3} pt="lg">
                <Switch size="xs" label="Urgente" checked={!!f.urgente} onChange={(e) => setF({ ...f, urgente: e.currentTarget.checked })} />
              </Grid.Col>
              <Grid.Col span={3}>
                <SelecaoRef entidade="lab_laboratorio" rotulo="Laboratório" valor={f.laboratorioId} aoMudar={(v) => setF({ ...f, laboratorioId: v })} />
              </Grid.Col>
              <Grid.Col span={12}>
                <Textarea size="xs" label="Dados clínicos / medicamentos em uso" autosize value={f.dadosClinicos ?? ''} onChange={(e) => setF({ ...f, dadosClinicos: e.currentTarget.value })} />
              </Grid.Col>
            </Grid>
            <Divider label="Exames" labelPosition="left" />
            <SelecaoRef entidade="lab_exame" rotulo="Incluir exame" valor={null} filtro={{ ativo: true }} aoMudar={(v, rotulo) => v && !itens.some((i) => i.exameId === v) && setItens([...itens, { exameId: v, rotulo: rotulo ?? String(v), materialId: null }])} />
            {itens.map((i, k) => (
              <Group key={i.exameId} gap="xs" wrap="nowrap">
                <Text size="sm" style={{ flex: 1 }}>
                  {i.rotulo}
                </Text>
                <div style={{ width: 220 }}>
                  <SelecaoRef entidade="lab_material" rotulo="" valor={i.materialId} aoMudar={(v) => setItens(itens.map((x, j) => (j === k ? { ...x, materialId: v } : x)))} />
                </div>
                <ActionIcon variant="subtle" color="red" onClick={() => setItens(itens.filter((_, j) => j !== k))}>
                  ×
                </ActionIcon>
              </Group>
            ))}
            <Group justify="flex-end">
              <Button disabled={!f.pacienteId || !itens.length} leftSection={<IconDeviceFloppy size={16} />} onClick={() => void salvar()}>
                Cadastrar requisição
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Conferência e alteração da requisição em uma única tela (TR 1.2.47.43.24)
// ---------------------------------------------------------------------------
function ModalRequisicao({ id, aoFechar, aoColetar }: { id: number; aoFechar: () => void; aoColetar: (id: number) => void }) {
  const { dados: r, recarregar } = useCarregar(() => api.get(`${L}/requisicoes/${id}`), [id]);
  const { paciente, recarregar: recarregarPaciente } = usePaciente(r?.paciente_id ?? null, 'laboratorio');
  const [f, setF] = useState<Record<string, any>>({});
  const [editarPaciente, setEditarPaciente] = useState(false);
  const [oc, setOc] = useState<{ motivoId: number | null; itemId: string | null; descricao: string }>({ motivoId: null, itemId: null, descricao: '' });
  useEffect(() => {
    if (r)
      setF({
        unidadeSolicitanteId: r.unidade_solicitante_id,
        profissionalSolicitanteId: r.profissional_solicitante_id,
        solicitanteExterno: r.solicitante_externo,
        convenioId: r.convenio_id,
        urgente: r.urgente,
        dadosClinicos: r.dados_clinicos,
        observacao: r.observacao,
        dataAgendada: r.data_agendada,
        horaAgendada: r.hora_agendada,
        materiais: {},
      });
  }, [r]);
  if (!r) return null;
  const acao = async (fn: () => Promise<any>, msg: string) => {
    try {
      await fn();
      notificarOk(msg);
      void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const reagendar = async () => {
    const d = await pedirTexto('Reagendar coleta', 'Nova data (DD/MM/AAAA)');
    if (!d) return;
    const motivo = await pedirTexto('Reagendar coleta', 'Motivo do reagendamento');
    if (!motivo) return;
    await acao(() => api.post(`${L}/requisicoes/${id}/reagendar`, { data: dayjs(d, 'DD/MM/YYYY').isValid() ? d.split('/').reverse().join('-') : d, motivo }), 'Coleta reagendada.');
  };
  const liberados = r.itens.some((i: any) => i.situacao === 'LIBERADO');
  return (
    <Modal opened onClose={aoFechar} title={`Requisição ${r.numero}${r.numero_prontuario ? ` (prontuário ${r.numero_prontuario})` : ''}`} size="90%">
      <Stack gap="xs">
        {paciente && (
          <Group align="flex-start" wrap="nowrap">
            <div style={{ flex: 1 }}>
              <CabecalhoPaciente paciente={paciente} compacto aoAtualizar={recarregarPaciente} />
            </div>
            <Button size="xs" variant="light" onClick={() => setEditarPaciente(true)}>
              Alterar dados do paciente
            </Button>
          </Group>
        )}
        <Group gap="xs">
          <SituacaoReq valor={r.situacao} />
          <Badge variant="outline">{r.laboratorio}</Badge>
          <Text size="xs">Previsão de entrega: {fmtData(r.data_prevista_entrega)}</Text>
          {r.entregue_em && <Text size="xs">Entregue em {fmtDataHora(r.entregue_em)} a {r.entregue_a}</Text>}
        </Group>
        <Grid gutter="xs">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade solicitante" valor={f.unidadeSolicitanteId} aoMudar={(v) => setF({ ...f, unidadeSolicitanteId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="profissional" rotulo="Profissional solicitante" valor={f.profissionalSolicitanteId} aoMudar={(v) => setF({ ...f, profissionalSolicitanteId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <SelecaoRef entidade="convenio" rotulo="Convênio" valor={f.convenioId} aoMudar={(v) => setF({ ...f, convenioId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <CampoData rotulo="Data agendada" valor={f.dataAgendada} aoMudar={(v) => setF({ ...f, dataAgendada: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 1 }}>
            <TextInput size="xs" label="Hora" value={f.horaAgendada ?? ''} onChange={(e) => setF({ ...f, horaAgendada: e.currentTarget.value || null })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 1 }} pt="lg">
            <Switch size="xs" label="Urgente" checked={!!f.urgente} onChange={(e) => setF({ ...f, urgente: e.currentTarget.checked })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Textarea size="xs" label="Dados clínicos" autosize value={f.dadosClinicos ?? ''} onChange={(e) => setF({ ...f, dadosClinicos: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Textarea size="xs" label="Observação" autosize value={f.observacao ?? ''} onChange={(e) => setF({ ...f, observacao: e.currentTarget.value })} />
          </Grid.Col>
        </Grid>
        <Paper withBorder p="xs">
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={600}>
              Exames
            </Text>
            <div style={{ width: 320 }}>
              <SelecaoRef entidade="lab_exame" rotulo="" valor={null} filtro={{ ativo: true }} aoMudar={(v) => v && void acao(() => api.post(`${L}/requisicoes/${id}/exames`, { exameId: v }), 'Exame incluído.')} />
            </div>
          </Group>
          <Table fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Exame</Table.Th>
                <Table.Th>Seção</Table.Th>
                <Table.Th>Material a examinar</Table.Th>
                <Table.Th>Executor</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th>Interface</Table.Th>
                <Table.Th>Liberado</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {r.itens.map((i: any) => (
                <Table.Tr key={i.id}>
                  <Table.Td>
                    <b>{i.sigla}</b> {i.exame}
                    {i.preparo_paciente && (
                      <Text size="10px" c="dimmed">
                        Preparo: {i.preparo_paciente}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{i.secao}</Table.Td>
                  <Table.Td w={200}>
                    {i.situacao === 'AGUARDANDO_COLETA' ? (
                      <SelecaoRef entidade="lab_material" rotulo="" valor={f.materiais?.[i.id] ?? i.material_id} aoMudar={(v) => setF({ ...f, materiais: { ...f.materiais, [i.id]: v } })} />
                    ) : (
                      i.material
                    )}
                  </Table.Td>
                  <Table.Td>
                    {i.laboratorio}
                    {i.laboratorio_tipo === 'APOIO' && <Badge size="xs" ml={4} color="grape">apoio</Badge>}
                  </Table.Td>
                  <Table.Td>
                    <SituacaoItem valor={i.situacao} />
                  </Table.Td>
                  <Table.Td>{i.interface_situacao ?? '-'}</Table.Td>
                  <Table.Td>{fmtDataHora(i.liberado_em)}</Table.Td>
                  <Table.Td>
                    <Group gap={2} wrap="nowrap">
                      {i.situacao === 'LIBERADO' && (
                        <Button size="compact-xs" variant="subtle" onClick={() => abrirPdf(`${L}/itens/${i.id}/laudo`)}>
                          Ver laudo
                        </Button>
                      )}
                      {!['LIBERADO', 'CANCELADO'].includes(i.situacao) && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="red"
                          onClick={async () => {
                            const motivo = await pedirTexto('Cancelar exame', 'Motivo');
                            if (motivo) await acao(() => api.post(`${L}/itens/${i.id}/cancelar`, { motivo }), 'Exame cancelado.');
                          }}
                        >
                          Cancelar
                        </Button>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
        <Grid gutter="xs">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Paper withBorder p="xs">
              <Text size="sm" fw={600} mb={4}>
                Amostras
              </Text>
              <TabelaSimples
                linhas={r.amostras}
                vazio="Nenhuma amostra coletada."
                colunas={[
                  { titulo: 'Código', valor: (a: any) => <b>{a.codigo_barras}</b> },
                  { titulo: 'Recipiente', valor: (a: any) => (<Group gap={4}>{a.cor && <ColorSwatch color={a.cor} size={12} />}{a.recipiente}</Group>) },
                  { titulo: 'Exames', valor: (a: any) => a.exames },
                  { titulo: 'Coleta', valor: (a: any) => `${fmtDataHora(a.coletada_em)} · ${a.profissional ?? ''}` },
                  { titulo: 'Situação', valor: (a: any) => (a.situacao === 'DESCARTADA' ? <Tooltip label={a.motivo_descarte}><Badge size="xs" color="red">Descartada</Badge></Tooltip> : <Badge size="xs">{a.situacao}</Badge>) },
                  {
                    titulo: '',
                    valor: (a: any) =>
                      a.situacao === 'COLETADA' ? (
                        <Group gap={2} wrap="nowrap">
                          <Button size="compact-xs" variant="subtle" onClick={() => abrirPdf(`${L}/requisicoes/${id}/etiquetas?amostras=${a.id}`)}>
                            Etiqueta
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            color="red"
                            onClick={async () => {
                              const motivo = await pedirTexto('Descartar amostra', 'Motivo do descarte (o exame volta para a fila de coleta)');
                              if (motivo) await acao(() => api.post(`${L}/amostras/${a.id}/descartar`, { motivo }), 'Amostra descartada; exame disponível para nova coleta.');
                            }}
                          >
                            Descartar
                          </Button>
                        </Group>
                      ) : null,
                  },
                ]}
              />
            </Paper>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Paper withBorder p="xs">
              <Text size="sm" fw={600} mb={4}>
                Ocorrências
              </Text>
              <Group gap="xs" align="flex-end" mb="xs">
                <div style={{ flex: 1 }}>
                  <SelecaoRef entidade="lab_motivo_ocorrencia" rotulo="Motivo" valor={oc.motivoId} aoMudar={(v) => setOc({ ...oc, motivoId: v })} />
                </div>
                <Select size="xs" w={110} label="Exame" clearable data={r.itens.map((i: any) => ({ value: String(i.id), label: i.sigla }))} value={oc.itemId} onChange={(v) => setOc({ ...oc, itemId: v })} />
              </Group>
              <Group gap="xs" align="flex-end">
                <TextInput size="xs" style={{ flex: 1 }} placeholder="Descrição" value={oc.descricao} onChange={(e) => setOc({ ...oc, descricao: e.currentTarget.value })} />
                <Button
                  size="xs"
                  disabled={!oc.motivoId}
                  onClick={() =>
                    void acao(async () => {
                      const x = await api.post(`${L}/ocorrencias`, { requisicaoId: id, itemId: oc.itemId ? Number(oc.itemId) : null, motivoId: oc.motivoId, descricao: oc.descricao });
                      setOc({ motivoId: null, itemId: null, descricao: '' });
                      return x;
                    }, 'Ocorrência registrada e informada ao solicitante.')
                  }
                >
                  Registrar
                </Button>
              </Group>
              <TabelaSimples
                linhas={r.ocorrencias}
                vazio="Sem ocorrências."
                colunas={[
                  { titulo: 'Data', valor: (o: any) => fmtDataHora(o.data_hora) },
                  { titulo: 'Motivo', valor: (o: any) => `${o.motivo}${o.exame ? ` (${o.exame})` : ''}` },
                  { titulo: 'Descrição', valor: (o: any) => o.descricao },
                  { titulo: 'Avisado', valor: (o: any) => (o.notificado ? 'Sim' : 'Não') },
                ]}
              />
            </Paper>
          </Grid.Col>
        </Grid>
        <Group justify="space-between">
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={() => void acao(() => api.post(`${L}/requisicoes/${id}/presenca`, { presente: true }), 'Presença confirmada.')}>
              Presente
            </Button>
            <Button size="xs" variant="light" color="red" onClick={() => void acao(() => api.post(`${L}/requisicoes/${id}/presenca`, { presente: false }), 'Falta registrada.')}>
              Faltou
            </Button>
            <Button size="xs" variant="light" onClick={() => void reagendar()}>
              Reagendar coleta
            </Button>
            {['RECEBIDA', 'COLETA_PARCIAL'].includes(r.situacao) && (
              <Button size="xs" leftSection={<IconFlask size={14} />} onClick={() => aoColetar(id)}>
                Registrar coleta
              </Button>
            )}
            <Button size="xs" variant="default" onClick={() => abrirPdf(`${L}/requisicoes/${id}/comprovante`)}>
              Comprovante
            </Button>
            <Button size="xs" variant="default" onClick={() => abrirPdf(`${L}/requisicoes/${id}/etiquetas`)}>
              Etiquetas
            </Button>
          </Group>
          <Group gap="xs">
            {liberados && (
              <>
                <Button size="xs" variant="light" leftSection={<IconFileTypePdf size={14} />} onClick={() => abrirPdf(`${L}/requisicoes/${id}/laudo`).then(() => recarregar())}>
                  Laudo
                </Button>
                <Button
                  size="xs"
                  variant="light"
                  color="teal"
                  onClick={async () => {
                    const quem = await pedirTexto('Entrega do resultado', 'Retirado por (nome e documento)');
                    if (quem) await acao(() => api.post(`${L}/requisicoes/${id}/entrega`, { retiradoPor: quem }), 'Entrega registrada.');
                  }}
                >
                  Registrar entrega
                </Button>
                <Button size="xs" variant="subtle" color="red" onClick={() => void acao(() => api.post(`${L}/requisicoes/${id}/entrega`, { naoRetirado: true }), 'Registrado como não retirado.')}>
                  Não retirado
                </Button>
              </>
            )}
            <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={() => void acao(() => api.put(`${L}/requisicoes/${id}`, f), 'Requisição atualizada.')}>
              Salvar conferência
            </Button>
          </Group>
        </Group>
      </Stack>
      {editarPaciente && (
        <Modal opened onClose={() => setEditarPaciente(false)} title="Dados do paciente" size="90%">
          <Formulario entidade="paciente" id={r.paciente_id} emModal aoSalvar={() => (setEditarPaciente(false), void recarregarPaciente())} aoCancelar={() => setEditarPaciente(false)} />
        </Modal>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Coleta (TR 1.2.47.10, 1.2.47.15, 1.2.47.43.13, 1.2.47.43.16 a 1.2.47.43.29)
// ---------------------------------------------------------------------------
function ModalColeta({ id, aoFechar }: { id: number; aoFechar: () => void }) {
  const { eu } = useAuth();
  const [selecionados, setSelecionados] = useState<number[] | null>(null);
  const [plano, setPlano] = useState<any>(null);
  const [materiais, setMateriais] = useState<Record<number, number>>({});
  const [profissionalId, setProfissionalId] = useState<number | null>(eu?.profissionalId ?? null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    api
      .get(`${L}/requisicoes/${id}/coleta`, selecionados ? { itens: selecionados.join(',') || '0' } : undefined)
      .then((p) => {
        setPlano(p);
        if (selecionados === null) setSelecionados(p.itens.map((i: any) => i.id));
        setMateriais(Object.fromEntries(p.insumos.map((m: any) => [m.produtoId, m.quantidade])));
      })
      .catch(notificarErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, JSON.stringify(selecionados)]);
  const [todos, setTodos] = useState<any[]>([]);
  useEffect(() => {
    if (plano && !todos.length) setTodos(plano.itens);
  }, [plano, todos.length]);
  async function registrar() {
    setSalvando(true);
    try {
      const r = await api.post(`${L}/requisicoes/${id}/coleta`, {
        itens: selecionados,
        profissionalId,
        materiais: Object.entries(materiais)
          .filter(([, q]) => Number(q) > 0)
          .map(([produtoId, quantidade]) => ({ produtoId: Number(produtoId), quantidade: Number(quantidade) })),
      });
      notificarOk(`Coleta registrada: ${r.amostras.length} amostra(s)${r.pedidosEquipamentos ? `, ${r.pedidosEquipamentos} pedido(s) enviados aos equipamentos` : ''}.`);
      // Etiquetas após a coleta conforme parâmetro: automático, perguntar ou não imprimir (TR 1.2.47.15, 1.2.47.43.26, 1.2.47.43.28).
      const ids = r.amostras.map((a: any) => a.id).join(',');
      if (r.etiquetas === 'AUTOMATICO' || (r.etiquetas === 'PERGUNTAR' && (await confirmar('Etiquetas', `Deseja gerar as ${r.amostras.length} etiqueta(s) de identificação dos materiais coletados?`, 'Imprimir etiquetas'))))
        await abrirPdf(`${L}/requisicoes/${id}/etiquetas?amostras=${ids}`);
      if (r.mapas) await abrirPdf(`${L}/mapa?requisicoes=${id}`);
      aoFechar();
    } catch (e) {
      notificarErro(e);
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Modal opened onClose={aoFechar} title="Registro de coleta" size="xl">
      {!plano ? (
        <Text c="dimmed">Carregando...</Text>
      ) : (
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Exames a coletar (desmarque para coleta parcial; os pendentes retornam à fila)
          </Text>
          {todos.map((i: any) => (
            <Checkbox
              key={i.id}
              size="xs"
              checked={!!selecionados?.includes(i.id)}
              onChange={(e) => setSelecionados(e.currentTarget.checked ? [...(selecionados ?? []), i.id] : (selecionados ?? []).filter((x) => x !== i.id))}
              label={
                <Text size="xs">
                  <b>{i.sigla}</b> {i.nome} · {i.material ?? 'material não informado'}
                  {i.amostras > 1 ? ` · ${i.amostras} amostras` : ''}
                  {i.preparo ? ` · Preparo: ${i.preparo}` : ''}
                </Text>
              }
            />
          ))}
          <Divider label="Recipientes necessários" labelPosition="left" />
          <TabelaSimples
            linhas={plano.tubos}
            vazio="Selecione ao menos um exame."
            colunas={[
              { titulo: '', valor: (t: any) => (t.cor ? <ColorSwatch color={t.cor} size={16} /> : null) },
              { titulo: 'Recipiente', valor: (t: any) => `${t.recipiente}${t.corNome ? ` (${t.corNome})` : ''}` },
              { titulo: 'Material', valor: (t: any) => t.material },
              { titulo: 'Amostra', valor: (t: any) => t.sequencia },
              { titulo: 'Qtd.', valor: (t: any) => t.quantidade },
              { titulo: 'Volume (mL)', valor: (t: any) => t.volume || '-' },
              { titulo: 'Exames', valor: (t: any) => t.siglas.join(', ') },
            ]}
          />
          <Divider label={`Materiais usados (baixa automática do estoque)${plano.exigirMateriais ? ' - obrigatório' : ''}`} labelPosition="left" />
          {plano.insumos.map((m: any) => (
            <Group key={m.produtoId} gap="xs">
              <Text size="xs" style={{ flex: 1 }}>
                {m.nome}
              </Text>
              <NumberInput size="xs" w={100} min={0} value={materiais[m.produtoId] ?? 0} onChange={(v) => setMateriais({ ...materiais, [m.produtoId]: Number(v) || 0 })} />
            </Group>
          ))}
          <SelecaoRef entidade="produto" rotulo="Incluir outro material" valor={null} filtro={{ tipo: 'LABORATORIO' }} aoMudar={(v, rotulo) => v && (setMateriais({ ...materiais, [v]: 1 }), setPlano({ ...plano, insumos: [...plano.insumos, { produtoId: v, nome: rotulo, quantidade: 1 }] }))} />
          <SelecaoRef entidade="profissional" rotulo="Profissional responsável pela coleta" valor={profissionalId} aoMudar={setProfissionalId} />
          <Group justify="flex-end">
            <Button loading={salvando} disabled={!selecionados?.length} leftSection={<IconCheck size={16} />} onClick={() => void registrar()}>
              Registrar coleta
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Digitação de resultados (TR 1.2.47.43.43 a 1.2.47.43.60.1)
// ---------------------------------------------------------------------------
function PainelPaciente({ pacienteId, exameId }: { pacienteId: number; exameId: number }) {
  const { dados: ctx } = useCarregar(() => api.get(`${L}/pacientes/${pacienteId}/contexto`), [pacienteId]);
  const { dados: res } = useCarregar(() => api.get<any[]>(`${L}/pacientes/${pacienteId}/resultados`), [pacienteId]);
  return (
    <Tabs defaultValue="anteriores" variant="outline">
      <Tabs.List>
        <Tabs.Tab value="anteriores">Exames anteriores</Tabs.Tab>
        <Tabs.Tab value="medicamentos">Medicamentos em uso</Tabs.Tab>
        <Tabs.Tab value="continuo">Uso contínuo</Tabs.Tab>
        <Tabs.Tab value="alergias">Alergias ({ctx?.alergias?.length ?? 0})</Tabs.Tab>
        <Tabs.Tab value="vacinas">Imunização</Tabs.Tab>
      </Tabs.List>
      <ScrollArea h={220} p="xs">
        <Tabs.Panel value="anteriores">
          <TabelaSimples
            linhas={(res ?? []).sort((a, b) => Number(b.exame_id === exameId) - Number(a.exame_id === exameId))}
            vazio="Sem resultados anteriores."
            colunas={[
              { titulo: 'Liberado', valor: (r: any) => fmtData(r.liberado_em) },
              { titulo: 'Exame', valor: (r: any) => <b>{r.sigla}</b> },
              { titulo: 'Resultado', valor: (r: any) => <Text size="10px" style={{ whiteSpace: 'pre-line' }}>{r.resumo}</Text> },
              { titulo: '', valor: (r: any) => <Button size="compact-xs" variant="subtle" onClick={() => abrirPdf(`${L}/itens/${r.id}/laudo`)}>Laudo</Button> },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="medicamentos">
          <TabelaSimples linhas={ctx?.medicamentosEmUso ?? []} colunas={[{ titulo: 'Dispensado', valor: (m: any) => fmtData(m.data_hora) }, { titulo: 'Medicamento', valor: (m: any) => m.produto }, { titulo: 'Término previsto', valor: (m: any) => fmtData(m.termino_previsto) }]} />
        </Tabs.Panel>
        <Tabs.Panel value="continuo">
          <TabelaSimples linhas={ctx?.usoContinuo ?? []} colunas={[{ titulo: 'Receita', valor: (m: any) => fmtData(m.data) }, { titulo: 'Medicamento', valor: (m: any) => m.descricao }, { titulo: 'Posologia', valor: (m: any) => m.posologia }]} />
        </Tabs.Panel>
        <Tabs.Panel value="alergias">
          <TabelaSimples linhas={ctx?.alergias ?? []} vazio="Nenhuma restrição alérgica registrada." colunas={[{ titulo: 'Substância', valor: (a: any) => a.substancia }, { titulo: 'Tipo', valor: (a: any) => a.tipo }, { titulo: 'Gravidade', valor: (a: any) => a.gravidade }]} />
        </Tabs.Panel>
        <Tabs.Panel value="vacinas">
          <TabelaSimples linhas={ctx?.vacinas ?? []} colunas={[{ titulo: 'Data', valor: (v: any) => fmtData(v.data) }, { titulo: 'Imunobiológico', valor: (v: any) => v.imunobiologico }, { titulo: 'Dose', valor: (v: any) => v.dose }]} />
        </Tabs.Panel>
      </ScrollArea>
    </Tabs>
  );
}

function EditorItem({ itemId, aoSalvar, anterior, proximo }: { itemId: number; aoSalvar: (avancar: boolean) => void; anterior?: () => void; proximo?: () => void }) {
  const { dados: it, recarregar } = useCarregar(() => api.get(`${L}/itens/${itemId}`), [itemId]);
  const [valores, setValores] = useState<Record<string, any>>({});
  const [rotulos, setRotulos] = useState<Record<string, string>>({});
  const [obs, setObs] = useState('');
  useEffect(() => {
    if (!it) return;
    const iniciais: Record<string, any> = { ...(it.valores ?? {}) };
    for (const v of it.layout as Variavel[]) if (iniciais[v.codigo] === undefined && v.valor_padrao) iniciais[v.codigo] = v.valor_padrao;
    for (const [k, v] of Object.entries(iniciais)) if (typeof v === 'number') iniciais[k] = v.toLocaleString('pt-BR', { maximumFractionDigits: 6, useGrouping: false });
    setValores(iniciais);
    setRotulos(it.rotulos ?? {});
    setObs(it.observacao_resultado ?? '');
  }, [it]);
  const aval = useAvaliacao(it && !it.bloqueado ? `${L}/itens/${itemId}/avaliar` : null, valores);
  const { paciente } = usePaciente(it?.paciente_id ?? null, 'laboratorio');
  if (!it) return <Text c="dimmed">Carregando...</Text>;
  async function salvar(parcial: boolean, avancar: boolean) {
    try {
      const r = await api.put(`${L}/itens/${itemId}/resultado`, { valores, rotulos, observacao: obs || null, parcial });
      notificarOk(r.situacao === 'DIGITADO' ? 'Resultado gravado.' : `Gravado como parcial${r.pendentes.length ? ` (pendente: ${r.pendentes.join(', ')})` : ''}.`);
      aoSalvar(avancar);
      if (!avancar) void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function anexar(arquivo: File | null) {
    if (!arquivo) return;
    try {
      const a = await api.enviarArquivo(arquivo);
      await api.post(`${L}/itens/${itemId}/anexo`, { arquivoId: a.id });
      notificarOk('Resultado em PDF anexado: exame liberado e disponível no prontuário.');
      aoSalvar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack gap="xs">
      {paciente && <CabecalhoPaciente paciente={paciente} compacto />}
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={5}>
            {it.sigla} - {it.exame}
          </Title>
          <SituacaoItem valor={it.situacao} />
          {it.urgente && <Badge color="red">Urgente</Badge>}
        </Group>
        <Text size="xs" c="dimmed">
          Requisição {it.numero} · {it.secao} · {it.material ?? '-'} · amostra(s) {it.amostras.map((a: any) => a.codigo_barras).join(', ')}
        </Text>
      </Group>
      {it.bloqueado && (
        <Alert color="green" icon={<IconLock size={16} />} py={6}>
          Resultado liberado e assinado por {it.liberador ?? 'laboratório de apoio'} em {fmtDataHora(it.liberado_em)}: alteração bloqueada.
        </Alert>
      )}
      {it.anterior && (
        <Text size="xs" c="dimmed">
          Resultado anterior em {fmtData(it.anterior.data)} disponível para Delta-Check.
        </Text>
      )}
      <ListaAlertas avaliacao={aval} />
      <FormResultado
        layout={it.layout}
        valores={valores}
        rotulos={rotulos}
        avaliacao={aval}
        bloqueado={it.bloqueado}
        predefinidos={it.predefinidos}
        aoMudar={(c, v) => setValores((x) => ({ ...x, [c]: v }))}
        aoMudarRotulo={(c, v) => setRotulos((x) => ({ ...x, [c]: v }))}
        aoConcluir={() => void salvar(false, true)}
      />
      <Textarea size="xs" label="Observação do resultado" autosize disabled={it.bloqueado} value={obs} onChange={(e) => setObs(e.currentTarget.value)} />
      <Group justify="space-between">
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<IconArrowLeft size={14} />} disabled={!anterior} onClick={anterior}>
            Anterior
          </Button>
          <Button size="xs" variant="default" rightSection={<IconArrowRight size={14} />} disabled={!proximo} onClick={proximo}>
            Próximo
          </Button>
          {!it.bloqueado && (
            <Button size="xs" variant="subtle" color="gray" leftSection={<IconEraser size={14} />} onClick={() => (setValores({}), setObs(''))}>
              Limpar
            </Button>
          )}
        </Group>
        {!it.bloqueado ? (
          <Group gap="xs">
            <Button size="xs" variant="subtle" component="label" leftSection={<IconUpload size={14} />}>
              Anexar resultado (PDF)
              <input type="file" accept="application/pdf" hidden onChange={(e) => void anexar(e.currentTarget.files?.[0] ?? null)} />
            </Button>
            <Button size="xs" variant="light" onClick={() => void salvar(true, false)}>
              Salvar parcial
            </Button>
            <Button size="xs" variant="light" onClick={() => void salvar(false, false)}>
              Salvar
            </Button>
            <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={() => void salvar(false, true)}>
              Confirmar e próximo
            </Button>
          </Group>
        ) : (
          <Button size="xs" variant="light" onClick={() => abrirPdf(`${L}/itens/${itemId}/laudo`)}>
            Visualizar laudo
          </Button>
        )}
      </Group>
      <Paper withBorder>
        <PainelPaciente pacienteId={it.paciente_id} exameId={it.exame_id} />
      </Paper>
    </Stack>
  );
}

function TelaDigitacao({ query }: { query: URLSearchParams }) {
  useTituloJanela('Digitação de resultados');
  const [f, setF] = useState<Record<string, any>>({ modo: 'SECAO', situacao: 'COLETADO,EM_ANALISE,DIGITADO_PARCIAL', requisicaoId: query.get('requisicao') ?? undefined });
  const [fila, setFila] = useState<any[]>([]);
  const [atual, setAtual] = useState<number | null>(null);
  const carregar = (manter?: number | null) =>
    api
      .get<any[]>(`${L}/digitacao`, f)
      .then((l) => {
        setFila(l);
        if (manter !== undefined) setAtual(manter);
        else if (!l.some((x) => x.id === atual)) setAtual(l[0]?.id ?? null);
      })
      .catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [f]);
  const idx = fila.findIndex((x) => x.id === atual);
  // Ao confirmar, traz automaticamente o próximo da lista: do setor ou do mesmo paciente (TR 1.2.47.43.48, 1.2.47.43.49).
  const aoSalvar = (avancar: boolean) => {
    const prox = avancar ? (fila[idx + 1]?.id ?? null) : atual;
    void carregar(prox);
  };
  return (
    <Grid p="md" gutter="sm">
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Stack gap="xs">
          <Title order={5}>Fila de digitação</Title>
          <SegmentedControl size="xs" fullWidth value={f.modo} onChange={(v) => setF({ ...f, modo: v })} data={[{ value: 'SECAO', label: 'Por setor' }, { value: 'PACIENTE', label: 'Por paciente' }]} />
          <SelecaoRef entidade="lab_secao" rotulo="Seção" valor={f.secaoId} aoMudar={(v) => setF({ ...f, secaoId: v })} />
          <Select
            size="xs"
            label="Situação"
            value={f.situacao}
            onChange={(v) => setF({ ...f, situacao: v ?? undefined })}
            data={[
              { value: 'COLETADO,EM_ANALISE,DIGITADO_PARCIAL', label: 'Pendentes de digitação' },
              { value: 'DIGITADO_PARCIAL', label: 'Digitados parcialmente (finalizar)' },
              { value: 'DIGITADO', label: 'Digitados (revisão antes da liberação)' },
              { value: 'LIBERADO', label: 'Liberados (consulta)' },
            ]}
          />
          <TextInput size="xs" label="Paciente ou nº requisição" defaultValue={f.busca} onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, busca: e.currentTarget.value, requisicaoId: undefined })} />
          <Badge variant="light">{fila.length} exame(s)</Badge>
          <ScrollArea h="calc(100vh - 430px)">
            <Stack gap={2}>
              {fila.map((x) => (
                <Paper key={x.id} withBorder p={6} style={{ cursor: 'pointer', borderColor: x.id === atual ? 'var(--mantine-color-blue-6)' : undefined, background: x.id === atual ? 'var(--mantine-color-blue-0)' : undefined }} onClick={() => setAtual(x.id)}>
                  <Group justify="space-between" gap={4} wrap="nowrap">
                    <Text size="xs" fw={600} lineClamp={1}>
                      {x.sigla} · {x.paciente}
                    </Text>
                    <SituacaoItem valor={x.situacao} />
                  </Group>
                  <Text size="10px" c="dimmed">
                    {x.numero} · {x.secao} {x.urgente ? '· URGENTE' : ''} {x.interface_situacao ? `· interface ${x.interface_situacao.toLowerCase()}` : ''}
                  </Text>
                </Paper>
              ))}
            </Stack>
          </ScrollArea>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 9 }}>
        {atual ? (
          <EditorItem
            key={atual}
            itemId={atual}
            aoSalvar={aoSalvar}
            anterior={idx > 0 ? () => setAtual(fila[idx - 1].id) : undefined}
            proximo={idx >= 0 && idx < fila.length - 1 ? () => setAtual(fila[idx + 1].id) : undefined}
          />
        ) : (
          <Text c="dimmed" p="md">
            Nenhum exame na fila para os filtros selecionados.
          </Text>
        )}
      </Grid.Col>
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Liberação / assinatura (TR 1.2.47.38, 1.2.47.43.57, 1.2.47.43.58, 1.2.47.43.63, 1.2.47.43.64, 1.2.47.43.70)
// ---------------------------------------------------------------------------
function TelaLiberacao() {
  useTituloJanela('Liberação de laudos');
  const { pode } = useAuth();
  const [f, setF] = useState<Record<string, any>>({ situacao: 'DIGITADO' });
  const [dados, setDados] = useState<{ linhas: any[]; profissional: any } | null>(null);
  const [sel, setSel] = useState<number[]>([]);
  const carregar = () =>
    api
      .get(`${L}/liberacao`, f)
      .then((d) => (setDados(d), setSel([])))
      .catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [f]);
  async function liberar(ids: number[]) {
    const senha = await pedirSenha(`Liberar ${ids.length} exame(s): confirme com sua senha`);
    if (!senha) return;
    try {
      const r = await api.post(`${L}/liberar`, { itens: ids, senha });
      notificarOk(`${r.liberados} exame(s) liberado(s) e publicados no prontuário.${r.erros.length ? ` Pendências: ${r.erros.join(' ')}` : ''}`);
      for (const l of r.laudos) if (ids.length === 1) await abrirPdf(`/api/arquivos/${l.arquivoId}`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function cancelar(id: number) {
    const motivo = await pedirTexto('Cancelar liberação', 'Motivo do cancelamento da liberação');
    if (!motivo) return;
    const senha = await pedirSenha('Confirme com sua senha');
    if (!senha) return;
    await api
      .post(`${L}/itens/${id}/cancelar-liberacao`, { motivo, senha })
      .then(() => (notificarOk('Liberação cancelada: o resultado voltou para digitação.'), carregar()))
      .catch(notificarErro);
  }
  const linhas = dados?.linhas ?? [];
  const liberados = f.situacao === 'LIBERADO';
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Liberação (assinatura) de laudos</Title>
        {dados?.profissional ? (
          <Badge color={dados.profissional.liberador_laudo ? 'teal' : 'red'} leftSection={<IconSignature size={12} />}>
            {dados.profissional.nome} {dados.profissional.liberador_laudo ? '· autorizado a assinar' : '· sem autorização para assinar'}
          </Badge>
        ) : (
          <Badge color="red">Operador sem profissional vinculado</Badge>
        )}
      </Group>
      <Group gap="xs" align="flex-end">
        <SegmentedControl size="xs" value={f.situacao} onChange={(v) => setF({ ...f, situacao: v })} data={[{ value: 'DIGITADO', label: 'Aguardando liberação' }, { value: 'LIBERADO', label: 'Liberados' }]} />
        <div style={{ width: 200 }}>
          <SelecaoRef entidade="lab_secao" rotulo="Seção" valor={f.secaoId} aoMudar={(v) => setF({ ...f, secaoId: v })} />
        </div>
        <TextInput size="xs" label="Paciente ou nº requisição" onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, busca: e.currentTarget.value })} />
        {liberados && (
          <>
            <CampoData rotulo="De" valor={f.de} aoMudar={(v) => setF({ ...f, de: v })} clearable />
            <CampoData rotulo="Até" valor={f.ate} aoMudar={(v) => setF({ ...f, ate: v })} clearable />
          </>
        )}
        {!liberados && (
          <Button size="xs" leftSection={<IconSignature size={14} />} disabled={!sel.length} onClick={() => void liberar(sel)}>
            Liberar selecionados ({sel.length})
          </Button>
        )}
      </Group>
      <Paper withBorder>
        <ScrollArea h="calc(100vh - 260px)">
          <Table fz="xs" striped stickyHeader>
            <Table.Thead>
              <Table.Tr>
                {!liberados && (
                  <Table.Th w={28}>
                    <Checkbox size="xs" checked={!!linhas.length && sel.length === linhas.length} onChange={(e) => setSel(e.currentTarget.checked ? linhas.map((l) => l.id) : [])} />
                  </Table.Th>
                )}
                <Table.Th>Requisição</Table.Th>
                <Table.Th>Paciente</Table.Th>
                <Table.Th>Exame</Table.Th>
                <Table.Th>Resultado</Table.Th>
                <Table.Th>Alertas</Table.Th>
                <Table.Th>{liberados ? 'Liberado' : 'Digitado'}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {linhas.map((l) => (
                <Table.Tr key={l.id}>
                  {!liberados && (
                    <Table.Td>
                      <Checkbox size="xs" checked={sel.includes(l.id)} onChange={(e) => setSel(e.currentTarget.checked ? [...sel, l.id] : sel.filter((x) => x !== l.id))} />
                    </Table.Td>
                  )}
                  <Table.Td>
                    {l.numero} {l.urgente && <Badge size="xs" color="red">urgente</Badge>}
                  </Table.Td>
                  <Table.Td>{l.paciente}</Table.Td>
                  <Table.Td>
                    <b>{l.sigla}</b>
                    <Text size="10px" c="dimmed">
                      {l.secao}
                    </Text>
                  </Table.Td>
                  <Table.Td maw={380}>
                    <Text size="10px" style={{ whiteSpace: 'pre-line' }} lineClamp={6}>
                      {l.resumo}
                    </Text>
                  </Table.Td>
                  <Table.Td maw={260}>
                    {(l.alertas ?? []).map((a: any, i: number) => (
                      <Text key={i} size="10px" c={a.tipo === 'CRITICO' ? 'red' : a.tipo === 'DELTA' ? 'grape' : 'orange'}>
                        • {a.mensagem}
                      </Text>
                    ))}
                  </Table.Td>
                  <Table.Td>
                    {fmtDataHora(liberados ? l.liberado_em : l.digitado_em)}
                    <Text size="10px" c="dimmed">
                      {liberados ? l.liberador : l.digitador}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {liberados ? (
                      <Group gap={2} wrap="nowrap">
                        <Button size="compact-xs" variant="subtle" onClick={() => abrirPdf(`${L}/itens/${l.id}/laudo`)}>
                          Laudo
                        </Button>
                        {pode('lab_liberacao:cancelar', 'LAB') && (
                          <Button size="compact-xs" variant="subtle" color="red" onClick={() => void cancelar(l.id)}>
                            Cancelar liberação
                          </Button>
                        )}
                      </Group>
                    ) : (
                      <Button size="compact-xs" leftSection={<IconSignature size={12} />} onClick={() => void liberar([l.id])}>
                        Liberar
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {!linhas.length && (
            <Text size="sm" c="dimmed" p="md">
              Nenhum exame.
            </Text>
          )}
        </ScrollArea>
      </Paper>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Mapas de trabalho (TR 1.2.47.30 a 1.2.47.32.5, 1.2.47.43.30, 1.2.47.43.31)
// ---------------------------------------------------------------------------
function TelaMapas() {
  useTituloJanela('Mapas de trabalho');
  const [f, setF] = useState<Record<string, any>>({});
  const [modelo, setModelo] = useState<number | null>(null);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== '') as [string, string][]).toString();
  const abrirHtml = async () => {
    try {
      const html = await api.get<string>(`${L}/mapa-personalizado/${modelo}?formato=html&${qs}`);
      const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank');
      setTimeout(() => w?.print(), 800);
    } catch (e) {
      notificarErro(e);
    }
  };
  return (
    <Stack p="md" gap="sm" maw={900}>
      <Title order={4}>Mapas de trabalho</Title>
      <Paper withBorder p="sm">
        <Grid gutter="xs">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <SelecaoRef entidade="lab_secao" rotulo="Seção" valor={f.secaoId} aoMudar={(v) => setF({ ...f, secaoId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <SelecaoRef entidade="lab_exame" rotulo="Exame" valor={f.exameId} aoMudar={(v) => setF({ ...f, exameId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <SelecaoRef entidade="lab_laboratorio" rotulo="Laboratório" valor={f.laboratorioId} aoMudar={(v) => setF({ ...f, laboratorioId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <CampoData rotulo="Coleta de" valor={f.de} aoMudar={(v) => setF({ ...f, de: v })} clearable />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <CampoData rotulo="Coleta até" valor={f.ate} aoMudar={(v) => setF({ ...f, ate: v })} clearable />
          </Grid.Col>
        </Grid>
      </Paper>
      <Card withBorder>
        <Text fw={600}>Mapa sintético</Text>
        <Text size="xs" c="dimmed" mb="xs">
          Pacientes e exames em sequência, em duas colunas, com espaço para os resultados de cada variável (economia de papel).
        </Text>
        <Button leftSection={<IconPrinter size={16} />} onClick={() => abrirPdf(`${L}/mapa?${qs}`)}>
          Imprimir mapa sintético
        </Button>
      </Card>
      <Card withBorder>
        <Text fw={600}>Mapa personalizado</Text>
        <Text size="xs" c="dimmed" mb="xs">
          Modelos configurados em Laboratório › Configurações › Mapas de trabalho (editor de texto ou HTML), impressos individualmente ou em lote.
        </Text>
        <Group align="flex-end">
          <div style={{ width: 360 }}>
            <SelecaoRef entidade="lab_mapa_trabalho" rotulo="Modelo" valor={modelo} filtro={{ ativo: true }} aoMudar={setModelo} />
          </div>
          <Button disabled={!modelo} onClick={() => abrirPdf(`${L}/mapa-personalizado/${modelo}?${qs}`)}>
            PDF
          </Button>
          <Button disabled={!modelo} variant="light" onClick={() => void abrirHtml()}>
            Imprimir (HTML)
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
function TelaPainel() {
  useTituloJanela('Painel do laboratório');
  const { abrir } = useJanelas();
  const { dados, recarregar } = useCarregar(() => api.get(`${L}/painel`), []);
  const cartoes = useMemo(
    () =>
      dados
        ? [
            ['Recebidas hoje', dados.recebidas_hoje, 'blue'],
            ['Agendadas hoje', dados.agendadas_hoje, 'cyan'],
            ['Aguardando coleta', dados.aguardando_coleta, 'gray'],
            ['Faltas hoje', dados.faltas_hoje, 'red'],
            ['Aguardando entrega', dados.aguardando_entrega, 'teal'],
            ['Em atraso', dados.atrasadas, 'orange'],
          ]
        : [],
    [dados],
  );
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Painel do laboratório</Title>
        <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void recarregar()}>
          Atualizar
        </Button>
      </Group>
      <SimpleGrid cols={{ base: 2, md: 6 }}>
        {cartoes.map(([t, v, cor]) => (
          <Card key={t as string} withBorder>
            <Text size="xs" c="dimmed">
              {t}
            </Text>
            <Text size="xl" fw={700} c={cor as string}>
              {v as number}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
      <Paper withBorder p="sm">
        <Group justify="space-between" mb="xs">
          <Text fw={600}>Exames por seção</Text>
          <Text size="xs" c="dimmed">
            Tempo médio coleta → liberação (30 dias): {dados?.tempoMedioHoras ?? '-'} h
          </Text>
        </Group>
        <TabelaSimples
          linhas={dados?.porSecao ?? []}
          colunas={[
            { titulo: 'Seção', valor: (l: any) => l.secao },
            { titulo: 'A digitar', valor: (l: any) => <Button size="compact-xs" variant="subtle" onClick={() => abrir('/t/laboratorio/digitacao')}>{l.a_digitar}</Button> },
            { titulo: 'Parciais', valor: (l: any) => l.parciais },
            { titulo: 'A liberar', valor: (l: any) => <Button size="compact-xs" variant="subtle" onClick={() => abrir('/t/laboratorio/liberacao')}>{l.a_liberar}</Button> },
            { titulo: 'Liberados hoje', valor: (l: any) => l.liberados_hoje },
          ]}
        />
      </Paper>
    </Stack>
  );
}

registrarTela({ id: 'lab-painel', titulo: 'Painel do laboratório', menu: 'Laboratório', padrao: '/t/laboratorio/painel', permissao: 'lab_requisicao:consultar', modulo: 'LAB', palavras: ['laboratório', 'exames'], ordem: 0, render: () => <TelaPainel /> });
registrarTela({ id: 'lab-recepcao', titulo: 'Recepção e coleta', menu: 'Laboratório', padrao: '/t/laboratorio/recepcao', permissao: 'lab_requisicao:consultar', modulo: 'LAB', palavras: ['coleta', 'etiqueta', 'tubo', 'amostra', 'requisição', 'entrega de exame'], ordem: 1, render: () => <TelaRecepcao /> });
registrarTela({ id: 'lab-digitacao', titulo: 'Digitação de resultados', menu: 'Laboratório', padrao: '/t/laboratorio/digitacao', permissao: 'lab_resultado:executar', modulo: 'LAB', palavras: ['resultado', 'laudo', 'digitar'], ordem: 2, render: ({ query }) => <TelaDigitacao query={query} /> });
registrarTela({ id: 'lab-liberacao', titulo: 'Liberação de laudos', menu: 'Laboratório', padrao: '/t/laboratorio/liberacao', permissao: 'lab_liberacao:executar', modulo: 'LAB', palavras: ['assinar', 'assinatura', 'liberar resultado'], ordem: 3, render: () => <TelaLiberacao /> });
registrarTela({ id: 'lab-mapas', titulo: 'Mapas de trabalho', menu: 'Laboratório', padrao: '/t/laboratorio/mapas', permissao: 'lab_requisicao:consultar', modulo: 'LAB', palavras: ['mapa', 'bancada'], ordem: 4, render: () => <TelaMapas /> });
registrarMenuRelatorios('LAB', 'Laboratório', 'lab_requisicao:exportar');
