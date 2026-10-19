// Fila de atendimento (TR 1.2.16, 1.2.17, 1.2.31, 1.2.42.2): filtros por etapa, ordenação por risco/
// chegada/horário/idade, destaque de menores de 2 e maiores de 60 anos, chamada no painel, triagem e início.
import { useEffect, useState } from 'react';
import { Badge, Button, Grid, Group, Modal, NumberInput, Paper, ScrollArea, SegmentedControl, Select, Stack, Switch, Table, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core';
import { IconPlayerPlay, IconSpeakerphone, IconStethoscope, IconUserX } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useAuth } from '@/auth/Auth';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { COR_RISCO, notificarErro, notificarOk, RISCOS, SelecaoRef, Situacao, useIntervalo } from '@/componentes/comum';
import { pedirTexto } from '@/genericos/dialogos';
import { registrarTela } from './registro';

const FILTROS: [string, string][] = [
  ['aguardando', 'Aguardando'],
  ['nao_triados', 'Não triados'],
  ['triados', 'Triados'],
  ['nao_atendidos', 'Não atendidos'],
  ['atendidos', 'Atendidos'],
  ['observacao', 'Em observação'],
  ['encaminhados', 'Encaminhados'],
  ['agendados', 'Agendados'],
  ['nao_realizados', 'Não realizados'],
  ['todos', 'Todos'],
];

export const CAMPOS_SINAIS: [string, string, number?][] = [
  ['peso', 'Peso (kg)', 3],
  ['altura', 'Altura (cm)', 1],
  ['pa_sistolica', 'PA sistólica'],
  ['pa_diastolica', 'PA diastólica'],
  ['temperatura', 'Temperatura (°C)', 1],
  ['frequencia_cardiaca', 'FC (bpm)'],
  ['frequencia_respiratoria', 'FR (irpm)'],
  ['saturacao', 'Saturação O₂ (%)'],
  ['glicemia', 'Glicemia (mg/dL)'],
  ['dor', 'Dor (0-10)'],
  ['cintura', 'Cintura (cm)', 1],
  ['perimetro_cefalico', 'Perímetro cefálico (cm)', 1],
];

/** Campos de sinais vitais e medidas antropométricas, com cálculo de IMC na tela. */
export function EntradaSinais({ valores, aoMudar }: { valores: Record<string, any>; aoMudar: (v: Record<string, any>) => void }) {
  const imc = valores.peso && valores.altura ? valores.peso / (valores.altura / 100) ** 2 : null;
  return (
    <Stack gap={4}>
      <Grid gutter={6}>
        {CAMPOS_SINAIS.map(([nome, rotulo, casas]) => (
          <Grid.Col key={nome} span={{ base: 6, sm: 4, md: 3 }}>
            <NumberInput size="xs" label={rotulo} decimalScale={casas ?? 0} decimalSeparator="," value={valores[nome] ?? ''} onChange={(v) => aoMudar({ ...valores, [nome]: v === '' ? undefined : Number(v) })} />
          </Grid.Col>
        ))}
        <Grid.Col span={{ base: 6, sm: 4, md: 3 }}>
          <Select
            size="xs"
            label="Momento da glicemia"
            clearable
            value={valores.glicemia_momento ?? null}
            onChange={(v) => aoMudar({ ...valores, glicemia_momento: v ?? undefined })}
            data={[
              { value: 'JEJUM', label: 'Jejum' },
              { value: 'POS_PRANDIAL', label: 'Pós-prandial' },
              { value: 'CASUAL', label: 'Casual' },
            ]}
          />
        </Grid.Col>
      </Grid>
      {imc && (
        <Text size="xs">
          IMC: <b>{imc.toFixed(2).replace('.', ',')}</b> {imc < 18.5 ? '(baixo peso)' : imc < 25 ? '(adequado)' : imc < 30 ? '(sobrepeso)' : '(obesidade)'}
        </Text>
      )}
    </Stack>
  );
}

function ModalTriagem({ linha, aoFechar }: { linha: any; aoFechar: (ok: boolean) => void }) {
  const { paciente, recarregar } = usePaciente(linha.paciente_id, 'triagem');
  const [sinais, setSinais] = useState<Record<string, any>>({});
  const [f, setF] = useState<Record<string, any>>({ classificacaoRisco: linha.classificacao_risco ?? linha.pre_classificacao, queixa: linha.queixa ?? '' });
  const [salvando, setSalvando] = useState(false);
  async function salvar() {
    setSalvando(true);
    try {
      await api.post(`/api/atendimentos/${linha.id}/triagem`, {
        sinais,
        classificacaoRisco: f.classificacaoRisco ?? undefined,
        queixa: f.queixa || undefined,
        sintomas: f.sintomas || undefined,
        avaliacao: f.avaliacao || undefined,
        encaminharFilaId: f.filaId ?? undefined,
        profissionalId: f.profissionalId ?? undefined,
        especialidadeId: f.especialidadeId ?? undefined,
      });
      notificarOk('Acolhimento registrado.');
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    } finally {
      setSalvando(false);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} size="xl" title={`Acolhimento / classificação de risco — senha ${linha.senha}`}>
      <Stack gap="xs">
        {paciente && <CabecalhoPaciente paciente={paciente} compacto aoAtualizar={recarregar} />}
        <EntradaSinais valores={sinais} aoMudar={setSinais} />
        <Textarea size="xs" label="Queixa principal" value={f.queixa} onChange={(e) => setF({ ...f, queixa: e.currentTarget.value })} autosize minRows={2} data-ditado />
        <Grid gutter={6}>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Textarea size="xs" label="Sintomas" value={f.sintomas ?? ''} onChange={(e) => setF({ ...f, sintomas: e.currentTarget.value })} autosize minRows={2} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Textarea size="xs" label="Avaliação da enfermagem" value={f.avaliacao ?? ''} onChange={(e) => setF({ ...f, avaliacao: e.currentTarget.value })} autosize minRows={2} />
          </Grid.Col>
        </Grid>
        <Text size="xs" fw={600}>
          Classificação de risco
        </Text>
        <Group gap={6}>
          {RISCOS.map(([v, r]) => (
            <Button key={v} size="xs" color={COR_RISCO[v]} variant={f.classificacaoRisco === v ? 'filled' : 'light'} onClick={() => setF({ ...f, classificacaoRisco: v })}>
              {r}
            </Button>
          ))}
        </Group>
        <Grid gutter={6}>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <SelecaoRef entidade="fila" rotulo="Encaminhar para a fila" valor={f.filaId} aoMudar={(v) => setF({ ...f, filaId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <SelecaoRef entidade="profissional" rotulo="Profissional" valor={f.profissionalId} aoMudar={(v) => setF({ ...f, profissionalId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <SelecaoRef entidade="especialidade" rotulo="Especialidade" valor={f.especialidadeId} aoMudar={(v) => setF({ ...f, especialidadeId: v })} />
          </Grid.Col>
        </Grid>
        <Group justify="flex-end">
          <Button loading={salvando} onClick={() => void salvar()}>
            Concluir acolhimento
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

const LOCAL_CHAMADA = 'local_chamada';

function TelaFila({ etapa }: { etapa: string }) {
  const triagem = etapa === 'triagem';
  useTituloJanela(triagem ? 'Fila de acolhimento' : 'Fila de atendimento');
  const { eu, pode } = useAuth();
  const { abrir } = useJanelas();
  const [filaId, setFilaId] = useState<number | null>(null);
  const [filtro, setFiltro] = useState(triagem ? 'nao_triados' : 'aguardando');
  const [ordem, setOrdem] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [meus, setMeus] = useState(!triagem);
  const [dados, setDados] = useState<{ ordem: string; ordemFixa: boolean; linhas: any[] }>({ ordem: 'risco', ordemFixa: false, linhas: [] });
  const [triando, setTriando] = useState<any>(null);
  const [local, setLocal] = useState(() => localStorage.getItem(LOCAL_CHAMADA) ?? '');

  const carregar = () =>
    api
      .get('/api/atendimentos/fila', { filaId, filtro, ordem, nome, meus })
      .then(setDados)
      .catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [filaId, filtro, ordem, nome, meus, eu?.unidadeAtual]);
  useIntervalo(carregar, 20_000);

  async function chamar(l: any) {
    let destino = local;
    if (!destino) {
      const r = await pedirTexto('Chamar paciente', 'Local de atendimento exibido no painel (ex.: Consultório 2)');
      if (!r) return;
      destino = r;
      setLocal(r);
      localStorage.setItem(LOCAL_CHAMADA, r);
    }
    try {
      await api.post(`/api/atendimentos/${l.id}/chamar`, { local: destino, tipo: triagem ? 'TRIAGEM' : 'CONSULTORIO', corFaixa: l.classificacao_risco ?? undefined });
      notificarOk(`${l.nome_social ?? l.nome} chamado(a) para ${destino}.`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }

  async function iniciar(l: any) {
    try {
      await api.post(`/api/atendimentos/${l.id}/iniciar`);
      abrir(`/t/atendimento/${l.id}`, `Atendimento ${l.senha}`);
    } catch (e) {
      notificarErro(e);
    }
  }

  async function naoAtendido(l: any) {
    const motivo = await pedirTexto('Paciente não atendido', 'Motivo (desistência, evasão, ausência na chamada...)');
    if (!motivo) return;
    try {
      await api.post(`/api/atendimentos/${l.id}/nao-atendido`, { motivo, evasao: /evas/i.test(motivo) });
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }

  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>{triagem ? 'Fila de acolhimento e classificação de risco' : 'Fila de atendimento'}</Title>
        <TextInput
          size="xs"
          w={240}
          label="Meu local de chamada"
          value={local}
          onChange={(e) => (setLocal(e.currentTarget.value), localStorage.setItem(LOCAL_CHAMADA, e.currentTarget.value))}
          placeholder="Ex.: Consultório 3"
        />
      </Group>
      <Paper withBorder p="sm">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="fila" rotulo="Fila" valor={filaId} aoMudar={setFilaId} filtro={eu?.unidadeAtual ? { unidade_id: eu.unidadeAtual } : undefined} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <TextInput label="Nome do paciente" value={nome} onChange={(e) => setNome(e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <Tooltip label="Ordenação definida pela fila (não pode ser alterada)" disabled={!dados.ordemFixa}>
              <Select
                label="Ordenar por"
                disabled={dados.ordemFixa}
                value={ordem ?? dados.ordem}
                onChange={setOrdem}
                data={[
                  { value: 'risco', label: 'Classificação de risco' },
                  { value: 'data', label: 'Data/hora de chegada' },
                  { value: 'hora', label: 'Horário agendado' },
                  { value: 'idade', label: 'Idade' },
                ]}
              />
            </Tooltip>
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <Switch label="Somente os meus pacientes" checked={meus} onChange={(e) => setMeus(e.currentTarget.checked)} />
          </Grid.Col>
        </Grid>
        <ScrollArea mt="xs" type="auto">
          <SegmentedControl size="xs" value={filtro} onChange={setFiltro} data={FILTROS.map(([value, label]) => ({ value, label }))} />
        </ScrollArea>
      </Paper>
      <Text size="xs" c="dimmed">
        {dados.linhas.length} paciente(s) · atualização automática a cada 20 segundos · <Badge component="span" size="xs" color="pink">destaque</Badge> menores de 2 e maiores de 60 anos
      </Text>
      <Paper withBorder>
        <ScrollArea>
          <Table fz="sm" highlightOnHover verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Senha</Table.Th>
                <Table.Th>Risco</Table.Th>
                <Table.Th>Paciente</Table.Th>
                <Table.Th>Idade</Table.Th>
                <Table.Th>Chegada</Table.Th>
                <Table.Th>Espera</Table.Th>
                <Table.Th>Fila / profissional</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {dados.linhas.map((l) => {
                const risco = l.classificacao_risco ?? l.pre_classificacao;
                return (
                  <Table.Tr key={l.id} style={{ borderLeft: `6px solid var(--mantine-color-${COR_RISCO[risco] ?? 'gray'}-6)`, background: l.destaque ? 'var(--mantine-color-pink-light)' : undefined }}>
                    <Table.Td fw={700}>{l.senha}</Table.Td>
                    <Table.Td>
                      {risco ? (
                        <Badge color={COR_RISCO[risco]} size="sm">
                          {risco}
                        </Badge>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={500}>
                        {l.nome_social ? `${l.nome_social} (${l.nome})` : l.nome}
                      </Text>
                      <Group gap={4}>
                        {l.destaque && (
                          <Badge size="xs" color="pink">
                            {l.idade < 2 ? 'menor de 2 anos' : 'idoso'}
                          </Badge>
                        )}
                        {l.gestante && (
                          <Badge size="xs" color="pink" variant="outline">
                            gestante
                          </Badge>
                        )}
                        {l.queixa && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {l.queixa}
                          </Text>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{l.idade}</Table.Td>
                    <Table.Td>
                      {dayjs(l.entrada_em).format('HH:mm')}
                      {l.hora_agendada && (
                        <Text size="xs" c="dimmed">
                          agend. {l.hora_agendada.slice(0, 5)}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td c={l.espera_min > 60 ? 'red' : undefined}>{l.espera_min} min</Table.Td>
                    <Table.Td>
                      <Text size="xs">{l.fila}</Text>
                      <Text size="xs" c="dimmed">
                        {l.profissional ?? l.especialidade}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Situacao valor={l.situacao} />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Tooltip label="Chamar no painel">
                          <Button size="compact-xs" variant="light" onClick={() => void chamar(l)}>
                            <IconSpeakerphone size={14} />
                          </Button>
                        </Tooltip>
                        {pode('triagem:executar', 'AMB') && !['FINALIZADO', 'NAO_ATENDIDO', 'EVADIDO'].includes(l.situacao) && (
                          <Button size="compact-xs" variant={triagem ? 'filled' : 'light'} color="yellow" leftSection={<IconStethoscope size={12} />} onClick={() => setTriando(l)}>
                            Triagem
                          </Button>
                        )}
                        {!triagem && pode('atendimento_clinico:executar', 'PEP') && l.situacao !== 'AGUARDANDO_TRIAGEM' && !['NAO_ATENDIDO', 'EVADIDO'].includes(l.situacao) && (
                          <Button size="compact-xs" leftSection={<IconPlayerPlay size={12} />} onClick={() => void iniciar(l)}>
                            {l.situacao === 'FINALIZADO' ? 'Abrir' : 'Atender'}
                          </Button>
                        )}
                        {!['FINALIZADO', 'NAO_ATENDIDO', 'EVADIDO'].includes(l.situacao) && (
                          <Tooltip label="Não atendido / evasão">
                            <Button size="compact-xs" variant="subtle" color="red" onClick={() => void naoAtendido(l)}>
                              <IconUserX size={14} />
                            </Button>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      {triando && <ModalTriagem linha={triando} aoFechar={(ok) => (setTriando(null), ok && void carregar())} />}
    </Stack>
  );
}

registrarTela({
  id: 'fila-triagem',
  titulo: 'Acolhimento / triagem',
  menu: 'Atendimento',
  padrao: '/t/fila/triagem',
  permissao: 'triagem:executar',
  modulo: 'AMB',
  palavras: ['classificação de risco', 'manchester', 'sinais vitais', 'pré-consulta'],
  ordem: 2,
  render: () => <TelaFila etapa="triagem" />,
});
registrarTela({
  id: 'fila-atendimento',
  titulo: 'Fila de atendimento',
  menu: 'Atendimento',
  padrao: '/t/fila/atendimento',
  permissao: 'atendimento_clinico:executar',
  modulo: 'PEP',
  palavras: ['consulta', 'chamar paciente', 'painel'],
  ordem: 3,
  render: () => <TelaFila etapa="atendimento" />,
});
