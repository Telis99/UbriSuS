// Recepção / acolhimento na chegada (TR 1.2.15, 1.2.42.1): localiza o paciente, confirma o agendamento
// do dia ou registra demanda espontânea, gera a senha e encaminha à fila; visão de todas as filas.
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Grid, Group, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconPrinter, IconTicket, IconUsers } from '@tabler/icons-react';
import { api } from '@/api';
import { useAuth } from '@/auth/Auth';
import { useTituloJanela } from '@/shell/Janelas';
import { AtualizacaoRapida, BuscaPaciente, CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { abrirPdf, notificarErro, notificarOk, RISCOS, SelecaoRef, Situacao, useIntervalo } from '@/componentes/comum';
import { registrarTela } from './registro';

export function VisaoFilas({ aoSelecionar }: { aoSelecionar?: (filaId: number) => void }) {
  const [filas, setFilas] = useState<any[]>([]);
  const carregar = () => api.get('/api/filas/visao').then(setFilas).catch(() => {});
  useEffect(() => void carregar(), []);
  useIntervalo(carregar, 15_000);
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
      {filas.map((f) => (
        <Card key={f.id} withBorder padding="xs" style={{ cursor: aoSelecionar ? 'pointer' : undefined }} onClick={() => aoSelecionar?.(f.id)}>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={600}>
              {f.nome}
            </Text>
            <Badge size="xs" variant="outline">
              {f.prefixo_senha}
            </Badge>
          </Group>
          <Group gap={6}>
            <Badge size="sm" variant="light" color="blue">{f.aguardando} aguardando</Badge>
            {f.aguardando_triagem > 0 && <Badge size="sm" variant="light" color="yellow">{f.aguardando_triagem} p/ triagem</Badge>}
            <Badge size="sm" variant="light" color="teal">{f.em_atendimento} em atendimento</Badge>
            {f.em_observacao > 0 && <Badge size="sm" variant="light" color="grape">{f.em_observacao} observação</Badge>}
            <Badge size="sm" color="green" variant="light">
              {f.atendidos} atendidos
            </Badge>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            Espera média: {f.espera_media_min ?? 0} min
          </Text>
        </Card>
      ))}
    </SimpleGrid>
  );
}

function TelaRecepcao() {
  useTituloJanela('Recepção');
  const { eu } = useAuth();
  const [pacienteId, setPacienteId] = useState<number | null>(null);
  const { paciente, recarregar } = usePaciente(pacienteId, 'recepcao');
  const [agendados, setAgendados] = useState<any[]>([]);
  const [f, setF] = useState<Record<string, any>>({});
  const [gerado, setGerado] = useState<any>(null);
  const hoje = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    setF({});
    if (!pacienteId) return setAgendados([]);
    api
      .get(`/api/agendamento/paciente/${pacienteId}`)
      .then((r) => setAgendados(r.ultimos.filter((a: any) => a.data === hoje && ['AGENDADO', 'CONFIRMADO'].includes(a.situacao))))
      .catch(() => setAgendados([]));
  }, [pacienteId, hoje]);

  async function registrar(agendamentoId?: number) {
    if (!pacienteId) return;
    try {
      const r = await api.post('/api/recepcao', {
        pacienteId,
        filaId: f.filaId,
        agendamentoId,
        profissionalId: f.profissionalId ?? undefined,
        especialidadeId: f.especialidadeId ?? undefined,
        salaId: f.salaId ?? undefined,
        motivo: f.motivo || undefined,
        queixa: f.queixa || undefined,
        preClassificacao: f.preClassificacao ?? undefined,
      });
      setGerado({ ...r, paciente: paciente?.nome });
      notificarOk(`Senha ${r.senha} gerada.`);
      setPacienteId(null);
    } catch (e) {
      notificarErro(e);
    }
  }

  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Recepção e acolhimento</Title>
      {!eu?.unidadeAtual && <Alert color="yellow">Selecione a unidade de trabalho no topo da tela.</Alert>}
      <Grid gutter="sm">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Stack gap="sm">
            {gerado && (
              <Alert color="teal" icon={<IconTicket />} withCloseButton onClose={() => setGerado(null)}>
                <Group justify="space-between">
                  <div>
                    <Text size="xl" fw={800}>
                      Senha {gerado.senha}
                    </Text>
                    <Text size="sm">
                      {gerado.paciente} — <Situacao valor={gerado.situacao} />
                    </Text>
                  </div>
                  <Button size="xs" variant="light" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/documentos/faa?atendimentoId=${gerado.id}`)}>
                    Imprimir FAA / ficha
                  </Button>
                </Group>
              </Alert>
            )}
            {!pacienteId ? (
              <Paper withBorder p="sm">
                <BuscaPaciente aoSelecionar={setPacienteId} />
              </Paper>
            ) : (
              paciente && (
                <Stack gap="xs">
                  <CabecalhoPaciente paciente={paciente} aoAtualizar={recarregar} />
                  <Group justify="space-between" align="flex-end">
                    <AtualizacaoRapida paciente={paciente} aoSalvar={recarregar} />
                    <Button size="xs" variant="subtle" onClick={() => setPacienteId(null)}>
                      Trocar paciente
                    </Button>
                  </Group>
                  {agendados.length > 0 && (
                    <Paper withBorder p="xs">
                      <Text size="sm" fw={600} mb={4}>
                        Agendamentos de hoje
                      </Text>
                      {agendados.map((a) => (
                        <Group key={a.id} justify="space-between" py={2}>
                          <Text size="sm">
                            {a.hora} · {a.especialidade ?? a.tipo} · {a.profissional} <Situacao valor={a.situacao} />
                          </Text>
                          <Button size="compact-xs" disabled={!f.filaId} onClick={() => void registrar(a.id)}>
                            Confirmar chegada
                          </Button>
                        </Group>
                      ))}
                    </Paper>
                  )}
                  <Paper withBorder p="sm">
                    <Text size="sm" fw={600} mb={4}>
                      Encaminhamento à fila
                    </Text>
                    <Grid gutter="xs">
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <SelecaoRef entidade="fila" rotulo="Fila de atendimento" obrigatorio valor={f.filaId} aoMudar={(v) => setF({ ...f, filaId: v })} filtro={eu?.unidadeAtual ? { unidade_id: eu.unidadeAtual } : undefined} />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <SelecaoRef entidade="sala" rotulo="Sala / consultório" valor={f.salaId} aoMudar={(v) => setF({ ...f, salaId: v })} filtro={eu?.unidadeAtual ? { unidade_id: eu.unidadeAtual } : undefined} />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <SelecaoRef entidade="profissional" rotulo="Profissional (opcional)" valor={f.profissionalId} aoMudar={(v) => setF({ ...f, profissionalId: v })} />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <SelecaoRef entidade="especialidade" rotulo="Especialidade (opcional)" valor={f.especialidadeId} aoMudar={(v) => setF({ ...f, especialidadeId: v })} />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <TextInput label="Motivo da procura" value={f.motivo ?? ''} onChange={(e) => setF({ ...f, motivo: e.currentTarget.value })} />
                      </Grid.Col>
                      <Grid.Col span={{ base: 12, sm: 6 }}>
                        <Select
                          label="Pré-classificação (urgência)"
                          clearable
                          value={f.preClassificacao ?? null}
                          onChange={(v) => setF({ ...f, preClassificacao: v })}
                          data={RISCOS.map(([value, label]) => ({ value, label: `${value} — ${label}` }))}
                        />
                      </Grid.Col>
                      <Grid.Col span={12}>
                        <Textarea label="Queixa / observação" value={f.queixa ?? ''} onChange={(e) => setF({ ...f, queixa: e.currentTarget.value })} autosize minRows={2} />
                      </Grid.Col>
                    </Grid>
                    <Group justify="flex-end" mt="xs">
                      <Button leftSection={<IconTicket size={16} />} disabled={!f.filaId} onClick={() => void registrar()}>
                        Gerar senha (demanda espontânea)
                      </Button>
                    </Group>
                  </Paper>
                </Stack>
              )
            )}
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Group gap={6} mb={6}>
            <IconUsers size={18} />
            <Text fw={600} size="sm">
              Filas da unidade (tempo real)
            </Text>
          </Group>
          <VisaoFilas />
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

registrarTela({
  id: 'recepcao',
  titulo: 'Recepção',
  menu: 'Atendimento',
  padrao: '/t/recepcao',
  permissao: 'recepcao:executar',
  modulo: 'AMB',
  palavras: ['chegada', 'senha', 'acolhimento', 'demanda espontânea', 'FAA'],
  ordem: 1,
  render: () => <TelaRecepcao />,
});
