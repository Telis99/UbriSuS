// Farmácia (TR 1.2.20 a 1.2.30): dispensação com receita eletrônica, FEFO e bloqueios; estoque em
// tempo real; requisições e transferências; acertos; ações nas entradas, requisições e processos.
import { useEffect, useMemo, useRef, useState } from 'react';
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
  Progress,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconBarcode, IconCheck, IconLock, IconLockOpen, IconPill, IconPrinter, IconTrash, IconTruckDelivery } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api, ErroApi } from '@/api';
import { useAuth } from '@/auth/Auth';
import { registrarExtensaoFormulario } from '@/genericos/Formulario';
import { confirmar, pedirTexto } from '@/genericos/dialogos';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { BuscaPaciente, CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { abrirPdf, comConfirmacao, fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, Situacao, TabelaSimples } from '@/componentes/comum';
import { registrarMenuRelatorios } from './Relatorios';
import { registrarTela } from './registro';

const TIPOS_RECEITA = [
  { value: 'BASICA', label: 'Receita simples' },
  { value: 'BRANCA_C', label: 'Controle especial (branca - C)' },
  { value: 'AZUL_B', label: 'Notificação azul (B)' },
  { value: 'AMARELA_A', label: 'Notificação amarela (A)' },
  { value: 'ANTIMICROBIANO', label: 'Antimicrobiano' },
];

interface Item {
  chave: number;
  produtoId: number;
  nome: string;
  quantidade: number;
  diasConsumo?: number;
  loteId?: number | null;
  prescricaoItemId?: number | null;
  saldoReceita?: number | null;
  info?: any;
}

let seq = 0;

/** Seleção do lote (FEFO por padrão), saldo, vencidos e alternativas quando falta o produto. */
function InfoProduto({ item, aoMudar }: { item: Item; aoMudar: (p: Partial<Item>) => void }) {
  const i = item.info;
  if (!i) return null;
  return (
    <Stack gap={2}>
      <Group gap={4}>
        <Badge size="xs" color={i.saldo > 0 ? 'teal' : 'red'} variant="light">
          saldo {i.saldo}
        </Badge>
        {i.produto?.lista_344 && (
          <Badge size="xs" color="dark">
            lista {i.produto.lista_344}
          </Badge>
        )}
        {i.produto?.tipo_receita && i.produto.tipo_receita !== 'BASICA' && (
          <Badge size="xs" color="grape">
            {i.produto.tipo_receita}
          </Badge>
        )}
        {i.vencidos?.length > 0 && (
          <Tooltip label={i.vencidos.map((v: any) => `${v.lote} venc. ${fmtData(v.validade)} (${Number(v.quantidade)})`).join('; ')}>
            <Badge size="xs" color="orange">
              {i.vencidos.length} lote(s) vencido(s) ignorado(s)
            </Badge>
          </Tooltip>
        )}
      </Group>
      {i.lotes?.length > 0 && (
        <Select
          size="xs"
          w={260}
          placeholder="Lote automático (menor validade)"
          clearable
          value={item.loteId ? String(item.loteId) : null}
          onChange={(v) => aoMudar({ loteId: v ? Number(v) : null })}
          data={i.lotes.map((l: any) => ({ value: String(l.id), label: `${l.lote} · val. ${fmtData(l.validade)} · ${l.disponivel}` }))}
        />
      )}
      {i.saldo <= 0 && (
        <Text size="xs" c="red">
          Sem estoque.{' '}
          {i.similares?.length ? `Similares: ${i.similares.map((s: any) => `${s.nome} (${Number(s.saldo)})`).join(', ')}. ` : ''}
          {i.outrasUnidades?.length ? `Disponível em: ${i.outrasUnidades.map((u: any) => `${u.nome} (${Number(u.saldo)})`).join(', ')}.` : ''}
        </Text>
      )}
    </Stack>
  );
}

function TelaDispensacao({ query }: { query: URLSearchParams }) {
  useTituloJanela('Dispensação');
  const { eu } = useAuth();
  const [pacienteId, setPacienteId] = useState<number | null>(query.get('paciente') ? Number(query.get('paciente')) : null);
  const { paciente, recarregar } = usePaciente(pacienteId, 'farmacia');
  const [dados, setDados] = useState<any>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [receita, setReceita] = useState<Record<string, any>>({ tipoReceita: 'BASICA' });
  const [prescricaoId, setPrescricaoId] = useState<number | null>(null);
  const [processoId, setProcessoId] = useState<number | null>(query.get('processo') ? Number(query.get('processo')) : null);
  const [produto, setProduto] = useState<number | null>(null);
  const [codigo, setCodigo] = useState('');
  const [demandas, setDemandas] = useState<{ produtoId: number; nome: string; quantidade: number }[]>([]);
  const barras = useRef<HTMLInputElement>(null);

  const carregar = async () => {
    if (pacienteId) await api.get(`/api/farmacia/paciente/${pacienteId}`).then(setDados).catch(notificarErro);
  };
  useEffect(() => {
    setItens([]);
    setPrescricaoId(null);
    setDemandas([]);
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacienteId]);

  async function adicionar(produtoId: number, nome: string, extra: Partial<Item> = {}) {
    try {
      const info = await api.get(`/api/farmacia/produtos/${produtoId}/disponivel`, { unidadeId: eu?.unidadeAtual });
      setItens((xs) => [...xs, { chave: ++seq, produtoId, nome: info.produto?.nome ?? nome, quantidade: extra.quantidade ?? 1, info, ...extra }]);
    } catch (e) {
      notificarErro(e);
    }
  }

  async function lerCodigo() {
    if (!codigo.trim()) return;
    try {
      const p = await api.get('/api/farmacia/produto-por-codigo', { codigo: codigo.trim() });
      const existente = itens.find((i) => i.produtoId === p.id);
      if (existente) setItens(itens.map((i) => (i === existente ? { ...i, quantidade: i.quantidade + 1 } : i)));
      else await adicionar(p.id, p.nome);
    } catch (e) {
      notificarErro(e);
    }
    setCodigo('');
    barras.current?.focus();
  }

  async function usarReceita(r: any) {
    if (r.vencida) return notificarErro(new Error(`Receita ${r.numero} vencida em ${fmtData(r.validade)}.`));
    setPrescricaoId(r.id);
    setProcessoId(null);
    setReceita({ tipoReceita: r.tipo_receita, numeroReceita: r.numero_notificacao ?? r.numero, prescritor: r.prescritor });
    setItens([]);
    for (const i of r.itens ?? []) {
      if (!i.produto_id) continue;
      const saldo = i.quantidade != null ? Number(i.quantidade) - Number(i.dispensada) : null;
      if (saldo !== null && saldo <= 0) continue;
      await adicionar(i.produto_id, i.descricao, { prescricaoItemId: i.id, quantidade: saldo ?? 1, saldoReceita: saldo, diasConsumo: i.duracao_dias ?? (i.uso_continuo ? 30 : undefined) });
    }
  }

  async function usarProcesso(p: any) {
    setProcessoId(p.id);
    setPrescricaoId(null);
    setItens([]);
    for (const i of p.itens ?? []) {
      const saldo = Number(i.quantidade) - Number(i.entregue ?? 0);
      if (saldo > 0) await adicionar(i.produto_id, i.produto, { quantidade: Math.min(saldo, Number(i.por_retirada ?? saldo)), diasConsumo: i.frequencia ?? undefined });
    }
  }

  async function dispensar(confirmado = false) {
    if (!pacienteId || !itens.length) return;
    const corpo = {
      pacienteId,
      prescricaoId,
      processoJudicialId: processoId,
      numeroReceita: receita.numeroReceita || null,
      prescritor: receita.prescritor || null,
      tipoReceita: receita.tipoReceita,
      dataReceita: !prescricaoId && receita.dataReceita ? receita.dataReceita : null,
      retiradoPor: receita.retiradoPor || null,
      itens: itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, loteId: i.loteId ?? null, diasConsumo: i.diasConsumo ?? null, prescricaoItemId: i.prescricaoItemId ?? null })),
      confirmarAvisos: confirmado,
      demandaReprimida: demandas.length ? demandas.map((d) => ({ produtoId: d.produtoId, quantidade: d.quantidade })) : undefined,
    };
    try {
      const d = await api.post('/api/farmacia/dispensacoes', corpo);
      notificarOk(`Dispensação nº ${d.id} registrada.`);
      void abrirPdf(`/api/farmacia/dispensacoes/${d.id}/comprovante`);
      setItens([]);
      setDemandas([]);
      setPrescricaoId(null);
      void carregar();
    } catch (e) {
      if (e instanceof ErroApi && e.status === 409 && e.detalhes?.exigeConfirmacao) {
        if (await confirmar('Atenção', `${e.message} Deseja dispensar mesmo assim?`, 'Dispensar', true)) return dispensar(true);
        return;
      }
      if (e instanceof ErroApi && e.detalhes?.estoqueInsuficiente) {
        const it = itens.find((i) => i.produtoId === e.detalhes.produtoId);
        if (it && (await confirmar('Estoque insuficiente', `${e.message} Registrar a quantidade faltante como demanda reprimida?`, 'Registrar demanda')))
          setDemandas([...demandas, { produtoId: it.produtoId, nome: it.nome, quantidade: it.quantidade - Number(e.detalhes.disponivel) }]);
      }
      notificarErro(e);
    }
  }

  const controlado = itens.some((i) => i.info?.produto?.controlado || i.info?.produto?.lista_344 || ['BRANCA_C', 'AZUL_B', 'AMARELA_A'].includes(i.info?.produto?.tipo_receita));

  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Dispensação de medicamentos e materiais</Title>
      {!pacienteId ? (
        <Paper withBorder p="sm">
          <BuscaPaciente aoSelecionar={setPacienteId} />
        </Paper>
      ) : (
        paciente && (
          <>
            <CabecalhoPaciente paciente={paciente} compacto aoAtualizar={recarregar} />
            <Group>
              <Button size="compact-xs" variant="subtle" onClick={() => setPacienteId(null)}>
                Trocar paciente
              </Button>
            </Group>
            <Tabs defaultValue="dispensar" keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="dispensar">Dispensar</Tabs.Tab>
                <Tabs.Tab value="historico">Histórico de retiradas ({dados?.historico?.length ?? 0})</Tabs.Tab>
                <Tabs.Tab value="demandas">Demanda reprimida ({dados?.demandas?.length ?? 0})</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="dispensar" pt="sm">
                <Grid gutter="sm">
                  <Grid.Col span={{ base: 12, lg: 4 }}>
                    <Stack gap="xs">
                      <Paper withBorder p="xs">
                        <Text size="sm" fw={600} mb={4}>
                          Receitas eletrônicas abertas
                        </Text>
                        {(dados?.receitas ?? []).length === 0 && (
                          <Text size="xs" c="dimmed">
                            Nenhuma receita pendente.
                          </Text>
                        )}
                        {(dados?.receitas ?? []).map((r: any) => (
                          <Paper key={r.id} withBorder p={6} mb={4} style={{ cursor: 'pointer', borderColor: prescricaoId === r.id ? 'var(--mantine-color-blue-6)' : undefined }} onClick={() => void usarReceita(r)}>
                            <Group justify="space-between">
                              <Text size="xs" fw={600}>
                                {r.numero} · {fmtData(r.data)}
                              </Text>
                              <Badge size="xs" color={r.vencida ? 'red' : 'blue'}>
                                {r.vencida ? 'vencida' : `válida até ${fmtData(r.validade)}`}
                              </Badge>
                            </Group>
                            <Text size="xs" c="dimmed">
                              {r.prescritor} · {r.tipo_receita} <Situacao valor={r.situacao} />
                            </Text>
                            {(r.itens ?? []).map((i: any) => (
                              <Text key={i.id} size="xs">
                                • {i.descricao} {i.quantidade != null ? `(${Number(i.dispensada)}/${Number(i.quantidade)})` : ''}
                              </Text>
                            ))}
                          </Paper>
                        ))}
                      </Paper>
                      {(dados?.processos ?? []).length > 0 && (
                        <Paper withBorder p="xs">
                          <Text size="sm" fw={600} mb={4}>
                            Processos judiciais
                          </Text>
                          {dados.processos.map((p: any) => (
                            <Paper key={p.id} withBorder p={6} mb={4} style={{ cursor: 'pointer', borderColor: processoId === p.id ? 'var(--mantine-color-blue-6)' : undefined }} onClick={() => void usarProcesso(p)}>
                              <Text size="xs" fw={600}>
                                {p.numero} <Situacao valor={p.situacao} />
                              </Text>
                              {(p.itens ?? []).map((i: any, k: number) => (
                                <Text key={k} size="xs">
                                  • {i.produto}: entregue {Number(i.entregue ?? 0)} de {Number(i.quantidade)}
                                </Text>
                              ))}
                            </Paper>
                          ))}
                        </Paper>
                      )}
                    </Stack>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, lg: 8 }}>
                    <Paper withBorder p="sm">
                      <Grid gutter="xs" align="flex-end">
                        <Grid.Col span={{ base: 12, md: 4 }}>
                          <TextInput
                            ref={barras}
                            label="Código de barras"
                            leftSection={<IconBarcode size={16} />}
                            value={codigo}
                            onChange={(e) => setCodigo(e.currentTarget.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void lerCodigo())}
                            placeholder="Leia ou digite e tecle Enter"
                          />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, md: 8 }}>
                          <SelecaoRef entidade="produto" rotulo="Ou pesquise o produto" valor={produto} aoMudar={(v, r) => (v && void adicionar(v, r ?? ''), setProduto(null))} />
                        </Grid.Col>
                      </Grid>
                      <Table mt="sm" fz="sm" withTableBorder>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Produto / lote</Table.Th>
                            <Table.Th w={100}>Quantidade</Table.Th>
                            <Table.Th w={100}>Dias consumo</Table.Th>
                            <Table.Th w={40} />
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {itens.map((i) => (
                            <Table.Tr key={i.chave}>
                              <Table.Td>
                                <Text size="sm" fw={500}>
                                  {i.nome}
                                </Text>
                                {i.saldoReceita != null && (
                                  <Text size="xs" c="dimmed">
                                    Saldo da receita: {i.saldoReceita}
                                  </Text>
                                )}
                                <InfoProduto item={i} aoMudar={(p) => setItens(itens.map((x) => (x.chave === i.chave ? { ...x, ...p } : x)))} />
                              </Table.Td>
                              <Table.Td>
                                <NumberInput size="xs" min={0.01} value={i.quantidade} onChange={(v) => setItens(itens.map((x) => (x.chave === i.chave ? { ...x, quantidade: Number(v) || 0 } : x)))} />
                              </Table.Td>
                              <Table.Td>
                                <NumberInput size="xs" min={1} value={i.diasConsumo ?? ''} onChange={(v) => setItens(itens.map((x) => (x.chave === i.chave ? { ...x, diasConsumo: v === '' ? undefined : Number(v) } : x)))} />
                              </Table.Td>
                              <Table.Td>
                                <ActionIcon variant="subtle" color="red" onClick={() => setItens(itens.filter((x) => x.chave !== i.chave))}>
                                  <IconTrash size={14} />
                                </ActionIcon>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                      {itens.length === 0 && (
                        <Text size="xs" c="dimmed" p="xs">
                          Selecione uma receita, um processo ou inclua os produtos.
                        </Text>
                      )}
                      <Grid gutter="xs" mt="xs">
                        <Grid.Col span={{ base: 12, md: 4 }}>
                          <Select label="Tipo de receita" data={TIPOS_RECEITA} value={receita.tipoReceita} disabled={!!prescricaoId} onChange={(v) => setReceita({ ...receita, tipoReceita: v ?? 'BASICA' })} />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, md: 4 }}>
                          <TextInput label="Nº da receita" required={controlado} value={receita.numeroReceita ?? ''} disabled={!!prescricaoId} onChange={(e) => setReceita({ ...receita, numeroReceita: e.currentTarget.value })} />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, md: 4 }}>
                          <DateInput
                            label="Data da receita"
                            valueFormat="DD/MM/YYYY"
                            maxDate={new Date()}
                            disabled={!!prescricaoId}
                            value={receita.dataReceita ? new Date(receita.dataReceita + 'T12:00') : null}
                            onChange={(d) => setReceita({ ...receita, dataReceita: d ? dayjs(d).format('YYYY-MM-DD') : null })}
                          />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, md: 6 }}>
                          <TextInput label="Profissional que receitou" required={controlado} value={receita.prescritor ?? ''} disabled={!!prescricaoId} onChange={(e) => setReceita({ ...receita, prescritor: e.currentTarget.value })} />
                        </Grid.Col>
                        <Grid.Col span={{ base: 12, md: 6 }}>
                          <TextInput label="Retirado por (se não for o paciente)" value={receita.retiradoPor ?? ''} onChange={(e) => setReceita({ ...receita, retiradoPor: e.currentTarget.value })} />
                        </Grid.Col>
                      </Grid>
                      {demandas.length > 0 && (
                        <Alert color="yellow" mt="xs" py={6}>
                          Demanda reprimida a registrar: {demandas.map((d) => `${d.nome} (${d.quantidade})`).join(', ')}
                        </Alert>
                      )}
                      <Group justify="flex-end" mt="sm">
                        <Button leftSection={<IconPill size={16} />} disabled={!itens.length || itens.some((i) => i.quantidade <= 0)} onClick={() => void dispensar()}>
                          Dispensar e imprimir comprovante
                        </Button>
                      </Group>
                    </Paper>
                  </Grid.Col>
                </Grid>
              </Tabs.Panel>
              <Tabs.Panel value="historico" pt="sm">
                <TabelaSimples
                  linhas={dados?.historico ?? []}
                  colunas={[
                    { titulo: 'Data', valor: (l: any) => fmtDataHora(l.data_hora) },
                    { titulo: 'Unidade', valor: (l: any) => l.unidade },
                    { titulo: 'Produto', valor: (l: any) => l.produto },
                    { titulo: 'Qtd.', valor: (l: any) => Number(l.quantidade) },
                    { titulo: 'Lote', valor: (l: any) => l.lote },
                    { titulo: 'Prescritor', valor: (l: any) => l.prescritor },
                    { titulo: 'Receita', valor: (l: any) => l.tipo_receita },
                    { titulo: 'Término', valor: (l: any) => fmtData(l.termino) },
                    { titulo: 'Situação', valor: (l: any) => <Situacao valor={l.situacao} /> },
                    {
                      titulo: '',
                      valor: (l: any) => (
                        <Group gap={2} wrap="nowrap">
                          <Tooltip label="Reimprimir comprovante">
                            <ActionIcon size="sm" variant="subtle" onClick={() => void abrirPdf(`/api/farmacia/dispensacoes/${l.id}/comprovante`)}>
                              <IconPrinter size={14} />
                            </ActionIcon>
                          </Tooltip>
                          {l.situacao === 'EFETIVADA' && (
                            <Tooltip label="Estornar">
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="red"
                                onClick={async () => {
                                  const motivo = await pedirTexto('Estornar dispensação', 'Motivo do estorno');
                                  if (motivo) await api.post(`/api/farmacia/dispensacoes/${l.id}/estornar`, { motivo }).then(() => (notificarOk('Dispensação estornada.'), carregar())).catch(notificarErro);
                                }}
                              >
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Group>
                      ),
                    },
                  ]}
                />
              </Tabs.Panel>
              <Tabs.Panel value="demandas" pt="sm">
                <TabelaSimples
                  linhas={dados?.demandas ?? []}
                  colunas={[
                    { titulo: 'Data', valor: (l: any) => fmtData(l.data) },
                    { titulo: 'Produto', valor: (l: any) => l.produto },
                    { titulo: 'Necessária', valor: (l: any) => Number(l.quantidade) },
                    { titulo: 'Atendida', valor: (l: any) => Number(l.quantidade_atendida) },
                    { titulo: 'Situação', valor: (l: any) => <Situacao valor={l.situacao} /> },
                  ]}
                />
              </Tabs.Panel>
            </Tabs>
          </>
        )
      )}
    </Stack>
  );
}

const COR_NIVEL: Record<string, string> = { OK: 'teal', ATENCAO: 'yellow', ABAIXO_MINIMO: 'orange', ZERADO: 'red' };

function TelaEstoque() {
  useTituloJanela('Estoque');
  const { eu } = useAuth();
  const [f, setF] = useState<Record<string, any>>({ unidadeId: eu?.unidadeAtual ?? null });
  const [linhas, setLinhas] = useState<any[]>([]);
  const [produto, setProduto] = useState<any>(null);
  const [lotes, setLotes] = useState<any[]>([]);
  const carregar = () => api.get('/api/farmacia/estoque', { ...f, todas: !f.unidadeId }).then(setLinhas).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [f]);
  const abrirProduto = (l: any) => {
    setProduto(l);
    api.get(`/api/farmacia/produtos/${l.produto_id}/lotes`).then(setLotes).catch(notificarErro);
  };
  async function bloqueio(l: any) {
    const motivo = l.bloqueado ? undefined : await pedirTexto('Bloquear lote', 'Motivo (ex.: interdição ANVISA)');
    if (!l.bloqueado && !motivo) return;
    await api.post(`/api/farmacia/lotes/${l.id}/bloqueio`, { bloquear: !l.bloqueado, motivo }).catch(notificarErro);
    abrirProduto(produto);
    void carregar();
  }
  const totais = useMemo(() => ({ valor: linhas.reduce((s, l) => s + l.valor, 0), abaixo: linhas.filter((l) => l.nivel === 'ABAIXO_MINIMO' || l.nivel === 'ZERADO').length }), [linhas]);
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Estoque em tempo real</Title>
      <Paper withBorder p="sm">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade (vazio = todas permitidas)" valor={f.unidadeId} aoMudar={(v) => setF({ ...f, unidadeId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput label="Produto, princípio ativo ou código de barras" value={f.busca ?? ''} onChange={(e) => setF({ ...f, busca: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Switch label="Somente abaixo do mínimo" checked={!!f.abaixoMinimo} onChange={(e) => setF({ ...f, abaixoMinimo: e.currentTarget.checked })} />
          </Grid.Col>
        </Grid>
      </Paper>
      <Group gap="xs">
        <Badge variant="light">{linhas.length} produto(s)</Badge>
        <Badge variant="light" color="orange">
          {totais.abaixo} abaixo do mínimo
        </Badge>
        <Badge variant="light" color="teal">
          {totais.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em estoque
        </Badge>
      </Group>
      <Paper withBorder>
        <ScrollArea h="calc(100vh - 330px)">
          <Table fz="xs" striped highlightOnHover stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Unidade</Table.Th>
                <Table.Th>Produto</Table.Th>
                <Table.Th ta="right">Quantidade</Table.Th>
                <Table.Th ta="right">Vencido</Table.Th>
                <Table.Th ta="right">Reservado</Table.Th>
                <Table.Th ta="right">Saldo</Table.Th>
                <Table.Th w={180}>Nível</Table.Th>
                <Table.Th>Próx. validade</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {linhas.map((l) => (
                <Table.Tr key={`${l.unidade_id}-${l.produto_id}`} style={{ cursor: 'pointer' }} onClick={() => abrirProduto(l)}>
                  <Table.Td>{l.unidade}</Table.Td>
                  <Table.Td>
                    {l.produto}
                    {l.lista_344 && (
                      <Badge size="xs" color="dark" ml={4}>
                        {l.lista_344}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">{l.quantidade.toLocaleString('pt-BR')}</Table.Td>
                  <Table.Td ta="right" c={l.vencido ? 'red' : undefined}>
                    {l.vencido || ''}
                  </Table.Td>
                  <Table.Td ta="right">{l.reservado || ''}</Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {l.saldo.toLocaleString('pt-BR')}
                  </Table.Td>
                  <Table.Td>
                    <Tooltip label={l.estoque_minimo != null ? `Mínimo ${l.estoque_minimo}` : 'Sem mínimo definido'}>
                      <Progress value={l.estoque_minimo ? Math.min(100, (l.saldo / (l.estoque_minimo * 2)) * 100) : 100} color={COR_NIVEL[l.nivel]} size="lg" />
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>{fmtData(l.proxima_validade)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      <Modal opened={!!produto} onClose={() => setProduto(null)} title={`${produto?.produto ?? ''} — lotes em todas as unidades`} size="xl">
        <TabelaSimples
          linhas={lotes}
          colunas={[
            { titulo: 'Unidade', valor: (l: any) => l.unidade },
            { titulo: 'Lote', valor: (l: any) => l.lote },
            { titulo: 'Validade', valor: (l: any) => <Text size="xs" c={l.vencido ? 'red' : undefined}>{fmtData(l.validade)}</Text> },
            { titulo: 'Fabricante', valor: (l: any) => l.fabricante },
            { titulo: 'Quantidade', valor: (l: any) => Number(l.quantidade) },
            { titulo: 'Reservado', valor: (l: any) => Number(l.reservado) || '' },
            {
              titulo: 'Bloqueio',
              valor: (l: any) => (
                <Tooltip label={l.bloqueado ? `Bloqueado: ${l.motivo_bloqueio ?? ''} (clique para desbloquear)` : 'Bloquear lote'}>
                  <ActionIcon size="sm" variant={l.bloqueado ? 'filled' : 'subtle'} color={l.bloqueado ? 'red' : 'gray'} onClick={() => void bloqueio(l)}>
                    {l.bloqueado ? <IconLock size={14} /> : <IconLockOpen size={14} />}
                  </ActionIcon>
                </Tooltip>
              ),
            },
          ]}
        />
      </Modal>
    </Stack>
  );
}

function NovaTransferencia({ requisicao, aoConcluir }: { requisicao?: any; aoConcluir: () => void }) {
  const { eu } = useAuth();
  const [destino, setDestino] = useState<number | null>(requisicao?.unidade_requisitante_id ?? null);
  const [itens, setItens] = useState<{ chave: number; produtoId: number; nome: string; quantidade: number; requisicaoItemId?: number; saldo?: number; disponivel?: number }[]>(
    (requisicao?.itens ?? [])
      .filter((i: any) => Number(i.quantidade) > Number(i.atendida))
      .map((i: any) => ({ chave: ++seq, produtoId: i.produto_id, nome: i.produto, quantidade: Math.min(Number(i.quantidade) - Number(i.atendida), Number(i.saldo_disponivel)), requisicaoItemId: i.id, saldo: Number(i.saldo_requisitante), disponivel: Number(i.saldo_disponivel) })),
  );
  const [produto, setProduto] = useState<number | null>(null);
  async function enviar() {
    try {
      const t = await api.post('/api/farmacia/transferencias', {
        unidadeOrigemId: eu?.unidadeAtual,
        unidadeDestinoId: destino,
        requisicoes: requisicao ? [requisicao.id] : undefined,
        itens: itens.filter((i) => i.quantidade > 0).map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade, requisicaoItemId: i.requisicaoItemId })),
      });
      notificarOk(`Transferência nº ${t.id} criada (${t.situacao.replace(/_/g, ' ').toLowerCase()}).`);
      void abrirPdf(`/api/farmacia/guia/transferencia/${t.id}`);
      aoConcluir();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack gap="xs">
      {!requisicao && <SelecaoRef entidade="unidade" rotulo="Unidade de destino" valor={destino} aoMudar={setDestino} obrigatorio />}
      {!requisicao && <SelecaoRef entidade="produto" rotulo="Adicionar produto" valor={produto} aoMudar={(v, r) => (v && setItens([...itens, { chave: ++seq, produtoId: v, nome: r ?? '', quantidade: 1 }]), setProduto(null))} />}
      <Table fz="xs" withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Produto</Table.Th>
            {requisicao && <Table.Th>Saldo requisitante</Table.Th>}
            {requisicao && <Table.Th>Disponível aqui</Table.Th>}
            <Table.Th w={120}>Enviar</Table.Th>
            <Table.Th w={30} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {itens.map((i) => (
            <Table.Tr key={i.chave}>
              <Table.Td>{i.nome}</Table.Td>
              {requisicao && <Table.Td>{i.saldo}</Table.Td>}
              {requisicao && <Table.Td c={i.disponivel ? undefined : 'red'}>{i.disponivel}</Table.Td>}
              <Table.Td>
                <NumberInput size="xs" min={0} value={i.quantidade} onChange={(v) => setItens(itens.map((x) => (x.chave === i.chave ? { ...x, quantidade: Number(v) || 0 } : x)))} />
              </Table.Td>
              <Table.Td>
                <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setItens(itens.filter((x) => x.chave !== i.chave))}>
                  <IconTrash size={12} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="flex-end">
        <Button leftSection={<IconTruckDelivery size={16} />} disabled={!destino || !itens.some((i) => i.quantidade > 0)} onClick={() => void enviar()}>
          Transferir e imprimir guia
        </Button>
      </Group>
    </Stack>
  );
}

function ModalRecebimento({ t, aoFechar }: { t: any; aoFechar: (ok: boolean) => void }) {
  const [rec, setRec] = useState<Record<number, number>>(Object.fromEntries((t.itens ?? []).map((i: any) => [i.id, Number(i.quantidade)])));
  return (
    <Modal opened onClose={() => aoFechar(false)} title={`Receber transferência nº ${t.id} de ${t.origem}`} size="lg">
      <Table fz="xs">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Produto</Table.Th>
            <Table.Th>Lote</Table.Th>
            <Table.Th>Enviado</Table.Th>
            <Table.Th w={120}>Recebido</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(t.itens ?? []).map((i: any) => (
            <Table.Tr key={i.id}>
              <Table.Td>{i.produto}</Table.Td>
              <Table.Td>
                {i.lote} ({fmtData(i.validade)})
              </Table.Td>
              <Table.Td>{Number(i.quantidade)}</Table.Td>
              <Table.Td>
                <NumberInput size="xs" min={0} max={Number(i.quantidade)} value={rec[i.id]} onChange={(v) => setRec({ ...rec, [i.id]: Number(v) || 0 })} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="flex-end" mt="sm">
        <Button
          leftSection={<IconCheck size={16} />}
          onClick={() =>
            api
              .post(`/api/farmacia/transferencias/${t.id}/receber`, { recebidos: rec })
              .then(() => (notificarOk('Recebimento confirmado.'), aoFechar(true)))
              .catch(notificarErro)
          }
        >
          Confirmar recebimento
        </Button>
      </Group>
    </Modal>
  );
}

function TelaTransferencias() {
  useTituloJanela('Requisições e transferências');
  const { eu } = useAuth();
  const [aba, setAba] = useState<string | null>('pendentes');
  const [pendentes, setPendentes] = useState<any[]>([]);
  const [lista, setLista] = useState<any[]>([]);
  const [atendendo, setAtendendo] = useState<any>(null);
  const [recebendo, setRecebendo] = useState<any>(null);
  const carregar = () => {
    api.get('/api/farmacia/requisicoes/pendentes').then(setPendentes).catch(notificarErro);
    api.get('/api/farmacia/transferencias').then(setLista).catch(notificarErro);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(carregar, [eu?.unidadeAtual]);
  const acao = (url: string, corpo: unknown, msg: string) =>
    api
      .post(url, corpo)
      .then(() => (notificarOk(msg), carregar()))
      .catch(notificarErro);
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Requisições e transferências</Title>
      <Tabs value={aba} onChange={setAba} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="pendentes">Requisições recebidas ({pendentes.length})</Tabs.Tab>
          <Tabs.Tab value="nova">Transferência sem requisição</Tabs.Tab>
          <Tabs.Tab value="lista">Transferências ({lista.length})</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="pendentes" pt="sm">
          {pendentes.map((r) => (
            <Paper key={r.id} withBorder p="xs" mb="xs">
              <Group justify="space-between">
                <Text size="sm" fw={600}>
                  Requisição nº {r.id} · {r.unidade_requisitante} · {fmtData(r.data)} <Situacao valor={r.situacao} />
                </Text>
                <Group gap={4}>
                  <Button size="compact-xs" variant="subtle" leftSection={<IconPrinter size={12} />} onClick={() => void abrirPdf(`/api/farmacia/guia/requisicao/${r.id}?analitica=true`)}>
                    Guia de separação
                  </Button>
                  {r.situacao === 'ENVIADA' && (
                    <Button size="compact-xs" variant="light" onClick={() => void acao(`/api/farmacia/requisicoes/${r.id}/separar`, {}, 'Requisição em separação.')}>
                      Iniciar separação
                    </Button>
                  )}
                  <Button size="compact-xs" onClick={() => setAtendendo(r)}>
                    Atender
                  </Button>
                </Group>
              </Group>
              <TabelaSimples
                linhas={r.itens ?? []}
                colunas={[
                  { titulo: 'Produto', valor: (i: any) => i.produto },
                  { titulo: 'Solicitado', valor: (i: any) => Number(i.quantidade) },
                  { titulo: 'Atendido', valor: (i: any) => Number(i.atendida) },
                  { titulo: 'Saldo no requisitante', valor: (i: any) => Number(i.saldo_requisitante) },
                  { titulo: 'Consumo 30 dias', valor: (i: any) => Number(i.consumo_30d) },
                  { titulo: 'Último envio', valor: (i: any) => fmtData(i.ultimo_envio) },
                  { titulo: 'Disponível aqui', valor: (i: any) => Number(i.saldo_disponivel) },
                ]}
              />
            </Paper>
          ))}
          {!pendentes.length && (
            <Text size="sm" c="dimmed">
              Nenhuma requisição pendente para esta unidade.
            </Text>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="nova" pt="sm">
          <Paper withBorder p="sm" maw={900}>
            <NovaTransferencia aoConcluir={() => (carregar(), setAba('lista'))} />
          </Paper>
        </Tabs.Panel>
        <Tabs.Panel value="lista" pt="sm">
          <TabelaSimples
            linhas={lista}
            colunas={[
              { titulo: 'Nº', valor: (t: any) => t.id },
              { titulo: 'Data', valor: (t: any) => fmtDataHora(t.data) },
              { titulo: 'Origem', valor: (t: any) => t.origem },
              { titulo: 'Destino', valor: (t: any) => t.destino },
              { titulo: 'Itens', valor: (t: any) => (t.itens ?? []).map((i: any) => `${i.produto} (${Number(i.quantidade)}${i.recebida != null && Number(i.recebida) !== Number(i.quantidade) ? ` / rec. ${Number(i.recebida)}` : ''})`).join('; ') },
              { titulo: 'Situação', valor: (t: any) => <Situacao valor={t.situacao} /> },
              {
                titulo: '',
                valor: (t: any) => (
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon size="sm" variant="subtle" onClick={() => void abrirPdf(`/api/farmacia/guia/transferencia/${t.id}`)}>
                      <IconPrinter size={14} />
                    </ActionIcon>
                    {t.situacao === 'AGUARDANDO_APROVACAO' && t.unidade_origem_id === eu?.unidadeAtual && (
                      <Button size="compact-xs" onClick={() => void acao(`/api/farmacia/transferencias/${t.id}/aprovar`, {}, 'Transferência aprovada.')}>
                        Aprovar
                      </Button>
                    )}
                    {t.situacao === 'EM_TRANSITO' && t.unidade_destino_id === eu?.unidadeAtual && (
                      <Button size="compact-xs" color="teal" onClick={() => setRecebendo(t)}>
                        Receber
                      </Button>
                    )}
                    {['AGUARDANDO_APROVACAO', 'EM_TRANSITO'].includes(t.situacao) && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        onClick={async () => {
                          const motivo = await pedirTexto('Cancelar transferência', 'Motivo');
                          if (motivo) void acao(`/api/farmacia/transferencias/${t.id}/cancelar`, { motivo }, 'Transferência cancelada; estoque liberado.');
                        }}
                      >
                        Cancelar
                      </Button>
                    )}
                  </Group>
                ),
              },
            ]}
          />
        </Tabs.Panel>
      </Tabs>
      <Modal opened={!!atendendo} onClose={() => setAtendendo(null)} title={`Atender requisição nº ${atendendo?.id} — ${atendendo?.unidade_requisitante}`} size="xl">
        {atendendo && <NovaTransferencia requisicao={atendendo} aoConcluir={() => (setAtendendo(null), carregar(), setAba('lista'))} />}
      </Modal>
      {recebendo && <ModalRecebimento t={recebendo} aoFechar={(ok) => (setRecebendo(null), ok && carregar())} />}
    </Stack>
  );
}

function TelaAcerto() {
  useTituloJanela('Acerto de estoque');
  const { eu } = useAuth();
  const [produtoId, setProdutoId] = useState<number | null>(null);
  const [lotes, setLotes] = useState<any[]>([]);
  const [novos, setNovos] = useState<Record<number, number>>({});
  const [todos, setTodos] = useState(false);
  const carregar = () =>
    api
      .get('/api/farmacia/acerto', { produtoId: produtoId ?? undefined })
      .then((r) => (setLotes(r), setNovos({})))
      .catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void ((produtoId || todos) && carregar()), [produtoId, todos, eu?.unidadeAtual]);
  async function gravar() {
    const itens = Object.entries(novos).map(([loteId, novoSaldo]) => ({ loteId: Number(loteId), novoSaldo }));
    if (!itens.length) return;
    const motivo = await pedirTexto('Acerto de estoque', 'Motivo / justificativa');
    if (!motivo) return;
    try {
      const r = await api.post('/api/farmacia/acerto', { itens, motivo });
      notificarOk(`${r.length} lote(s) ajustado(s); entradas e baixas geradas automaticamente.`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm" maw={1100}>
      <Title order={4}>Acerto de estoque</Title>
      <Group align="flex-end">
        <div style={{ flex: 1 }}>
          <SelecaoRef entidade="produto" rotulo="Produto" valor={produtoId} aoMudar={setProdutoId} />
        </div>
        <Checkbox label="Listar todos os produtos da unidade" checked={todos} onChange={(e) => setTodos(e.currentTarget.checked)} />
      </Group>
      <Table fz="sm" withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Produto</Table.Th>
            <Table.Th>Lote</Table.Th>
            <Table.Th>Validade</Table.Th>
            <Table.Th>Fabricante</Table.Th>
            <Table.Th ta="right">Saldo</Table.Th>
            <Table.Th w={140}>Novo saldo</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lotes.map((l) => (
            <Table.Tr key={l.id}>
              <Table.Td>{l.produto}</Table.Td>
              <Table.Td>
                {l.lote}
                {l.bloqueado && (
                  <Badge size="xs" color="red" ml={4}>
                    bloqueado
                  </Badge>
                )}
              </Table.Td>
              <Table.Td c={dayjs(l.validade).isBefore(dayjs(), 'day') ? 'red' : undefined}>{fmtData(l.validade)}</Table.Td>
              <Table.Td>{l.fabricante}</Table.Td>
              <Table.Td ta="right">{Number(l.quantidade)}</Table.Td>
              <Table.Td>
                <NumberInput
                  size="xs"
                  min={0}
                  value={novos[l.id] ?? ''}
                  placeholder={String(Number(l.quantidade))}
                  onChange={(v) => setNovos((n) => (v === '' ? Object.fromEntries(Object.entries(n).filter(([k]) => Number(k) !== l.id)) : { ...n, [l.id]: Number(v) }))}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group justify="flex-end">
        <Button disabled={!Object.keys(novos).length} onClick={() => void gravar()}>
          Gravar acertos ({Object.keys(novos).length})
        </Button>
      </Group>
    </Stack>
  );
}

// Ações nos cadastros genéricos.
registrarExtensaoFormulario('entrada', {
  acoes: (r, recarregar) =>
    r?.id ? (
      <>
        {r.situacao === 'DIGITACAO' && (
          <Button
            color="teal"
            onClick={async () => {
              try {
                const x = await comConfirmacao((ok) => api.post(`/api/farmacia/entradas/${r.id}/confirmar`, { ignorarDiferencaValor: ok }), 'Valor da nota');
                if (x) notificarOk(x.situacao === 'CONFIRMADA' ? 'Entrada confirmada; estoque atualizado.' : 'Entrada enviada para aprovação.');
                recarregar();
              } catch (e) {
                notificarErro(e);
              }
            }}
          >
            Confirmar entrada
          </Button>
        )}
        {['AGUARDANDO_APROVACAO', 'RECEBIDA_INTEGRACAO'].includes(r.situacao) && (
          <Button color="teal" onClick={() => api.post(`/api/farmacia/entradas/${r.id}/aprovar`).then(() => (notificarOk('Entrada aprovada.'), recarregar())).catch(notificarErro)}>
            Aprovar entrada
          </Button>
        )}
        {['AGUARDANDO_APROVACAO', 'RECEBIDA_INTEGRACAO', 'DIGITACAO'].includes(r.situacao) && (
          <Button
            variant="light"
            color="red"
            onClick={async () => {
              const motivo = await pedirTexto('Rejeitar entrada', 'Motivo');
              if (motivo) await api.post(`/api/farmacia/entradas/${r.id}/rejeitar`, { motivo }).then(recarregar).catch(notificarErro);
            }}
          >
            Rejeitar
          </Button>
        )}
      </>
    ) : null,
});

registrarExtensaoFormulario('requisicao_estoque', {
  acoes: (r, recarregar) => {
    if (!r?.id) return null;
    const acao = (a: string, msg: string) =>
      api
        .post(`/api/farmacia/requisicoes/${r.id}/${a}`)
        .then(() => (notificarOk(msg), recarregar()))
        .catch(notificarErro);
    return (
      <>
        <Button variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/farmacia/guia/requisicao/${r.id}`)}>
          Imprimir sintética
        </Button>
        <Button variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/farmacia/guia/requisicao/${r.id}?analitica=true`)}>
          Imprimir analítica
        </Button>
        {r.situacao === 'DIGITACAO' && <Button onClick={() => void acao('enviar', 'Requisição enviada à unidade requisitada.')}>Finalizar e enviar</Button>}
        {['ATENDIDA', 'ATENDIDA_PARCIAL'].includes(r.situacao) && <Button onClick={() => void acao('receber', 'Requisição marcada como recebida.')}>Registrar recebimento</Button>}
        {['DIGITACAO', 'ENVIADA', 'EM_SEPARACAO'].includes(r.situacao) && (
          <Button variant="light" color="red" onClick={() => void acao('cancelar', 'Requisição cancelada.')}>
            Cancelar requisição
          </Button>
        )}
      </>
    );
  },
});

function BotaoDispensarProcesso({ r }: { r: any }) {
  const { abrir } = useJanelas();
  return (
    <Button leftSection={<IconPill size={14} />} onClick={() => abrir(`/t/dispensacao?paciente=${r.paciente_id}&processo=${r.id}`, 'Dispensação')}>
      Dispensar pelo processo
    </Button>
  );
}
registrarExtensaoFormulario('processo_judicial', {
  acoes: (r) => (r?.id ? <BotaoDispensarProcesso r={r} /> : null),
});

registrarExtensaoFormulario('demanda_reprimida', {
  acoes: (r, recarregar) =>
    r?.id ? (
      <Button
        variant="light"
        onClick={async () => {
          const meio = await pedirTexto('Avisar paciente', 'Meio (SMS, EMAIL, PUSH ou SISTEMA)');
          if (!meio) return;
          await api
            .post(`/api/farmacia/demandas/${r.id}/avisar`, { meio: meio.toUpperCase().trim() })
            .then(() => (notificarOk('Aviso enviado e contato registrado.'), recarregar()))
            .catch(notificarErro);
        }}
      >
        Avisar paciente
      </Button>
    ) : null,
});

registrarTela({ id: 'dispensacao', titulo: 'Dispensação', menu: 'Farmácia', padrao: '/t/dispensacao', permissao: 'dispensacao:incluir', modulo: 'FAR', palavras: ['entregar medicamento', 'receita', 'remédio'], ordem: 1, render: ({ query }) => <TelaDispensacao query={query} /> });
registrarTela({ id: 'estoque', titulo: 'Estoque em tempo real', menu: 'Farmácia/Estoque', padrao: '/t/estoque', permissao: 'estoque_lote:consultar', modulo: 'FAR', palavras: ['saldo', 'lote', 'validade'], ordem: 1, render: () => <TelaEstoque /> });
registrarTela({ id: 'transferencias', titulo: 'Requisições recebidas e transferências', menu: 'Farmácia/Estoque', padrao: '/t/transferencias', permissao: 'transferencia:consultar', modulo: 'FAR', palavras: ['guia de separação', 'enviar estoque'], ordem: 2, render: () => <TelaTransferencias /> });
registrarTela({ id: 'acerto-estoque', titulo: 'Acerto de estoque', menu: 'Farmácia/Estoque', padrao: '/t/acerto-estoque', permissao: 'acerto_estoque:executar', modulo: 'FAR', palavras: ['inventário', 'ajuste'], ordem: 3, render: () => <TelaAcerto /> });
registrarMenuRelatorios('FAR', 'Farmácia', 'dispensacao:exportar');
