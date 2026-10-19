// Imunização (TR 1.2.39): carteira de vacinação por cores com registro por clique (aplicação, resgate,
// aprazamento, indicação), frascos multidose, campanhas, busca ativa e exportação ao SI-PNI.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Grid, Group, Modal, Paper, Progress, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconDownload, IconPrinter, IconSearch, IconVaccine } from '@tabler/icons-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useAuth } from '@/auth/Auth';
import { registrarExtensaoFormulario } from '@/genericos/Formulario';
import { confirmar } from '@/genericos/dialogos';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { BuscaPaciente, CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { abrirPdf, comConfirmacao, fmtData, notificarErro, notificarOk, SelecaoRef, TabelaSimples } from '@/componentes/comum';
import { registrarMenuRelatorios } from './Relatorios';
import { registrarTela } from './registro';

const CORES: Record<string, { fundo: string; borda: string }> = {
  AZUL: { fundo: 'var(--mantine-color-blue-1)', borda: 'var(--mantine-color-blue-6)' },
  VERDE: { fundo: 'var(--mantine-color-green-1)', borda: 'var(--mantine-color-green-6)' },
  VERMELHO: { fundo: 'var(--mantine-color-red-1)', borda: 'var(--mantine-color-red-6)' },
  CINZA: { fundo: 'var(--mantine-color-gray-1)', borda: 'var(--mantine-color-gray-4)' },
};
const FAIXAS: [string, string][] = [
  ['CRIANCA', 'Criança'],
  ['ADOLESCENTE', 'Adolescente'],
  ['ADULTO', 'Adulto'],
  ['IDOSO', 'Idoso'],
  ['GESTANTE', 'Gestante'],
];
const ESTRATEGIAS = [
  { value: 'ROTINA', label: 'Rotina' },
  { value: 'ESPECIAL', label: 'Especial' },
  { value: 'BLOQUEIO', label: 'Bloqueio' },
  { value: 'INTENSIFICACAO', label: 'Intensificação' },
  { value: 'CAMPANHA', label: 'Campanha' },
];
const LOCAIS = [
  { value: 'DELTOIDE_D', label: 'Deltoide direito' },
  { value: 'DELTOIDE_E', label: 'Deltoide esquerdo' },
  { value: 'VASTO_LATERAL_D', label: 'Vasto lateral coxa direita' },
  { value: 'VASTO_LATERAL_E', label: 'Vasto lateral coxa esquerda' },
  { value: 'GLUTEO', label: 'Glúteo' },
  { value: 'ORAL', label: 'Oral' },
  { value: 'OUTRO', label: 'Outro' },
];

interface ItemCarteira {
  imunobiologicoId: number;
  imunobiologico: string;
  sigla: string;
  doseId: number;
  dose: string;
  faixa: string;
  previstoPara: string;
  situacao: string;
  cor: string;
  registro: any;
}

type Acao = 'APLICACAO' | 'RESGATE' | 'APRAZAMENTO' | 'INDICACAO';

function ModalRegistro({ pacienteId, idadeDias, alvo, aoFechar }: { pacienteId: number; idadeDias: number; alvo: { imunobiologicoId: number; doseId: number | null; nome: string; tipo: Acao }; aoFechar: (ok: boolean) => void }) {
  const { eu } = useAuth();
  const [f, setF] = useState<Record<string, any>>({ estrategia: 'ROTINA', data: dayjs().format('YYYY-MM-DD') });
  const [lotes, setLotes] = useState<{ lotes: any[]; diluentes: any[] }>({ lotes: [], diluentes: [] });
  const [campanhas, setCampanhas] = useState<any[]>([]);
  const aplicacao = alvo.tipo === 'APLICACAO';
  useEffect(() => {
    if (!aplicacao) return;
    api
      .get('/api/imunizacao/lotes', { imunobiologicoId: alvo.imunobiologicoId, unidadeId: eu?.unidadeAtual })
      .then((r) => (setLotes(r), r.lotes[0] && setF((x) => ({ ...x, loteId: r.lotes[0].id })), r.diluentes[0] && setF((x) => ({ ...x, diluenteLoteId: r.diluentes[0].id }))))
      .catch(notificarErro);
    api.get('/api/imunizacao/campanhas-vigentes', { imunobiologicoId: alvo.imunobiologicoId, idadeDias }).then(setCampanhas).catch(() => {});
  }, [aplicacao, alvo.imunobiologicoId, eu?.unidadeAtual, idadeDias]);
  const lote = lotes.lotes.find((l) => l.id === f.loteId);
  async function salvar() {
    try {
      const r = await comConfirmacao(
        (ok) =>
          api.post('/api/imunizacao/vacinacoes', {
            pacienteId,
            imunobiologicoId: alvo.imunobiologicoId,
            doseId: alvo.doseId,
            tipo: alvo.tipo,
            data: f.data,
            loteId: aplicacao ? f.loteId : null,
            loteTexto: f.loteTexto || null,
            profissionalTexto: f.profissionalTexto || null,
            estrategia: f.estrategia,
            campanhaId: f.campanhaId ?? null,
            grupoId: f.grupoId ?? null,
            localAplicacao: f.localAplicacao ?? null,
            diluenteLoteId: f.diluenteLoteId ?? null,
            novoFrasco: !!f.novoFrasco,
            observacao: f.observacao || null,
            confirmarAvisos: ok,
          }),
        'Aplicação não recomendada',
      );
      if (!r) return;
      if (r.inadvertida) notificarOk('Registrada como aplicação inadvertida (será informada ao SI-PNI).');
      else notificarOk(`${alvo.nome}: registro concluído${r.data_aprazada ? `; próxima dose aprazada para ${fmtData(r.data_aprazada)}` : ''}.`);
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  const titulos: Record<Acao, string> = { APLICACAO: 'Aplicação', RESGATE: 'Resgate (vacina anterior)', APRAZAMENTO: 'Aprazamento', INDICACAO: 'Indicação' };
  return (
    <Modal opened onClose={() => aoFechar(false)} title={`${titulos[alvo.tipo]} — ${alvo.nome}`} size="lg">
      <Stack gap="xs">
        <DateInput label={alvo.tipo === 'APRAZAMENTO' ? 'Data aprazada' : 'Data'} valueFormat="DD/MM/YYYY" value={f.data ? new Date(f.data + 'T12:00') : null} onChange={(d) => setF({ ...f, data: d ? dayjs(d).format('YYYY-MM-DD') : null })} maxDate={alvo.tipo === 'APRAZAMENTO' ? undefined : new Date()} />
        {aplicacao && (
          <>
            <Select
              label="Lote"
              required
              data={lotes.lotes.map((l) => ({ value: String(l.id), label: `${l.lote} · val. ${fmtData(l.validade)} · ${l.fabricante ?? ''} · ${Number(l.quantidade)} frasco(s)` }))}
              value={f.loteId ? String(f.loteId) : null}
              onChange={(v) => setF({ ...f, loteId: v ? Number(v) : null })}
              nothingFoundMessage="Sem estoque na unidade"
            />
            {lote && Number(lote.doses_frasco) > 1 && (
              <Paper withBorder p="xs">
                {lote.frasco ? (
                  <>
                    <Text size="xs">
                      Frasco aberto em {dayjs(lote.frasco.aberto_em).format('DD/MM HH:mm')}: {lote.frasco.doses_usadas} de {lote.frasco.doses_total} doses usadas
                    </Text>
                    <Progress value={(lote.frasco.doses_usadas / lote.frasco.doses_total) * 100} color="orange" size="lg" my={4} />
                    <Checkbox size="xs" label="Abrir um novo frasco (o frasco atual permanece com as doses restantes)" checked={!!f.novoFrasco} onChange={(e) => setF({ ...f, novoFrasco: e.currentTarget.checked })} />
                  </>
                ) : (
                  <Text size="xs">Nenhum frasco aberto deste lote: um novo frasco de {lote.doses_frasco} doses será aberto automaticamente.</Text>
                )}
              </Paper>
            )}
            {lotes.diluentes.length > 0 && (
              <Select label="Diluente (lote)" required data={lotes.diluentes.map((d) => ({ value: String(d.id), label: `${d.rotulo} · val. ${fmtData(d.validade)}` }))} value={f.diluenteLoteId ? String(f.diluenteLoteId) : null} onChange={(v) => setF({ ...f, diluenteLoteId: v ? Number(v) : null })} />
            )}
            <Grid gutter="xs">
              <Grid.Col span={6}>
                <Select label="Estratégia" data={ESTRATEGIAS} value={f.estrategia} onChange={(v) => setF({ ...f, estrategia: v ?? 'ROTINA', campanhaId: null, grupoId: null })} />
              </Grid.Col>
              <Grid.Col span={6}>
                <Select label="Local de aplicação" data={LOCAIS} value={f.localAplicacao ?? null} onChange={(v) => setF({ ...f, localAplicacao: v })} clearable />
              </Grid.Col>
            </Grid>
            {f.estrategia === 'CAMPANHA' && (
              <Select
                label="Campanha / grupo de vacinação"
                required
                data={campanhas.map((c) => ({ value: `${c.id}:${c.grupo_id}`, label: `${c.nome} — ${c.grupo}` }))}
                value={f.campanhaId ? `${f.campanhaId}:${f.grupoId}` : null}
                onChange={(v) => {
                  const [c, g] = (v ?? ':').split(':');
                  setF({ ...f, campanhaId: c ? Number(c) : null, grupoId: g ? Number(g) : null });
                }}
                nothingFoundMessage="Nenhuma campanha vigente para este imunobiológico e idade"
              />
            )}
          </>
        )}
        {alvo.tipo === 'RESGATE' && (
          <Group grow>
            <TextInput label="Lote" required value={f.loteTexto ?? ''} onChange={(e) => setF({ ...f, loteTexto: e.currentTarget.value })} />
            <TextInput label="Local / profissional" value={f.profissionalTexto ?? ''} onChange={(e) => setF({ ...f, profissionalTexto: e.currentTarget.value })} />
          </Group>
        )}
        <TextInput label="Observação" value={f.observacao ?? ''} onChange={(e) => setF({ ...f, observacao: e.currentTarget.value })} />
        <Group justify="flex-end">
          <Button leftSection={<IconVaccine size={16} />} onClick={() => void salvar()}>
            Registrar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function CelulaDose({ i, aoClicar }: { i: ItemCarteira; aoClicar: () => void }) {
  const cor = CORES[i.cor] ?? CORES.CINZA;
  const r = i.registro;
  return (
    <Tooltip label={`${i.imunobiologico} — ${i.situacao.replace('_', ' ').toLowerCase()}${r?.inadvertida ? ' (inadvertida)' : ''}`}>
      <Paper p={4} withBorder style={{ background: cor.fundo, borderColor: cor.borda, cursor: 'pointer', minHeight: 54 }} onClick={aoClicar}>
        <Text size="xs" fw={700} ta="center">
          {i.dose}
        </Text>
        <Text size="10px" ta="center" lh={1.2}>
          {r && (r.tipo === 'APLICACAO' || r.tipo === 'RESGATE') ? (
            <>
              {fmtData(r.data)}
              <br />
              {r.lote ? `Lote ${r.lote}` : ''}
              {r.tipo === 'RESGATE' ? ' (resg.)' : ''}
            </>
          ) : r?.tipo === 'APRAZAMENTO' ? (
            `Aprazada ${fmtData(r.data)}`
          ) : r?.tipo === 'INDICACAO' ? (
            'Indicada'
          ) : (
            `Prevista ${fmtData(i.previstoPara)}`
          )}
        </Text>
      </Paper>
    </Tooltip>
  );
}

function TelaVacinacao({ query }: { query: URLSearchParams }) {
  useTituloJanela('Vacinação');
  const [pacienteId, setPacienteId] = useState<number | null>(query.get('paciente') ? Number(query.get('paciente')) : null);
  const { paciente, recarregar } = usePaciente(pacienteId, 'vacinacao');
  const [dados, setDados] = useState<any>(null);
  const [faixa, setFaixa] = useState('CRIANCA');
  const [acoes, setAcoes] = useState<ItemCarteira | null>(null);
  const [registro, setRegistro] = useState<{ imunobiologicoId: number; doseId: number | null; nome: string; tipo: Acao } | null>(null);
  const [avulsa, setAvulsa] = useState<{ imunobiologicoId?: number | null; doseId?: number | null; nome?: string }>({});
  const carregar = async () => {
    if (!pacienteId) return setDados(null);
    try {
      const d = await api.get(`/api/imunizacao/carteira/${pacienteId}`);
      setDados(d);
      const anos = d.paciente.idadeDias / 365.25;
      setFaixa(anos < 10 ? 'CRIANCA' : anos < 20 ? 'ADOLESCENTE' : anos < 60 ? 'ADULTO' : 'IDOSO');
    } catch (e) {
      notificarErro(e);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [pacienteId]);

  const porVacina = useMemo(() => {
    const m = new Map<string, ItemCarteira[]>();
    for (const i of (dados?.itens ?? []) as ItemCarteira[]) if (i.faixa === faixa) m.set(i.sigla, [...(m.get(i.sigla) ?? []), i]);
    return [...m.entries()];
  }, [dados, faixa]);

  async function excluir(i: ItemCarteira) {
    if (!(await confirmar('Excluir registro', `Excluir ${i.registro.tipo.toLowerCase()} de ${i.sigla} ${i.dose}? A dose aplicada retorna ao frasco/estoque.`, 'Excluir', true))) return;
    try {
      await api.delete(`/api/imunizacao/vacinacoes/${i.registro.id}`);
      notificarOk('Registro excluído.');
      setAcoes(null);
      void carregar();
      void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }

  const pendentes = (dados?.itens ?? []).filter((i: ItemCarteira) => ['ATRASADA', 'NO_PRAZO', 'APRAZADA', 'INDICADA'].includes(i.situacao));
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Carteira de vacinação</Title>
        {pacienteId && (
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/imunizacao/carteira/${pacienteId}/impressao`)}>
              Imprimir carteira
            </Button>
            <Button size="xs" variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/imunizacao/carteira/${pacienteId}/impressao?historico=true`)}>
              Histórico de vacinação
            </Button>
          </Group>
        )}
      </Group>
      {!pacienteId ? (
        <Paper withBorder p="sm">
          <BuscaPaciente aoSelecionar={setPacienteId} />
        </Paper>
      ) : (
        <>
          {paciente && <CabecalhoPaciente paciente={paciente} compacto aoAtualizar={recarregar} />}
          <Group>
            <Button size="compact-xs" variant="subtle" onClick={() => setPacienteId(null)}>
              Trocar paciente
            </Button>
          </Group>
          {dados && (
            <Grid gutter="sm">
              <Grid.Col span={{ base: 12, lg: 9 }}>
                <Paper withBorder p="sm">
                  <Group justify="space-between" mb="xs">
                    <SegmentedControl size="xs" value={faixa} onChange={setFaixa} data={FAIXAS.filter(([v]) => v !== 'GESTANTE' || dados.paciente.sexo === 'F').map(([value, label]) => ({ value, label }))} />
                    <Group gap={4}>
                      <Badge size="xs" color="blue">
                        aplicada/resgatada
                      </Badge>
                      <Badge size="xs" color="green">
                        no prazo
                      </Badge>
                      <Badge size="xs" color="red">
                        em atraso
                      </Badge>
                      <Badge size="xs" color="gray">
                        não indicada ainda / sem efeito
                      </Badge>
                    </Group>
                  </Group>
                  {faixa === 'GESTANTE' && dados.paciente.gestante && (
                    <Alert color="pink" py={4} mb="xs">
                      Paciente gestante em acompanhamento: imunobiológicos recomendados abaixo.
                    </Alert>
                  )}
                  <SimpleGrid cols={{ base: 3, sm: 5, md: 7, xl: 9 }} spacing={6}>
                    {porVacina.map(([sigla, doses]) => (
                      <Stack key={sigla} gap={4}>
                        <Tooltip label={doses[0].imunobiologico}>
                          <Text size="xs" fw={700} ta="center" bg="var(--mantine-color-default-hover)" py={2}>
                            {sigla}
                          </Text>
                        </Tooltip>
                        {doses.map((d) => (
                          <CelulaDose key={`${d.imunobiologicoId}-${d.doseId}`} i={d} aoClicar={() => setAcoes(d)} />
                        ))}
                      </Stack>
                    ))}
                  </SimpleGrid>
                  {!porVacina.length && (
                    <Text size="sm" c="dimmed">
                      Sem imunobiológicos nesta faixa.
                    </Text>
                  )}
                </Paper>
                {dados.outrasAplicacoes.length > 0 && (
                  <Paper withBorder p="sm" mt="sm">
                    <Text size="sm" fw={600} mb={4}>
                      Outras aplicações (campanhas e esquemas especiais)
                    </Text>
                    <TabelaSimples
                      linhas={dados.outrasAplicacoes}
                      colunas={[
                        { titulo: 'Data', valor: (r: any) => fmtData(r.data) },
                        { titulo: 'Imunobiológico', valor: (r: any) => r.imunobiologico },
                        { titulo: 'Dose', valor: (r: any) => r.dose },
                        { titulo: 'Estratégia', valor: (r: any) => r.estrategia },
                        { titulo: 'Lote', valor: (r: any) => r.lote },
                        { titulo: 'Unidade', valor: (r: any) => r.unidade },
                      ]}
                    />
                  </Paper>
                )}
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 3 }}>
                <Paper withBorder p="sm">
                  <Text size="sm" fw={600} mb={4}>
                    Aprazamentos e pendências
                  </Text>
                  <Stack gap={4}>
                    {pendentes.map((i: ItemCarteira) => (
                      <Group key={`${i.imunobiologicoId}-${i.doseId}`} justify="space-between" wrap="nowrap">
                        <Text size="xs" component="div">
                          <Badge size="xs" color={i.cor === 'VERMELHO' ? 'red' : 'green'} mr={4}>
                            {i.situacao.replace('_', ' ')}
                          </Badge>
                          {i.sigla} {i.dose}
                        </Text>
                        <Button size="compact-xs" variant="light" onClick={() => setRegistro({ imunobiologicoId: i.imunobiologicoId, doseId: i.doseId, nome: `${i.sigla} ${i.dose}`, tipo: 'APLICACAO' })}>
                          Aplicar
                        </Button>
                      </Group>
                    ))}
                    {!pendentes.length && (
                      <Text size="xs" c="dimmed">
                        Nenhuma pendência.
                      </Text>
                    )}
                  </Stack>
                </Paper>
                <Paper withBorder p="sm" mt="sm">
                  <Text size="sm" fw={600} mb={4}>
                    Aplicação fora da carteira
                  </Text>
                  <SelecaoRef entidade="imunobiologico" rotulo="Imunobiológico" valor={avulsa.imunobiologicoId} aoMudar={(v, r) => setAvulsa({ ...avulsa, imunobiologicoId: v, nome: r })} />
                  <SelecaoRef entidade="dose" rotulo="Dose" valor={avulsa.doseId} aoMudar={(v) => setAvulsa({ ...avulsa, doseId: v })} />
                  <Button
                    mt="xs"
                    size="xs"
                    fullWidth
                    disabled={!avulsa.imunobiologicoId}
                    onClick={() => setRegistro({ imunobiologicoId: avulsa.imunobiologicoId!, doseId: avulsa.doseId ?? null, nome: avulsa.nome ?? 'Imunobiológico', tipo: 'APLICACAO' })}
                  >
                    Registrar aplicação
                  </Button>
                </Paper>
              </Grid.Col>
            </Grid>
          )}
        </>
      )}
      <Modal opened={!!acoes} onClose={() => setAcoes(null)} title={acoes ? `${acoes.imunobiologico} — ${acoes.dose}` : ''} size="sm">
        {acoes && (
          <Stack gap="xs">
            {acoes.registro ? (
              <>
                <Text size="sm">
                  {acoes.registro.tipo} em {fmtData(acoes.registro.data)} {acoes.registro.lote ? `· lote ${acoes.registro.lote}` : ''} {acoes.registro.unidade ? `· ${acoes.registro.unidade}` : ''}
                </Text>
                {acoes.registro.inadvertida && <Badge color="orange">Aplicação inadvertida</Badge>}
                <Button variant="light" onClick={() => window.open(`/e/vacinacao/${acoes.registro.id}?janela=1`, '_blank', 'popup,width=1000,height=700')}>
                  Alterar registro
                </Button>
                <Button color="red" variant="light" onClick={() => void excluir(acoes)}>
                  Excluir registro
                </Button>
              </>
            ) : (
              (['APLICACAO', 'RESGATE', 'APRAZAMENTO', 'INDICACAO'] as Acao[]).map((t) => (
                <Button key={t} variant={t === 'APLICACAO' ? 'filled' : 'light'} onClick={() => (setRegistro({ imunobiologicoId: acoes.imunobiologicoId, doseId: acoes.doseId, nome: `${acoes.sigla} ${acoes.dose}`, tipo: t }), setAcoes(null))}>
                  {{ APLICACAO: 'Registrar aplicação', RESGATE: 'Registrar resgate', APRAZAMENTO: 'Aprazar', INDICACAO: 'Indicar' }[t]}
                </Button>
              ))
            )}
          </Stack>
        )}
      </Modal>
      {registro && pacienteId && dados && <ModalRegistro pacienteId={pacienteId} idadeDias={dados.paciente.idadeDias} alvo={registro} aoFechar={(ok) => (setRegistro(null), ok && (void carregar(), void recarregar()))} />}
    </Stack>
  );
}

function TelaBuscaAtiva() {
  useTituloJanela('Busca ativa de vacinas');
  const { eu } = useAuth();
  const { abrir } = useJanelas();
  const [f, setF] = useState<Record<string, any>>({ unidadeId: eu?.unidadeAtual ?? null });
  const [linhas, setLinhas] = useState<any[] | null>(null);
  const [marcados, setMarcados] = useState<number[]>([]);
  const buscar = () => api.get('/api/imunizacao/pendentes', f).then((r) => (setLinhas(r), setMarcados([]))).catch(notificarErro);
  const pacientes = useMemo(() => [...new Set((linhas ?? []).map((l) => l.paciente_id))], [linhas]);
  async function convocar() {
    try {
      for (const id of marcados) {
        const vacinas = (linhas ?? []).filter((l) => l.paciente_id === id).map((l) => `${l.sigla} ${l.dose}`);
        await api.post('/api/e/paciente_aviso', { pessoa_id: id, texto: `Busca ativa: vacinas pendentes ${vacinas.join(', ')}. Orientar comparecimento à sala de vacina.`, ativo: true });
      }
      notificarOk(`${marcados.length} paciente(s) com aviso de convocação registrado.`);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Busca ativa: doses pendentes segundo o quadro de cobertura</Title>
      <Paper withBorder p="sm">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade de referência" valor={f.unidadeId} aoMudar={(v) => setF({ ...f, unidadeId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="bairro" rotulo="Bairro" valor={f.bairroId} aoMudar={(v) => setF({ ...f, bairroId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="imunobiologico" rotulo="Imunobiológico" valor={f.imunobiologicoId} aoMudar={(v) => setF({ ...f, imunobiologicoId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="dose" rotulo="Dose" valor={f.doseId} aoMudar={(v) => setF({ ...f, doseId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <TextInput label="Paciente" value={f.nome ?? ''} onChange={(e) => setF({ ...f, nome: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <TextInput label="Nome da mãe" value={f.mae ?? ''} onChange={(e) => setF({ ...f, mae: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <DateInput label="Nascimento" valueFormat="DD/MM/YYYY" clearable value={f.nascimento ? new Date(f.nascimento + 'T12:00') : null} onChange={(d) => setF({ ...f, nascimento: d ? dayjs(d).format('YYYY-MM-DD') : undefined })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Select label="Estratégia" clearable data={ESTRATEGIAS} value={f.estrategia ?? null} onChange={(v) => setF({ ...f, estrategia: v ?? undefined })} />
          </Grid.Col>
        </Grid>
        <Group mt="sm" justify="space-between">
          <Button leftSection={<IconSearch size={16} />} onClick={() => void buscar()}>
            Pesquisar
          </Button>
          {linhas && (
            <Button variant="light" disabled={!marcados.length} onClick={() => void convocar()}>
              Registrar aviso de convocação ({marcados.length})
            </Button>
          )}
        </Group>
      </Paper>
      {linhas && (
        <>
          <Text size="xs" c="dimmed">
            {linhas.length} dose(s) pendente(s) em {pacientes.length} paciente(s)
          </Text>
          <Paper withBorder>
            <ScrollArea h="calc(100vh - 420px)">
              <Table fz="xs" striped stickyHeader highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={30}>
                      <Checkbox size="xs" checked={!!pacientes.length && marcados.length === pacientes.length} onChange={(e) => setMarcados(e.currentTarget.checked ? pacientes : [])} />
                    </Table.Th>
                    <Table.Th>Paciente</Table.Th>
                    <Table.Th>Mãe</Table.Th>
                    <Table.Th>Nascimento</Table.Th>
                    <Table.Th>Bairro</Table.Th>
                    <Table.Th>Telefone</Table.Th>
                    <Table.Th>Imunobiológico</Table.Th>
                    <Table.Th>Dose</Table.Th>
                    <Table.Th>Prevista</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {linhas.map((l, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>
                        <Checkbox size="xs" checked={marcados.includes(l.paciente_id)} onChange={(e) => setMarcados(e.currentTarget.checked ? [...new Set([...marcados, l.paciente_id])] : marcados.filter((x) => x !== l.paciente_id))} />
                      </Table.Td>
                      <Table.Td fw={500}>{l.nome}</Table.Td>
                      <Table.Td>{l.nome_mae}</Table.Td>
                      <Table.Td>{fmtData(l.nascimento)}</Table.Td>
                      <Table.Td>{l.bairro}</Table.Td>
                      <Table.Td>{l.celular}</Table.Td>
                      <Table.Td>{l.sigla}</Table.Td>
                      <Table.Td>{l.dose}</Table.Td>
                      <Table.Td>{fmtData(l.previsto)}</Table.Td>
                      <Table.Td>
                        <Button size="compact-xs" variant="subtle" onClick={() => abrir(`/t/vacinacao?paciente=${l.paciente_id}`, 'Vacinação')}>
                          Carteira
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
        </>
      )}
    </Stack>
  );
}

function TelaPainelCampanha({ query }: { query: URLSearchParams }) {
  useTituloJanela('Painel da campanha');
  const [campanhaId, setCampanhaId] = useState<number | null>(query.get('id') ? Number(query.get('id')) : null);
  const [dados, setDados] = useState<any>(null);
  useEffect(() => {
    if (!campanhaId) return;
    const carregar = () => api.get(`/api/imunizacao/campanhas/${campanhaId}/painel`).then(setDados).catch(notificarErro);
    void carregar();
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, [campanhaId]);
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Acompanhamento da campanha em tempo real</Title>
      <SelecaoRef entidade="campanha_vacinacao" rotulo="Campanha" valor={campanhaId} aoMudar={setCampanhaId} />
      {dados && (
        <>
          <Text size="sm">
            {dados.campanha.nome} · {fmtData(dados.campanha.inicio)} a {fmtData(dados.campanha.fim)}
          </Text>
          <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }}>
            {dados.grupos.map((g: any) => (
              <Paper key={g.id} withBorder p="sm">
                <Text size="sm" fw={600}>
                  {g.nome}
                </Text>
                <Text size="xs" c="dimmed">
                  {g.imunobiologico} {g.dose} · meta {g.meta} doses ({g.meta_percentual}% de {g.populacao_alvo})
                </Text>
                <Progress value={Math.min(100, g.percentual ?? 0)} size="xl" mt="xs" color={(g.percentual ?? 0) >= 90 ? 'teal' : (g.percentual ?? 0) >= 50 ? 'yellow' : 'red'} />
                <Text size="sm" mt={4}>
                  <b>{g.aplicadas}</b> aplicadas · <b>{g.percentual ?? 0}%</b> da meta
                </Text>
              </Paper>
            ))}
          </SimpleGrid>
          <Grid>
            <Grid.Col span={{ base: 12, md: 8 }}>
              <Paper withBorder p="sm">
                <Text size="sm" fw={600}>
                  Aplicações por dia
                </Text>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={dados.diario.map((d: any) => ({ ...d, dia: dayjs(d.dia).format('DD/MM') }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="dia" fontSize={10} />
                      <YAxis fontSize={10} allowDecimals={false} />
                      <RTooltip />
                      <Legend />
                      <Bar dataKey="aplicadas" name="Aplicadas" fill="#1c7ed6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Paper withBorder p="sm">
                <Text size="sm" fw={600} mb={4}>
                  Por unidade
                </Text>
                <TabelaSimples
                  linhas={dados.porUnidade}
                  colunas={[
                    { titulo: 'Unidade', valor: (l: any) => l.unidade },
                    { titulo: 'Aplicadas', valor: (l: any) => l.aplicadas },
                  ]}
                />
              </Paper>
            </Grid.Col>
          </Grid>
        </>
      )}
    </Stack>
  );
}

function TelaSipni() {
  useTituloJanela('Exportação SI-PNI');
  const [f, setF] = useState<Record<string, any>>({ de: dayjs().startOf('month').format('YYYY-MM-DD'), ate: dayjs().format('YYYY-MM-DD'), tipo: 'registros' });
  const baixar = () =>
    api
      .arquivo(`/api/imunizacao/exportar/sipni?tipo=${f.tipo}&de=${f.de}&ate=${f.ate}${f.unidadeId ? `&unidadeId=${f.unidadeId}` : ''}`, undefined, 'baixar', 'GET')
      .then(() => notificarOk('Arquivo gerado.'))
      .catch(notificarErro);
  return (
    <Stack p="md" gap="sm" maw={700}>
      <Title order={4}>Exportação para o SI-PNI / RNDS</Title>
      <Select
        label="Informação"
        value={f.tipo}
        onChange={(v) => setF({ ...f, tipo: v ?? 'registros' })}
        data={[
          { value: 'registros', label: 'Registros de vacinação (aplicações e resgates) - FHIR/RNDS' },
          { value: 'vacinados', label: 'Vacinados (cadastro dos cidadãos)' },
          { value: 'movimentacao', label: 'Movimentação de imunobiológicos' },
        ]}
      />
      <Group grow>
        <DateInput label="De" valueFormat="DD/MM/YYYY" value={new Date(f.de + 'T12:00')} onChange={(d) => d && setF({ ...f, de: dayjs(d).format('YYYY-MM-DD') })} />
        <DateInput label="Até" valueFormat="DD/MM/YYYY" value={new Date(f.ate + 'T12:00')} onChange={(d) => d && setF({ ...f, ate: dayjs(d).format('YYYY-MM-DD') })} />
      </Group>
      <SelecaoRef entidade="unidade" rotulo="Unidade (vazio = todas)" valor={f.unidadeId} aoMudar={(v) => setF({ ...f, unidadeId: v })} />
      <Group>
        <Button leftSection={<IconDownload size={16} />} onClick={() => void baixar()}>
          Gerar arquivo
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Os registros exportados ficam marcados com a data de envio. As aplicações inadvertidas são sinalizadas conforme o padrão do Ministério da Saúde.
      </Text>
    </Stack>
  );
}

registrarExtensaoFormulario('frasco_aberto', {
  acoes: (r, recarregar) =>
    r?.id && r.situacao === 'ABERTO' ? (
      <Button
        color="orange"
        variant="light"
        onClick={async () => {
          if (await confirmar('Encerrar frasco', 'As doses restantes serão consideradas perdas (fim do prazo de uso após abertura). Confirma?', 'Encerrar', true))
            await api.post(`/api/imunizacao/frascos/${r.id}/encerrar`).then(recarregar).catch(notificarErro);
        }}
      >
        Encerrar frasco
      </Button>
    ) : null,
});

registrarTela({ id: 'vacinacao', titulo: 'Carteira de vacinação', menu: 'Imunização', padrao: '/t/vacinacao', permissao: 'vacinacao:consultar', modulo: 'IMU', palavras: ['vacina', 'aplicar', 'resgate', 'aprazamento', 'sala de vacina'], ordem: 1, render: ({ query }) => <TelaVacinacao query={query} /> });
registrarTela({ id: 'busca-ativa-vacinas', titulo: 'Busca ativa (doses pendentes)', menu: 'Imunização', padrao: '/t/busca-ativa-vacinas', permissao: 'vacinacao:consultar', modulo: 'IMU', palavras: ['atrasada', 'pendente', 'faltosos'], ordem: 2, render: () => <TelaBuscaAtiva /> });
registrarTela({ id: 'painel-campanha', titulo: 'Painel da campanha', menu: 'Imunização', padrao: '/t/painel-campanha', permissao: 'campanha_vacinacao:consultar', modulo: 'IMU', palavras: ['meta', 'cobertura'], ordem: 3, render: ({ query }) => <TelaPainelCampanha query={query} /> });
registrarTela({ id: 'sipni', titulo: 'Exportação SI-PNI', menu: 'Imunização', padrao: '/t/sipni', permissao: 'exportacao_sipni:executar', modulo: 'IMU', palavras: ['rnds', 'ministério'], ordem: 8, render: () => <TelaSipni /> });
registrarMenuRelatorios('IMU', 'Imunização', 'vacinacao:exportar');

