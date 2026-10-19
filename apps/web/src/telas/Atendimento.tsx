// Atendimento clínico / prontuário eletrônico (TR 1.2.16, 1.2.32, 1.2.42.2): SOAP com CID/CIAP e ditado,
// sinais vitais e gráficos de evolução, risco de Framingham, prescrição com controle de alergia e receitas
// por tipo, requisição de exames, encaminhamentos, documentos, observação, registros sigilosos e desfecho.
import { useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Grid,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Timeline,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconCheck, IconDeviceFloppy, IconFileText, IconHeartbeat, IconLock, IconPill, IconPlus, IconPrinter, IconRefresh, IconTestPipe, IconTrash, IconArrowForward } from '@tabler/icons-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { BotaoDitado } from '@/voz/Ditado';
import { CabecalhoPaciente } from '@/componentes/Paciente';
import { abrirPdf, comConfirmacao, COR_RISCO, fmtData, fmtDataHora, notificarErro, notificarOk, RISCOS, SelecaoRef, Situacao, TabelaSimples } from '@/componentes/comum';
import { confirmar, pedirTexto } from '@/genericos/dialogos';
import { CAMPOS_SINAIS, EntradaSinais } from './Fila';
import { registrarTela } from './registro';

const DESFECHOS: [string, string][] = [
  ['ALTA', 'Alta do episódio'],
  ['OBSERVACAO', 'Manter em observação'],
  ['OBSERVACAO_LONGA', 'Manter em observação longa'],
  ['RETORNO_AGENDADO', 'Retorno para consulta agendada'],
  ['CUIDADO_CONTINUADO', 'Retorno para cuidado continuado/programado'],
  ['GRUPOS', 'Agendamento para grupos'],
  ['ENCAMINHAMENTO', 'Encaminhamento'],
  ['INTERNACAO', 'Encaminhado para internação'],
  ['OBITO', 'Óbito'],
  ['EVASAO', 'Evasão'],
];

const TIPOS_RECEITA: [string, string][] = [
  ['BASICA', 'Receita simples'],
  ['BRANCA_C', 'Controle especial (branca - C)'],
  ['ANTIMICROBIANO', 'Antimicrobiano'],
  ['AZUL_B', 'Notificação azul (B)'],
  ['AMARELA_A', 'Notificação amarela (A)'],
];

interface Completo {
  atendimento: any;
  paciente: any;
  sinais: any[];
  ultimoSinais: any;
  framingham: { percentual: number; classificacao: string } | null;
  prescricoes: any[];
  exames: any[];
  encaminhamentos: any[];
  documentos: any[];
  observacoes: any[];
  administracoes: any[];
  alertas: any[];
}

function CampoSoap({ rotulo, valor, aoMudar, desabilitado }: { rotulo: string; valor: string; aoMudar: (v: string) => void; desabilitado: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <Textarea
      ref={ref}
      label={
        <Group gap={4} component="span">
          {rotulo}
          {!desabilitado && <BotaoDitado alvo={() => ref.current} tamanho="xs" />}
        </Group>
      }
      value={valor}
      onChange={(e) => aoMudar(e.currentTarget.value)}
      autosize
      minRows={3}
      disabled={desabilitado}
    />
  );
}

function AbaSoap({ dados, encerrado, aoGravar }: { dados: Completo; encerrado: boolean; aoGravar: () => void }) {
  const a = dados.atendimento;
  const [s, setS] = useState({ subjetivo: a.subjetivo ?? '', objetivo: a.objetivo ?? '', avaliacao: a.avaliacao ?? '', plano: a.plano ?? '' });
  const [cidId, setCidId] = useState<number | null>(a.cid_id);
  const [ciapId, setCiapId] = useState<number | null>(a.ciap_id);
  const [carater, setCarater] = useState<string | null>(a.carater ?? null);
  const [gravando, setGravando] = useState(false);
  async function gravar(silencioso = false) {
    setGravando(true);
    try {
      await api.put(`/api/atendimentos/${a.id}/soap`, { ...s, cidId, ciapId, carater });
      if (!silencioso) notificarOk('Registro gravado (gravação parcial).');
      aoGravar();
    } catch (e) {
      notificarErro(e);
    } finally {
      setGravando(false);
    }
  }
  return (
    <Stack gap="xs">
      {(a.queixa || a.avaliacao_triagem) && (
        <Alert color="blue" py={6} title="Acolhimento">
          <Text size="sm">
            {a.classificacao_risco && (
              <Badge component="span" color={COR_RISCO[a.classificacao_risco]} mr={6}>
                {a.classificacao_risco}
              </Badge>
            )}
            {a.queixa} {a.avaliacao_triagem ? ` — ${a.avaliacao_triagem}` : ''} {a.profissional_triagem ? `(${a.profissional_triagem})` : ''}
          </Text>
        </Alert>
      )}
      <Grid gutter="xs">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <CampoSoap rotulo="S — Subjetivo" valor={s.subjetivo} aoMudar={(v) => setS({ ...s, subjetivo: v })} desabilitado={encerrado} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <CampoSoap rotulo="O — Objetivo" valor={s.objetivo} aoMudar={(v) => setS({ ...s, objetivo: v })} desabilitado={encerrado} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <CampoSoap rotulo="A — Avaliação" valor={s.avaliacao} aoMudar={(v) => setS({ ...s, avaliacao: v })} desabilitado={encerrado} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <CampoSoap rotulo="P — Plano" valor={s.plano} aoMudar={(v) => setS({ ...s, plano: v })} desabilitado={encerrado} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }}>
          <SelecaoRef entidade="cid" rotulo="CID-10 principal" valor={cidId} aoMudar={setCidId} desabilitado={encerrado} />
          {a.cid_codigo && cidId === a.cid_id && (
            <Text size="xs" c="dimmed">
              {a.cid_codigo} - {a.cid_nome}
            </Text>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <SelecaoRef entidade="ciap" rotulo="CIAP-2" valor={ciapId} aoMudar={setCiapId} desabilitado={encerrado} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 3 }}>
          <Select
            label="Caráter do atendimento"
            value={carater}
            onChange={setCarater}
            disabled={encerrado}
            data={[
              { value: '01', label: 'Eletivo' },
              { value: '02', label: 'Urgência' },
              { value: '03', label: 'Acidente no trabalho' },
              { value: '04', label: 'Acidente no trajeto' },
              { value: '05', label: 'Outros acidentes de trânsito' },
              { value: '06', label: 'Outras lesões/envenenamentos' },
            ]}
          />
        </Grid.Col>
      </Grid>
      {!encerrado && (
        <Group justify="flex-end">
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={gravando} onClick={() => void gravar()}>
            Gravar
          </Button>
        </Group>
      )}
    </Stack>
  );
}

export function GraficoEvolucao({ pacienteId }: { pacienteId: number }) {
  const [dados, setDados] = useState<any[]>([]);
  const [serie, setSerie] = useState('pa');
  useEffect(() => {
    api
      .get(`/api/pacientes/${pacienteId}/evolucao`)
      .then((r: any[]) => setDados(r.map((x) => ({ ...x, quando: dayjs(x.data_hora).format('DD/MM/YY'), peso: x.peso ? Number(x.peso) : null, imc: x.imc ? Number(x.imc) : null, temperatura: x.temperatura ? Number(x.temperatura) : null }))))
      .catch(() => {});
  }, [pacienteId]);
  const series: Record<string, [string, string, string][]> = {
    pa: [
      ['pa_sistolica', 'Sistólica', '#e03131'],
      ['pa_diastolica', 'Diastólica', '#1971c2'],
    ],
    peso: [
      ['peso', 'Peso (kg)', '#2f9e44'],
      ['imc', 'IMC', '#f08c00'],
    ],
    glicemia: [['glicemia', 'Glicemia', '#9c36b5']],
    temperatura: [['temperatura', 'Temperatura', '#e8590c']],
    saturacao: [['saturacao', 'Saturação', '#0c8599']],
  };
  return (
    <Paper withBorder p="xs">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>
          Evolução
        </Text>
        <Select
          size="xs"
          w={180}
          value={serie}
          onChange={(v) => setSerie(v ?? 'pa')}
          data={[
            { value: 'pa', label: 'Pressão arterial' },
            { value: 'peso', label: 'Peso e IMC' },
            { value: 'glicemia', label: 'Glicemia' },
            { value: 'temperatura', label: 'Temperatura' },
            { value: 'saturacao', label: 'Saturação' },
          ]}
        />
      </Group>
      <div style={{ height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="quando" fontSize={10} />
            <YAxis fontSize={10} domain={['auto', 'auto']} />
            <RTooltip />
            <Legend />
            {series[serie].map(([chave, nome, cor]) => (
              <Line key={chave} type="monotone" dataKey={chave} name={nome} stroke={cor} connectNulls dot />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Paper>
  );
}

function AbaSinais({ dados, encerrado, aoGravar }: { dados: Completo; encerrado: boolean; aoGravar: () => void }) {
  const [v, setV] = useState<Record<string, any>>({});
  async function gravar() {
    try {
      await api.post(`/api/atendimentos/${dados.atendimento.id}/sinais-vitais`, v);
      setV({});
      notificarOk('Sinais vitais registrados.');
      aoGravar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack gap="xs">
      {dados.framingham && (
        <Alert color={dados.framingham.classificacao === 'ALTO' ? 'red' : dados.framingham.classificacao === 'MODERADO' ? 'yellow' : 'teal'} py={6} icon={<IconHeartbeat size={16} />}>
          Risco cardiovascular (Framingham) em 10 anos: <b>{String(dados.framingham.percentual).replace('.', ',')}%</b> — {dados.framingham.classificacao}
        </Alert>
      )}
      {!encerrado && (
        <Paper withBorder p="xs">
          <EntradaSinais valores={v} aoMudar={setV} />
          <Group justify="flex-end" mt={6}>
            <Button size="xs" onClick={() => void gravar()} disabled={!Object.keys(v).length}>
              Registrar medidas
            </Button>
          </Group>
        </Paper>
      )}
      <TabelaSimples
        linhas={dados.sinais}
        colunas={[
          { titulo: 'Data/hora', valor: (l: any) => fmtDataHora(l.data_hora) },
          ...CAMPOS_SINAIS.slice(0, 9).map(([n, r]) => ({ titulo: r, valor: (l: any) => (l[n] != null ? String(l[n]).replace('.', ',') : '') })),
          { titulo: 'IMC', valor: (l: any) => l.imc },
        ]}
      />
      <GraficoEvolucao pacienteId={dados.atendimento.paciente_id} />
    </Stack>
  );
}

interface ItemRx {
  produtoId: number | null;
  descricao: string;
  quantidade?: number;
  posologia: string;
  via: string;
  usoContinuo: boolean;
  tipoReceita?: string;
}

const itemVazio = (): ItemRx => ({ produtoId: null, descricao: '', posologia: '', via: 'ORAL', usoContinuo: false });

function AbaPrescricao({ dados, encerrado, aoGravar }: { dados: Completo; encerrado: boolean; aoGravar: () => void }) {
  const [itens, setItens] = useState<ItemRx[]>([itemVazio()]);
  const [orientacoes, setOrientacoes] = useState('');
  const [usoInterno, setUsoInterno] = useState(false);
  const [continuos, setContinuos] = useState<any[] | null>(null);
  const mudar = (i: number, p: Partial<ItemRx>) => setItens(itens.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function renovar() {
    const r = await api.get(`/api/pacientes/${dados.atendimento.paciente_id}/uso-continuo`);
    setContinuos(r);
  }
  async function prescrever() {
    const validos = itens.filter((i) => i.produtoId || i.descricao.trim());
    if (!validos.length) return;
    try {
      const r = await comConfirmacao(
        (ok) =>
          api.post(`/api/atendimentos/${dados.atendimento.id}/prescricoes`, {
            itens: validos.map((i) => ({ ...i, produtoId: i.produtoId ?? undefined, descricao: i.descricao || undefined })),
            orientacoes: orientacoes || undefined,
            usoInterno,
            confirmarAlergia: ok,
          }),
        'Alerta de alergia',
      );
      if (!r) return;
      notificarOk(`${r.length} receita(s) gerada(s): ${r.map((x: any) => x.numero).join(', ')}.`);
      for (const rec of r) void abrirPdf(`/api/documentos/receita/${rec.id}`);
      setItens([itemVazio()]);
      setOrientacoes('');
      aoGravar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack gap="xs">
      {!encerrado && (
        <Paper withBorder p="xs">
          <Stack gap={6}>
            {itens.map((i, idx) => (
              <Grid key={idx} gutter={6} align="flex-end">
                <Grid.Col span={{ base: 12, md: 3 }}>
                  <SelecaoRef entidade="produto" rotulo="Medicamento (REMUME)" valor={i.produtoId} aoMudar={(v, r) => mudar(idx, { produtoId: v, descricao: v ? '' : i.descricao, ...(r ? {} : {}) })} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 2 }}>
                  <TextInput size="sm" label="ou descrição livre" value={i.descricao} disabled={!!i.produtoId} onChange={(e) => mudar(idx, { descricao: e.currentTarget.value })} />
                </Grid.Col>
                <Grid.Col span={{ base: 4, md: 1 }}>
                  <NumberInput label="Qtde." min={0} value={i.quantidade ?? ''} onChange={(v) => mudar(idx, { quantidade: v === '' ? undefined : Number(v) })} />
                </Grid.Col>
                <Grid.Col span={{ base: 8, md: 3 }}>
                  <TextInput label="Posologia" value={i.posologia} onChange={(e) => mudar(idx, { posologia: e.currentTarget.value })} placeholder="1 comprimido de 8/8h por 7 dias" />
                </Grid.Col>
                <Grid.Col span={{ base: 6, md: 1 }}>
                  <Select label="Via" value={i.via} onChange={(v) => mudar(idx, { via: v ?? 'ORAL' })} data={['ORAL', 'IM', 'EV', 'SC', 'TOPICA', 'INALATORIA', 'OFTALMICA', 'RETAL', 'SUBLINGUAL']} />
                </Grid.Col>
                <Grid.Col span={{ base: 6, md: 1.5 }}>
                  <Select label="Receita" clearable placeholder="automática" value={i.tipoReceita ?? null} onChange={(v) => mudar(idx, { tipoReceita: v ?? undefined })} data={TIPOS_RECEITA.map(([value, label]) => ({ value, label }))} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 0.5 }}>
                  <Group gap={2} wrap="nowrap">
                    <Tooltip label="Uso contínuo">
                      <Checkbox checked={i.usoContinuo} onChange={(e) => mudar(idx, { usoContinuo: e.currentTarget.checked })} />
                    </Tooltip>
                    <ActionIcon variant="subtle" color="red" onClick={() => setItens(itens.length > 1 ? itens.filter((_, j) => j !== idx) : [itemVazio()])}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Grid.Col>
              </Grid>
            ))}
            <Group gap="xs">
              <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setItens([...itens, itemVazio()])}>
                Adicionar medicamento
              </Button>
              <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={() => void renovar()}>
                Renovar uso contínuo
              </Button>
            </Group>
            <Textarea label="Orientações" value={orientacoes} onChange={(e) => setOrientacoes(e.currentTarget.value)} autosize minRows={1} />
            <Group justify="space-between">
              <Checkbox label="Uso interno (administração na unidade)" checked={usoInterno} onChange={(e) => setUsoInterno(e.currentTarget.checked)} />
              <Button leftSection={<IconPill size={16} />} onClick={() => void prescrever()}>
                Prescrever e imprimir
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
      {dados.prescricoes.map((r) => (
        <Paper key={r.id} withBorder p="xs">
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              Receita {r.numero} · {TIPOS_RECEITA.find(([v]) => v === r.tipo_receita)?.[1] ?? r.tipo_receita} {r.uso_interno ? '· uso interno' : ''}
            </Text>
            <Button size="compact-xs" variant="light" leftSection={<IconPrinter size={12} />} onClick={() => void abrirPdf(`/api/documentos/receita/${r.id}`)}>
              Imprimir
            </Button>
          </Group>
          {(r.itens ?? []).map((i: any) => (
            <Text key={i.id} size="xs">
              • {i.descricao} {i.quantidade ? `— ${i.quantidade}` : ''} {i.posologia ? `— ${i.posologia}` : ''} {i.uso_continuo ? '(uso contínuo)' : ''}
            </Text>
          ))}
        </Paper>
      ))}
      <Modal opened={!!continuos} onClose={() => setContinuos(null)} title="Medicamentos de uso contínuo" size="lg">
        <TabelaSimples
          linhas={continuos ?? []}
          vazio="Nenhum medicamento de uso contínuo prescrito anteriormente."
          colunas={[
            { titulo: 'Medicamento', valor: (l: any) => l.descricao },
            { titulo: 'Posologia', valor: (l: any) => l.posologia },
            { titulo: 'Última receita', valor: (l: any) => fmtData(l.data_receita) },
          ]}
        />
        <Group justify="flex-end" mt="sm">
          <Button
            onClick={() => {
              setItens((continuos ?? []).map((l) => ({ produtoId: l.produto_id, descricao: l.produto_id ? '' : l.descricao, quantidade: l.quantidade ? Number(l.quantidade) : undefined, posologia: l.posologia ?? '', via: l.via ?? 'ORAL', usoContinuo: true })));
              setContinuos(null);
            }}
            disabled={!continuos?.length}
          >
            Renovar todos
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}

function AbaExames({ dados, encerrado, aoGravar }: { dados: Completo; encerrado: boolean; aoGravar: () => void }) {
  const [itens, setItens] = useState<{ id: number; rotulo: string }[]>([]);
  const [proc, setProc] = useState<number | null>(null);
  const [f, setF] = useState<Record<string, any>>({ prioridade: 'AZUL' });
  async function requisitar() {
    try {
      const r = await comConfirmacao(
        (ok) =>
          api.post(`/api/atendimentos/${dados.atendimento.id}/exames`, {
            itens: itens.map((i) => ({ procedimentoId: i.id })),
            dadosClinicos: f.dadosClinicos || undefined,
            justificativa: f.justificativa || undefined,
            prioridade: f.prioridade,
            usoInterno: !!f.usoInterno,
            confirmarAvisos: ok,
          }),
        'Avisos da requisição',
      );
      if (!r) return;
      notificarOk(`${r.requisicoes.length} requisição(ões) gerada(s).`);
      for (const q of r.requisicoes) void abrirPdf(`/api/documentos/requisicao/${q.id}`);
      setItens([]);
      aoGravar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function cancelarReq(id: number) {
    const justificativa = await pedirTexto('Cancelar requisição', 'Justificativa');
    if (!justificativa) return;
    await api.post(`/api/solicitacoes-exame/${id}/cancelar`, { justificativa }).then(aoGravar).catch(notificarErro);
  }
  return (
    <Stack gap="xs">
      {!encerrado && (
        <Paper withBorder p="xs">
          <Group align="flex-end" gap="xs">
            <div style={{ flex: 1 }}>
              <SelecaoRef entidade="procedimento" rotulo="Exame (SIGTAP)" valor={proc} aoMudar={(v, r) => (v && !itens.some((i) => i.id === v) && setItens([...itens, { id: v, rotulo: r ?? `#${v}` }]), setProc(null))} />
            </div>
          </Group>
          <Group gap={4} my={6}>
            {itens.map((i) => (
              <Badge key={i.id} variant="light" rightSection={<IconTrash size={10} style={{ cursor: 'pointer' }} onClick={() => setItens(itens.filter((x) => x.id !== i.id))} />}>
                {i.rotulo}
              </Badge>
            ))}
          </Group>
          <Grid gutter={6}>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Textarea label="Dados clínicos" value={f.dadosClinicos ?? ''} onChange={(e) => setF({ ...f, dadosClinicos: e.currentTarget.value })} autosize minRows={1} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Textarea label="Justificativa" value={f.justificativa ?? ''} onChange={(e) => setF({ ...f, justificativa: e.currentTarget.value })} autosize minRows={1} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <Select label="Prioridade" value={f.prioridade} onChange={(v) => setF({ ...f, prioridade: v ?? 'AZUL' })} data={RISCOS.map(([value, label]) => ({ value, label }))} />
            </Grid.Col>
          </Grid>
          <Group justify="space-between" mt={6}>
            <Checkbox label="Uso interno (coleta na unidade)" checked={!!f.usoInterno} onChange={(e) => setF({ ...f, usoInterno: e.currentTarget.checked })} />
            <Button leftSection={<IconTestPipe size={16} />} disabled={!itens.length} onClick={() => void requisitar()}>
              Requisitar e imprimir
            </Button>
          </Group>
        </Paper>
      )}
      {dados.exames.map((s) => (
        <Paper key={s.id} withBorder p="xs">
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              Requisição {s.numero} <Situacao valor={s.situacao} />
            </Text>
            <Group gap={4}>
              <Button size="compact-xs" variant="light" leftSection={<IconPrinter size={12} />} onClick={() => void abrirPdf(`/api/documentos/requisicao/${s.id}`)}>
                Imprimir
              </Button>
              {s.situacao === 'REQUISITADO' && (
                <Button size="compact-xs" variant="subtle" color="red" onClick={() => void cancelarReq(s.id)}>
                  Cancelar
                </Button>
              )}
            </Group>
          </Group>
          {(s.itens ?? []).map((i: any) => (
            <Group key={i.id} gap={6}>
              <Text size="xs">• {i.procedimento}</Text>
              <Situacao valor={i.situacao} />
              {i.resultado && (
                <Text size="xs" c="dimmed">
                  {i.resultado}
                </Text>
              )}
              {i.situacao === 'RESULTADO' && (
                <Button size="compact-xs" variant="subtle" leftSection={<IconCheck size={12} />} onClick={() => api.post(`/api/solicitacoes-exame/itens/${i.id}/avaliado`).then(aoGravar)}>
                  Avaliado
                </Button>
              )}
            </Group>
          ))}
        </Paper>
      ))}
    </Stack>
  );
}

function AbaEncaminhamentos({ dados, encerrado, aoGravar }: { dados: Completo; encerrado: boolean; aoGravar: () => void }) {
  const [f, setF] = useState<Record<string, any>>({ urgencia: 'AZUL' });
  async function encaminhar() {
    try {
      await api.post(`/api/atendimentos/${dados.atendimento.id}/encaminhamentos`, { ...f, cidId: f.cidId ?? dados.atendimento.cid_id ?? undefined });
      notificarOk('Encaminhamento registrado; paciente incluído na lista de espera da especialidade.');
      setF({ urgencia: 'AZUL' });
      aoGravar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack gap="xs">
      {!encerrado && (
        <Paper withBorder p="xs">
          <Grid gutter={6}>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <SelecaoRef entidade="especialidade" rotulo="Especialidade" valor={f.especialidadeId} aoMudar={(v) => setF({ ...f, especialidadeId: v })} obrigatorio />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <SelecaoRef entidade="tipo_encaminhamento" rotulo="Tipo de encaminhamento" valor={f.tipoEncaminhamentoId} aoMudar={(v) => setF({ ...f, tipoEncaminhamentoId: v })} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Select label="Classificação / urgência" value={f.urgencia} onChange={(v) => setF({ ...f, urgencia: v })} data={RISCOS.map(([value, label]) => ({ value, label }))} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Textarea label="Investigação / história clínica" value={f.investigacao ?? ''} onChange={(e) => setF({ ...f, investigacao: e.currentTarget.value })} autosize minRows={2} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Textarea label="Hipótese diagnóstica" value={f.diagnostico ?? ''} onChange={(e) => setF({ ...f, diagnostico: e.currentTarget.value })} autosize minRows={2} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Checkbox mt="md" label="Prioritário" checked={!!f.prioritario} onChange={(e) => setF({ ...f, prioritario: e.currentTarget.checked })} />
            </Grid.Col>
            {f.prioritario && (
              <Grid.Col span={{ base: 12, md: 6 }}>
                <TextInput label="Justificativa da prioridade" value={f.justificativaPrioridade ?? ''} onChange={(e) => setF({ ...f, justificativaPrioridade: e.currentTarget.value })} />
              </Grid.Col>
            )}
          </Grid>
          <Group justify="flex-end" mt={6}>
            <Button leftSection={<IconArrowForward size={16} />} disabled={!f.especialidadeId} onClick={() => void encaminhar()}>
              Encaminhar
            </Button>
          </Group>
        </Paper>
      )}
      <TabelaSimples
        linhas={dados.encaminhamentos}
        colunas={[
          { titulo: 'Data', valor: (l: any) => fmtData(l.data) },
          { titulo: 'Especialidade', valor: (l: any) => l.especialidade },
          { titulo: 'Urgência', valor: (l: any) => <Badge size="xs" color={COR_RISCO[l.urgencia]}>{l.urgencia}</Badge> },
          { titulo: 'Diagnóstico', valor: (l: any) => l.diagnostico },
          { titulo: 'Situação', valor: (l: any) => <Situacao valor={l.situacao} /> },
        ]}
      />
    </Stack>
  );
}

const TIPOS_DOCUMENTO: [string, string][] = [
  ['ATESTADO_MEDICO', 'Atestado médico'],
  ['ATESTADO_ODONTO', 'Atestado odontológico'],
  ['COMPARECIMENTO', 'Declaração de comparecimento'],
  ['COMPARECIMENTO_ACOMPANHANTE', 'Declaração de comparecimento (acompanhante)'],
  ['CAT', 'Atestado para CAT'],
  ['RESUMO', 'Resumo de atendimento'],
  ['OUTRO', 'Documento livre'],
];

function AbaDocumentos({ dados }: { dados: Completo }) {
  const [f, setF] = useState<Record<string, any>>({ tipo: 'ATESTADO_MEDICO', diasAfastamento: 1 });
  const emitir = () =>
    api
      .arquivo(`/api/atendimentos/${dados.atendimento.id}/documentos`, { ...f, cidId: f.incluirCid ? (dados.atendimento.cid_id ?? undefined) : undefined, incluirCid: undefined }, 'abrir')
      .catch(notificarErro);
  return (
    <Stack gap="xs" maw={720}>
      <Select label="Documento" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} data={TIPOS_DOCUMENTO.map(([value, label]) => ({ value, label }))} />
      {f.tipo?.startsWith('ATESTADO') || f.tipo === 'CAT' ? (
        <Group>
          <NumberInput label="Dias de afastamento" min={1} value={f.diasAfastamento} onChange={(v) => setF({ ...f, diasAfastamento: Number(v) || 1 })} w={180} />
          <Checkbox mt="lg" label="Incluir CID (com autorização do paciente)" checked={!!f.incluirCid} onChange={(e) => setF({ ...f, incluirCid: e.currentTarget.checked })} />
        </Group>
      ) : null}
      {f.tipo?.startsWith('COMPARECIMENTO') && <TextInput label="Período" placeholder="das 08:00 às 10:30" value={f.periodo ?? ''} onChange={(e) => setF({ ...f, periodo: e.currentTarget.value })} />}
      {f.tipo === 'COMPARECIMENTO_ACOMPANHANTE' && <TextInput label="Nome do acompanhante" value={f.acompanhante ?? ''} onChange={(e) => setF({ ...f, acompanhante: e.currentTarget.value })} />}
      <Textarea label="Texto complementar" value={f.texto ?? ''} onChange={(e) => setF({ ...f, texto: e.currentTarget.value })} autosize minRows={2} />
      <Group>
        <Button leftSection={<IconFileText size={16} />} onClick={() => void emitir()}>
          Emitir documento
        </Button>
      </Group>
      <TabelaSimples
        linhas={dados.documentos}
        vazio="Nenhum documento emitido neste atendimento."
        colunas={[
          { titulo: 'Emitido em', valor: (l: any) => fmtData(l.data) },
          { titulo: 'Tipo', valor: (l: any) => TIPOS_DOCUMENTO.find(([v]) => v === l.tipo)?.[1] ?? l.tipo },
          { titulo: 'Código', valor: (l: any) => l.codigo_emissao },
        ]}
      />
    </Stack>
  );
}

function AbaObservacao({ dados, aoGravar }: { dados: Completo; aoGravar: () => void }) {
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<string>('ENFERMAGEM');
  const [med, setMed] = useState<Record<string, any>>({});
  const agora = () => new Date().toISOString();
  async function registrar() {
    try {
      await api.post('/api/e/registro_observacao', { atendimento_id: dados.atendimento.id, data_hora: agora(), tipo, texto });
      setTexto('');
      aoGravar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function administrar() {
    try {
      await api.post('/api/e/administracao_medicamento', { atendimento_id: dados.atendimento.id, data_hora: agora(), ...med });
      setMed({});
      aoGravar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Grid gutter="sm">
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Evolução da observação
          </Text>
          <Group align="flex-end" gap="xs">
            <Select
              w={190}
              label="Tipo"
              value={tipo}
              onChange={(v) => setTipo(v ?? 'ENFERMAGEM')}
              data={[
                { value: 'ENFERMAGEM', label: 'Registro de enfermagem' },
                { value: 'MEDICA', label: 'Avaliação médica' },
              ]}
            />
          </Group>
          <Textarea value={texto} onChange={(e) => setTexto(e.currentTarget.value)} autosize minRows={3} placeholder="Evolução..." />
          <Group justify="flex-end">
            <Button size="xs" disabled={!texto.trim()} onClick={() => void registrar()}>
              Registrar
            </Button>
          </Group>
          <Timeline bulletSize={14} lineWidth={2}>
            {dados.observacoes.map((o) => (
              <Timeline.Item key={o.id} title={`${fmtDataHora(o.data_hora)} · ${o.tipo === 'MEDICA' ? 'Médica' : 'Enfermagem'} · ${o.profissional ?? ''}`}>
                <Text size="xs">{o.texto}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            Administração de medicamentos
          </Text>
          <Group grow align="flex-end">
            <TextInput label="Medicamento" value={med.descricao ?? ''} onChange={(e) => setMed({ ...med, descricao: e.currentTarget.value })} />
            <TextInput label="Dose" value={med.dose ?? ''} onChange={(e) => setMed({ ...med, dose: e.currentTarget.value })} />
            <TextInput label="Via" value={med.via ?? ''} onChange={(e) => setMed({ ...med, via: e.currentTarget.value })} />
          </Group>
          <Group justify="flex-end">
            <Button size="xs" disabled={!med.descricao} onClick={() => void administrar()}>
              Checar administração
            </Button>
          </Group>
          <TabelaSimples
            linhas={dados.administracoes}
            colunas={[
              { titulo: 'Horário', valor: (l: any) => fmtDataHora(l.data_hora) },
              { titulo: 'Medicamento', valor: (l: any) => l.descricao },
              { titulo: 'Dose', valor: (l: any) => l.dose },
              { titulo: 'Via', valor: (l: any) => l.via },
              { titulo: 'Profissional', valor: (l: any) => l.profissional },
            ]}
          />
        </Stack>
      </Grid.Col>
    </Grid>
  );
}

export function HistoricoProntuario({ pacienteId }: { pacienteId: number }) {
  const [linhas, setLinhas] = useState<any[]>([]);
  useEffect(() => {
    api
      .get(`/api/pacientes/${pacienteId}/prontuario`)
      .then((r) => setLinhas(r.atendimentos))
      .catch(notificarErro);
  }, [pacienteId]);
  return (
    <Stack gap="xs">
      <Group justify="flex-end">
        <Button size="xs" variant="light" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/documentos/prontuario/${pacienteId}`)}>
          Imprimir prontuário
        </Button>
      </Group>
      <Timeline bulletSize={16} lineWidth={2}>
        {linhas.map((a) => (
          <Timeline.Item key={a.id} color={COR_RISCO[a.classificacao_risco] ?? 'blue'} title={`${fmtDataHora(a.entrada_em)} · ${a.unidade} · ${a.especialidade ?? a.tipo_unidade ?? ''}`}>
            <Text size="xs" c="dimmed">
              {a.profissional} {a.registro ? `(${a.registro})` : ''} <Situacao valor={a.situacao} />
            </Text>
            {a.queixa && <Text size="xs">Queixa: {a.queixa}</Text>}
            {a.subjetivo && <Text size="xs">S: {a.subjetivo}</Text>}
            {a.objetivo && <Text size="xs">O: {a.objetivo}</Text>}
            {a.avaliacao && <Text size="xs">A: {a.avaliacao}</Text>}
            {a.plano && <Text size="xs">P: {a.plano}</Text>}
            {a.cid && <Text size="xs">CID: {a.cid}</Text>}
            {a.prescricoes && <Text size="xs">Prescrição: {a.prescricoes.join('; ')}</Text>}
            {a.exames && <Text size="xs">Exames: {a.exames.join('; ')}</Text>}
            {a.encaminhamentos && <Text size="xs">Encaminhamentos: {a.encaminhamentos.join('; ')}</Text>}
            {a.procedimentos && (
              <Text size="xs" c="dimmed">
                Procedimentos: {a.procedimentos.join('; ')}
              </Text>
            )}
          </Timeline.Item>
        ))}
      </Timeline>
      {!linhas.length && (
        <Text size="sm" c="dimmed">
          Sem atendimentos anteriores.
        </Text>
      )}
    </Stack>
  );
}

function AbaSigiloso({ dados }: { dados: Completo }) {
  const pid = dados.atendimento.paciente_id;
  const [linhas, setLinhas] = useState<any[]>([]);
  const [texto, setTexto] = useState('');
  const carregar = () => api.get(`/api/pacientes/${pid}/sigilosos`).then(setLinhas).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [pid]);
  async function liberar(id: number) {
    const prof = await pedirTexto('Liberar acesso', 'Código do profissional que poderá visualizar');
    if (!prof) return;
    await api.post(`/api/sigilosos/${id}/liberar`, { profissionalId: Number(prof) }).then(() => notificarOk('Acesso liberado.')).catch(notificarErro);
  }
  return (
    <Stack gap="xs">
      <Alert color="gray" icon={<IconLock size={16} />} py={6}>
        Registros sigilosos são visíveis apenas ao profissional autor e aos profissionais que ele liberar.
      </Alert>
      <Textarea value={texto} onChange={(e) => setTexto(e.currentTarget.value)} autosize minRows={3} />
      <Group justify="flex-end">
        <Button size="xs" disabled={!texto.trim()} onClick={() => api.post(`/api/pacientes/${pid}/sigilosos`, { texto, atendimentoId: dados.atendimento.id }).then(() => (setTexto(''), carregar())).catch(notificarErro)}>
          Registrar sigiloso
        </Button>
      </Group>
      {linhas.map((l) => (
        <Paper key={l.id} withBorder p="xs">
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {fmtDataHora(l.data_hora)} · {l.autor}
            </Text>
            <Button size="compact-xs" variant="subtle" onClick={() => void liberar(l.id)}>
              Liberar a profissional
            </Button>
          </Group>
          <Text size="sm">{l.texto}</Text>
        </Paper>
      ))}
    </Stack>
  );
}

function ModalFinalizar({ dados, aoFechar }: { dados: Completo; aoFechar: (ok: boolean) => void }) {
  const [desfecho, setDesfecho] = useState<string | null>(dados.atendimento.tipo_unidade === 'UPA' ? null : 'ALTA');
  const [retorno, setRetorno] = useState<number | ''>('');
  const [procs, setProcs] = useState<{ id: number; rotulo: string }[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  async function finalizar() {
    try {
      await api.post(`/api/atendimentos/${dados.atendimento.id}/finalizar`, { desfecho, retornoDias: retorno === '' ? undefined : retorno, procedimentos: procs.map((p) => ({ procedimentoId: p.id })) });
      notificarOk('Atendimento finalizado; produção lançada para o faturamento.');
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  async function validarProc(id: number, rotulo?: string) {
    try {
      const v = await api.get(`/api/procedimentos/${id}/validar`, { pacienteId: dados.atendimento.paciente_id });
      if (v && v.valido === false) return notificarErro(new Error((v.criticas ?? []).join(' ')));
      setProcs([...procs, { id, rotulo: rotulo ?? `#${id}` }]);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} title="Finalizar atendimento" size="lg">
      <Stack gap="xs">
        {!dados.atendimento.cid_id && (
          <Alert color="yellow" py={6}>
            Nenhum CID informado no atendimento.
          </Alert>
        )}
        <Select label="Desfecho" required value={desfecho} onChange={setDesfecho} data={DESFECHOS.map(([value, label]) => ({ value, label }))} />
        {['RETORNO_AGENDADO', 'CUIDADO_CONTINUADO'].includes(desfecho ?? '') && <NumberInput label="Retorno em (dias)" min={1} value={retorno} onChange={(v) => setRetorno(v === '' ? '' : Number(v))} w={180} />}
        <SelecaoRef entidade="procedimento" rotulo="Procedimentos realizados (além da consulta)" valor={sel} aoMudar={(v, r) => (v && void validarProc(v, r), setSel(null))} />
        <Group gap={4}>
          {procs.map((p) => (
            <Badge key={p.id} variant="light" rightSection={<IconTrash size={10} style={{ cursor: 'pointer' }} onClick={() => setProcs(procs.filter((x) => x.id !== p.id))} />}>
              {p.rotulo}
            </Badge>
          ))}
        </Group>
        <Group justify="flex-end">
          <Button color="teal" disabled={!desfecho} onClick={() => void finalizar()}>
            Finalizar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TelaAtendimento({ id }: { id: number }) {
  const [dados, setDados] = useState<Completo | null>(null);
  const [aba, setAba] = useState<string | null>('soap');
  const [finalizando, setFinalizando] = useState(false);
  const { fechar } = useJanelas();
  useTituloJanela(dados ? `Atendimento ${dados.atendimento.senha ?? ''} — ${dados.paciente?.nome?.split(' ')[0] ?? ''}` : 'Atendimento');
  const carregar = () => api.get<Completo>(`/api/atendimentos/${id}/completo`).then(setDados).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [id]);
  if (!dados) return null;
  const a = dados.atendimento;
  const encerrado = ['FINALIZADO', 'CANCELADO', 'NAO_ATENDIDO', 'EVADIDO'].includes(a.situacao);
  const observacao = a.situacao === 'EM_OBSERVACAO';
  const props = { dados, encerrado, aoGravar: () => void carregar() };
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Group gap="xs">
          <Title order={4}>Atendimento</Title>
          <Situacao valor={a.situacao} />
          <Text size="sm" c="dimmed">
            {a.unidade} · {a.fila} · entrada {fmtDataHora(a.entrada_em)} {a.profissional ? `· ${a.profissional}` : ''}
          </Text>
        </Group>
        {!encerrado && (
          <Button color="teal" leftSection={<IconCheck size={16} />} onClick={() => setFinalizando(true)}>
            {observacao ? 'Alta da observação' : 'Finalizar atendimento'}
          </Button>
        )}
      </Group>
      <CabecalhoPaciente paciente={{ ...dados.paciente, alertas: dados.alertas }} aoAtualizar={() => void carregar()} />
      <Tabs value={aba} onChange={setAba} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="soap">SOAP</Tabs.Tab>
          <Tabs.Tab value="sinais">Sinais vitais e evolução</Tabs.Tab>
          <Tabs.Tab value="prescricao">Prescrição ({dados.prescricoes.length})</Tabs.Tab>
          <Tabs.Tab value="exames">Exames ({dados.exames.length})</Tabs.Tab>
          <Tabs.Tab value="encaminhamentos">Encaminhamentos ({dados.encaminhamentos.length})</Tabs.Tab>
          <Tabs.Tab value="documentos">Atestados e documentos</Tabs.Tab>
          {(observacao || dados.observacoes.length > 0 || a.tipo_unidade === 'UPA') && <Tabs.Tab value="observacao">Observação</Tabs.Tab>}
          <Tabs.Tab value="prontuario">Histórico (prontuário)</Tabs.Tab>
          <Tabs.Tab value="sigiloso" leftSection={<IconLock size={12} />}>
            Sigiloso
          </Tabs.Tab>
        </Tabs.List>
        <Paper p="sm" withBorder style={{ borderTop: 0 }}>
          <Tabs.Panel value="soap">
            <AbaSoap {...props} />
          </Tabs.Panel>
          <Tabs.Panel value="sinais">
            <AbaSinais {...props} />
          </Tabs.Panel>
          <Tabs.Panel value="prescricao">
            <AbaPrescricao {...props} />
          </Tabs.Panel>
          <Tabs.Panel value="exames">
            <AbaExames {...props} />
          </Tabs.Panel>
          <Tabs.Panel value="encaminhamentos">
            <AbaEncaminhamentos {...props} />
          </Tabs.Panel>
          <Tabs.Panel value="documentos">
            <AbaDocumentos dados={dados} />
          </Tabs.Panel>
          <Tabs.Panel value="observacao">
            <AbaObservacao dados={dados} aoGravar={() => void carregar()} />
          </Tabs.Panel>
          <Tabs.Panel value="prontuario">
            <HistoricoProntuario pacienteId={a.paciente_id} />
          </Tabs.Panel>
          <Tabs.Panel value="sigiloso">
            <AbaSigiloso dados={dados} />
          </Tabs.Panel>
        </Paper>
      </Tabs>
      {finalizando && (
        <ModalFinalizar
          dados={dados}
          aoFechar={async (ok) => {
            setFinalizando(false);
            if (!ok) return;
            await carregar();
            if (await confirmar('Atendimento finalizado', 'Deseja fechar a janela deste atendimento?', 'Fechar')) fechar(`/t/atendimento/${id}`);
          }}
        />
      )}
    </Stack>
  );
}

registrarTela({
  id: 'atendimento',
  titulo: 'Atendimento',
  padrao: '/t/atendimento/:id',
  permissao: 'atendimento_clinico:executar',
  modulo: 'PEP',
  render: ({ params }) => <TelaAtendimento id={Number(params.id)} />,
});
