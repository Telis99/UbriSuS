// AIH (TR 1.2.37, 1.2.38, 1.2.13.1.15 a 1.2.13.1.23): laudos de solicitação com impressão automática,
// aprovação, glosa, arquivamento, autorização individual (próxima AIH pré-carregada) e em massa,
// cancelamento com liberador, internação, saída/óbito, AIHs pagas, etiquetas e exportação SISAIH01/CIHA01.
import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Badge, Button, Checkbox, Grid, Group, Menu, Modal, Paper, PasswordInput, Select, Stack, Table, Tabs, Text, TextInput, Textarea, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconDots, IconDownload, IconFileText, IconPlus, IconPrinter, IconRefresh, IconTags } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api, urlArquivo } from '@/api';
import { useAuth } from '@/auth/Auth';
import { abrirPdf, fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, TabelaSimples } from '@/componentes/comum';
import { Formulario } from '@/genericos/Formulario';
import { pedirTexto } from '@/genericos/dialogos';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const SITUACOES = [
  { value: '', label: 'Todas' },
  { value: 'SOLICITADO', label: 'Solicitados' },
  { value: 'APROVADO', label: 'Aprovados' },
  { value: 'GLOSADO', label: 'Glosados' },
  { value: 'AUTORIZADO', label: 'Autorizados' },
  { value: 'ARQUIVADO', label: 'Arquivados' },
];
const COR: Record<string, string> = { SOLICITADO: 'blue', APROVADO: 'teal', GLOSADO: 'red', AUTORIZADO: 'green', ARQUIVADO: 'gray', AGUARDANDO: 'gray', INTERNADO: 'orange', ALTA: 'violet' };
const MOTIVOS_SAIDA = [
  ['11', 'Alta curado'],
  ['12', 'Alta melhorado'],
  ['14', 'Alta a pedido'],
  ['15', 'Alta com previsão de retorno'],
  ['16', 'Alta por evasão'],
  ['18', 'Alta por outros motivos'],
  ['31', 'Transferido para outro estabelecimento'],
  ['41', 'Óbito com DO fornecida pelo médico assistente'],
  ['42', 'Óbito com DO fornecida pelo IML'],
  ['43', 'Óbito com DO fornecida pelo SVO'],
].map(([value, label]) => ({ value, label: `${value} - ${label}` }));
const moeda = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const iso = (d: Date | null) => (d ? dayjs(d).format('YYYY-MM-DD') : null);
const dataDe = (s?: string | null) => (s ? new Date(s + 'T12:00') : null);

type Acao = { tipo: 'autorizar' | 'lote' | 'cancelar' | 'internar' | 'saida' | 'detalhe'; laudo?: any } | null;

function ModalAutorizar({ laudos, aoFechar }: { laudos: any[]; aoFechar: (ok: boolean) => void }) {
  const lote = laudos.length > 1;
  const [f, setF] = useState<{ numero: string; autorizadorId: number | null; data: string | null }>({ numero: '', autorizadorId: null, data: dayjs().format('YYYY-MM-DD') });
  const { eu } = useAuth();
  useEffect(() => {
    // Próxima AIH disponível já pré-carregada (TR 1.2.37.10).
    api
      .get('/api/aih/proximo-numero', { unidadeId: laudos[0]?.unidade_executante_id, data: f.data })
      .then((r) => setF((x) => ({ ...x, numero: r.numero ?? '' })))
      .catch(notificarErro);
    if (eu?.profissionalId) setF((x) => ({ ...x, autorizadorId: x.autorizadorId ?? eu.profissionalId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.data]);
  async function confirmar() {
    try {
      if (lote) {
        const r = await api.post('/api/aih/autorizar-lote', { ids: laudos.map((l) => l.id), primeiroNumero: f.numero || null, autorizadorId: f.autorizadorId, data: f.data });
        notificarOk(`${r.length} laudo(s) autorizado(s): AIH ${r[0].numero} a ${r[r.length - 1].numero}.`);
      } else {
        const r = await api.post(`/api/aih/laudos/${laudos[0].id}/autorizar`, { numero: f.numero || null, autorizadorId: f.autorizadorId, data: f.data });
        notificarOk(`Laudo autorizado com a AIH ${r.numero}.`);
        void abrirPdf(`/api/aih/laudos/${laudos[0].id}/autorizacao-pdf`);
      }
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} title={lote ? `Autorização em massa (${laudos.length} laudos)` : `Autorizar laudo ${laudos[0]?.numero_laudo}`} size="lg">
      <Stack gap="xs">
        {!lote && (
          <Text size="sm">
            {laudos[0]?.paciente} · {laudos[0]?.procedimento}
          </Text>
        )}
        {lote && <Text size="sm">Informe apenas o primeiro número: os demais laudos recebem os números seguintes livres da faixa, na ordem da lista.</Text>}
        <TextInput label={lote ? 'Primeiro número de AIH' : 'Número da AIH (próxima disponível pré-carregada)'} value={f.numero} onChange={(e) => setF({ ...f, numero: e.currentTarget.value.replace(/\D/g, '').slice(0, 13) })} description="13 dígitos (o último é o dígito verificador)" />
        <SelecaoRef entidade="profissional" rotulo="Profissional autorizador / auditor" obrigatorio valor={f.autorizadorId} filtro={{ autorizador_aih: true }} aoMudar={(v) => setF({ ...f, autorizadorId: v })} />
        <DateInput label="Data da autorização" valueFormat="DD/MM/YYYY" value={dataDe(f.data)} onChange={(d) => setF({ ...f, data: iso(d) })} maxDate={new Date()} />
        <Group justify="flex-end">
          <Button disabled={!f.autorizadorId} onClick={() => void confirmar()}>
            Autorizar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ModalCancelar({ laudo, aoFechar }: { laudo: any; aoFechar: (ok: boolean) => void }) {
  const [f, setF] = useState({ motivo: '', liberadorLogin: '', liberadorSenha: '' });
  const [exige, setExige] = useState(true);
  useEffect(() => void api.get('/api/aih/parametros').then((p) => setExige(p.cancelamentoExigeLiberador)).catch(() => {}), []);
  async function confirmar() {
    try {
      await api.post(`/api/aih/laudos/${laudo.id}/cancelar-autorizacao`, { motivo: f.motivo, liberadorLogin: f.liberadorLogin || null, liberadorSenha: f.liberadorSenha || null });
      notificarOk(`Autorização da AIH ${laudo.numero_aih} cancelada; o laudo voltou para aprovado.`);
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} title={`Cancelar autorização - AIH ${laudo.numero_aih}`}>
      <Stack gap="xs">
        <Textarea label="Motivo do cancelamento" required value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.currentTarget.value })} />
        {exige && (
          <>
            <Text size="xs" c="dimmed">
              Parâmetro do sistema: o cancelamento exige a senha de um operador liberador.
            </Text>
            <TextInput label="Login do liberador" value={f.liberadorLogin} onChange={(e) => setF({ ...f, liberadorLogin: e.currentTarget.value })} />
            <PasswordInput label="Senha do liberador" value={f.liberadorSenha} onChange={(e) => setF({ ...f, liberadorSenha: e.currentTarget.value })} />
          </>
        )}
        <Group justify="flex-end">
          <Button color="red" disabled={f.motivo.trim().length < 3} onClick={() => void confirmar()}>
            Cancelar autorização
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ModalInternacao({ laudo, saida, aoFechar }: { laudo: any; saida: boolean; aoFechar: (ok: boolean) => void }) {
  const [f, setF] = useState<Record<string, any>>({ data: dayjs().format('YYYY-MM-DD'), motivo: '12' });
  const obito = saida && String(f.motivo).startsWith('4');
  async function confirmar() {
    try {
      if (saida) {
        await api.post(`/api/aih/laudos/${laudo.id}/saida`, { data: f.data, motivo: f.motivo, procedimentoRealizadoId: f.procedimentoRealizadoId ?? null, declaracaoObito: f.declaracaoObito || null, dataObito: f.dataObito || null });
        notificarOk(obito ? 'Saída por óbito registrada; o cadastro do paciente foi alterado para falecido.' : 'Saída registrada.');
      } else {
        await api.post(`/api/aih/laudos/${laudo.id}/internar`, { data: f.data, enfermaria: f.enfermaria || null, leito: f.leito || null });
        notificarOk('Internação registrada.');
      }
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} title={`${saida ? 'Registrar saída' : 'Registrar internação'} - AIH ${laudo.numero_aih}`}>
      <Stack gap="xs">
        <Text size="sm">{laudo.paciente}</Text>
        <DateInput label={saida ? 'Data da saída' : 'Data da internação'} valueFormat="DD/MM/YYYY" value={dataDe(f.data)} onChange={(d) => setF({ ...f, data: iso(d) })} maxDate={new Date()} />
        {!saida && (
          <Group grow>
            <TextInput label="Enfermaria" maxLength={4} value={f.enfermaria ?? ''} onChange={(e) => setF({ ...f, enfermaria: e.currentTarget.value })} />
            <TextInput label="Leito" maxLength={4} value={f.leito ?? ''} onChange={(e) => setF({ ...f, leito: e.currentTarget.value })} />
          </Group>
        )}
        {saida && (
          <>
            <Select label="Motivo da saída" data={MOTIVOS_SAIDA} value={f.motivo} onChange={(v) => setF({ ...f, motivo: v })} allowDeselect={false} />
            <SelecaoRef entidade="procedimento" rotulo="Procedimento realizado (se diferente do solicitado)" valor={f.procedimentoRealizadoId} aoMudar={(v) => setF({ ...f, procedimentoRealizadoId: v })} />
            {obito && (
              <Paper withBorder p="xs" bg="red.0">
                <Text size="sm" fw={600} c="red">
                  Alta por óbito: o cadastro do paciente será alterado automaticamente para FALECIDO.
                </Text>
                <Group grow>
                  <TextInput label="Nº da declaração de óbito" value={f.declaracaoObito ?? ''} onChange={(e) => setF({ ...f, declaracaoObito: e.currentTarget.value })} />
                  <DateInput label="Data do óbito" valueFormat="DD/MM/YYYY" value={dataDe(f.dataObito ?? f.data)} onChange={(d) => setF({ ...f, dataObito: iso(d) })} maxDate={new Date()} />
                </Group>
              </Paper>
            )}
          </>
        )}
        <Group justify="flex-end">
          <Button color={obito ? 'red' : undefined} onClick={() => void confirmar()}>
            Confirmar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ModalDetalhe({ laudo, aoFechar }: { laudo: any; aoFechar: () => void }) {
  const [d, setD] = useState<any>(null);
  useEffect(() => void api.get(`/api/aih/laudos/${laudo.id}`).then(setD).catch(notificarErro), [laudo.id]);
  return (
    <Modal opened onClose={aoFechar} title={`Laudo ${laudo.numero_laudo} - ${laudo.paciente}`} size="xl">
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Histórico (data, hora e usuário de cada operação)
        </Text>
        <TabelaSimples
          linhas={d?.historico ?? []}
          colunas={[
            { titulo: 'Data/hora', valor: (h: any) => fmtDataHora(h.criado_em) },
            { titulo: 'Ação', valor: (h: any) => h.acao.replace(/_/g, ' ') },
            { titulo: 'Situação', valor: (h: any) => `${h.situacao_anterior ?? '-'} → ${h.situacao_nova ?? '-'}` },
            { titulo: 'Detalhe', valor: (h: any) => h.detalhe },
            { titulo: 'Operador', valor: (h: any) => h.operador },
            { titulo: 'Liberador', valor: (h: any) => h.liberador },
          ]}
        />
        <Text size="sm" fw={600}>
          Procedimentos realizados
        </Text>
        <TabelaSimples
          linhas={d?.procedimentos ?? []}
          vazio="Nenhum procedimento lançado (o principal entra na saída do paciente)."
          colunas={[
            { titulo: 'Data', valor: (p: any) => fmtData(p.data) },
            { titulo: 'Procedimento', valor: (p: any) => p.procedimento },
            { titulo: 'Tipo', valor: (p: any) => p.tipo },
            { titulo: 'Qtd.', valor: (p: any) => p.quantidade },
            { titulo: 'Profissional', valor: (p: any) => `${p.profissional ?? '-'} ${p.cbo_codigo ?? ''}` },
            { titulo: 'Valor', valor: (p: any) => moeda(p.valor) },
          ]}
        />
      </Stack>
    </Modal>
  );
}

function TelaAih() {
  useTituloJanela('AIH - laudos e autorizações');
  const { abrir } = useJanelas();
  const { pode } = useAuth();
  const [filtro, setFiltro] = useState<Record<string, any>>({ situacao: '' });
  const [linhas, setLinhas] = useState<any[]>([]);
  const [selecionados, setSelecionados] = useState<number[]>([]);
  const [acao, setAcao] = useState<Acao>(null);
  const [novo, setNovo] = useState<null | 'laudo' | 'autorizada'>(null);
  const [autorizada, setAutorizada] = useState<{ numero: string; autorizadorId: number | null }>({ numero: '', autorizadorId: null });
  const autoriza = pode('aih_autorizacao:executar', 'AIH');

  const carregar = () => api.get('/api/aih/laudos', filtro).then((r) => (setLinhas(r), setSelecionados([]))).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [filtro.situacao, filtro.unidadeExecutanteId, filtro.internacao]);

  async function executar(url: string, corpo: any, msg: string) {
    try {
      await api.post(url, corpo);
      notificarOk(msg);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  const aprovados = useMemo(() => linhas.filter((l) => selecionados.includes(l.id) && l.situacao === 'APROVADO'), [linhas, selecionados]);
  const totais = useMemo(() => {
    const t: Record<string, number> = {};
    for (const l of linhas) t[l.situacao] = (t[l.situacao] ?? 0) + 1;
    return t;
  }, [linhas]);

  // Laudo incluído: impressão automática (TR 1.2.37.4); AIH já autorizada: autoriza com o número informado (TR 1.2.37.15).
  async function laudoIncluido(r: any) {
    const tipo = novo;
    setNovo(null);
    if (tipo === 'autorizada') {
      try {
        const a = await api.post(`/api/aih/laudos/${r.id}/autorizar-direta`, { numero: autorizada.numero, autorizadorId: autorizada.autorizadorId });
        notificarOk(`AIH ${a.numero} incluída já autorizada.`);
        void abrirPdf(`/api/aih/laudos/${r.id}/autorizacao-pdf`);
      } catch (e) {
        notificarErro(e);
      }
    } else {
      notificarOk(`Laudo ${r.numero_laudo ?? ''} incluído; impressão gerada.`);
      void abrirPdf(`/api/aih/laudos/${r.id}/pdf`);
    }
    void carregar();
  }

  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>AIH - laudos de internação e autorizações</Title>
        <Group gap="xs">
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setNovo('laudo')}>
            Novo laudo
          </Button>
          {autoriza && (
            <Button size="xs" variant="light" onClick={() => (setAutorizada({ numero: '', autorizadorId: null }), setNovo('autorizada'))}>
              Incluir AIH já autorizada
            </Button>
          )}
          {autoriza && (
            <Button size="xs" color="green" disabled={!aprovados.length} onClick={() => setAcao({ tipo: 'lote' })}>
              Autorizar selecionados ({aprovados.length})
            </Button>
          )}
          <Button size="xs" variant="default" leftSection={<IconTags size={14} />} disabled={!selecionados.length} onClick={() => void api.arquivo('/api/aih/etiquetas', { ids: selecionados }, 'abrir').catch(notificarErro)}>
            Etiquetas
          </Button>
          <Button size="xs" variant="default" leftSection={<IconFileText size={14} />} onClick={() => abrir('/t/relatorios/AIH', 'Relatórios de AIH')}>
            Relatórios
          </Button>
        </Group>
      </Group>
      <Paper withBorder p="sm">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 12, md: 2 }}>
            <Select label="Situação do laudo" data={SITUACOES.map((s) => ({ ...s, label: `${s.label}${s.value && totais[s.value] ? ` (${totais[s.value]})` : ''}` }))} value={filtro.situacao} onChange={(v) => setFiltro({ ...filtro, situacao: v ?? '' })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <Select
              label="Internação"
              clearable
              data={[
                { value: 'AGUARDANDO', label: 'Aguardando' },
                { value: 'INTERNADO', label: 'Internados' },
                { value: 'ALTA', label: 'Com saída' },
              ]}
              value={filtro.internacao ?? null}
              onChange={(v) => setFiltro({ ...filtro, internacao: v })}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade executante" valor={filtro.unidadeExecutanteId} aoMudar={(v) => setFiltro({ ...filtro, unidadeExecutanteId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <TextInput label="Paciente, CNS, nº do laudo ou da AIH" value={filtro.busca ?? ''} onChange={(e) => setFiltro({ ...filtro, busca: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && void carregar()} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <Button fullWidth variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void carregar()}>
              Pesquisar
            </Button>
          </Grid.Col>
        </Grid>
      </Paper>
      <Paper withBorder>
        <Table striped highlightOnHover fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={30}>
                <Checkbox size="xs" checked={!!linhas.length && selecionados.length === linhas.length} onChange={(e) => setSelecionados(e.currentTarget.checked ? linhas.map((l) => l.id) : [])} />
              </Table.Th>
              <Table.Th>Laudo</Table.Th>
              <Table.Th>Solicitação</Table.Th>
              <Table.Th>Paciente</Table.Th>
              <Table.Th>Procedimento / CID</Table.Th>
              <Table.Th>Executante</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th>AIH</Table.Th>
              <Table.Th>Internação</Table.Th>
              <Table.Th>Valor</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {linhas.map((l) => (
              <Table.Tr key={l.id}>
                <Table.Td>
                  <Checkbox size="xs" checked={selecionados.includes(l.id)} onChange={(e) => setSelecionados(e.currentTarget.checked ? [...selecionados, l.id] : selecionados.filter((x) => x !== l.id))} />
                </Table.Td>
                <Table.Td>
                  {l.numero_laudo}
                  {l.origem === 'WEBSERVICE' && (
                    <Badge size="xs" ml={4} variant="outline">
                      WS
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{fmtDataHora(l.data_hora)}</Table.Td>
                <Table.Td>{l.paciente}</Table.Td>
                <Table.Td>
                  {l.procedimento}
                  <Text size="xs" c="dimmed">
                    CID {l.cid ?? '-'}
                  </Text>
                </Table.Td>
                <Table.Td>{l.unidade_executante ?? '-'}</Table.Td>
                <Table.Td>
                  <Badge size="sm" variant="light" color={COR[l.situacao]}>
                    {l.situacao}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {l.numero_aih ?? '-'}
                  {l.paga && (
                    <Badge size="xs" ml={4} color="green">
                      PAGA
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge size="sm" variant="dot" color={COR[l.situacao_internacao]}>
                    {l.situacao_internacao}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {l.data_internacao ? fmtData(l.data_internacao) : ''}
                    {l.data_saida ? ` a ${fmtData(l.data_saida)}` : ''}
                  </Text>
                </Table.Td>
                <Table.Td>{moeda(l.valor_total)}</Table.Td>
                <Table.Td>
                  <Menu withinPortal position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" size="sm">
                        <IconDots size={14} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => abrir(`/e/aih_laudo/${l.id}`, `Laudo ${l.numero_laudo}`)}>Abrir / editar laudo</Menu.Item>
                      <Menu.Item onClick={() => setAcao({ tipo: 'detalhe', laudo: l })}>Histórico e procedimentos</Menu.Item>
                      <Menu.Item leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/aih/laudos/${l.id}/pdf`)}>
                        Reimprimir laudo
                      </Menu.Item>
                      {autoriza && ['SOLICITADO', 'GLOSADO'].includes(l.situacao) && <Menu.Item onClick={() => void executar(`/api/aih/laudos/${l.id}/aprovar`, {}, 'Laudo aprovado.')}>Aprovar laudo</Menu.Item>}
                      {autoriza && l.situacao === 'APROVADO' && (
                        <>
                          <Menu.Item color="green" onClick={() => setAcao({ tipo: 'autorizar', laudo: l })}>
                            Autorizar (gerar AIH)
                          </Menu.Item>
                          <Menu.Item
                            color="red"
                            onClick={async () => {
                              const motivo = await pedirTexto('Glosar laudo', 'Motivo da glosa', { obrigatorio: true });
                              if (motivo) void executar(`/api/aih/laudos/${l.id}/glosar`, { motivo }, 'Laudo glosado (retornou a não aprovado).');
                            }}
                          >
                            Glosar
                          </Menu.Item>
                        </>
                      )}
                      {autoriza && ['APROVADO', 'AUTORIZADO'].includes(l.situacao) && (
                        <Menu.Item
                          onClick={async () => {
                            const motivo = await pedirTexto('Arquivar laudo', 'Observação do arquivamento');
                            if (motivo !== null) void executar(`/api/aih/laudos/${l.id}/arquivar`, { motivo }, 'Laudo arquivado.');
                          }}
                        >
                          Arquivar
                        </Menu.Item>
                      )}
                      {l.numero_aih && (
                        <>
                          <Menu.Divider />
                          <Menu.Item leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/aih/laudos/${l.id}/autorizacao-pdf`)}>
                            Imprimir autorização (2 vias)
                          </Menu.Item>
                          {l.situacao_internacao === 'AGUARDANDO' && l.situacao === 'AUTORIZADO' && <Menu.Item onClick={() => setAcao({ tipo: 'internar', laudo: l })}>Registrar internação</Menu.Item>}
                          {l.situacao_internacao !== 'ALTA' && <Menu.Item onClick={() => setAcao({ tipo: 'saida', laudo: l })}>Registrar saída / óbito</Menu.Item>}
                          {autoriza && <Menu.Item onClick={() => void executar(`/api/aih/laudos/${l.id}/paga`, { paga: !l.paga }, l.paga ? 'Identificação de pagamento desfeita.' : 'AIH identificada como paga.')}>{l.paga ? 'Desfazer "paga"' : 'Identificar como paga'}</Menu.Item>}
                          {autoriza && (
                            <Menu.Item color="red" onClick={() => setAcao({ tipo: 'cancelar', laudo: l })}>
                              Cancelar autorização
                            </Menu.Item>
                          )}
                        </>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!linhas.length && (
          <Text size="sm" c="dimmed" p="sm">
            Nenhum laudo encontrado.
          </Text>
        )}
      </Paper>

      {novo && (
        <Modal opened onClose={() => setNovo(null)} title={novo === 'autorizada' ? 'Incluir AIH já autorizada' : 'Novo laudo de AIH'} size="80rem">
          {novo === 'autorizada' && (
            <Paper withBorder p="xs" mb="xs" bg="green.0">
              <Text size="xs" mb={4}>
                Dispensa os trâmites de aprovação: informe o número da AIH emitida e o autorizador; ao gravar o laudo, a AIH é registrada como autorizada.
              </Text>
              <Group grow>
                <TextInput label="Número da AIH" required value={autorizada.numero} onChange={(e) => setAutorizada({ ...autorizada, numero: e.currentTarget.value.replace(/\D/g, '').slice(0, 13) })} />
                <SelecaoRef entidade="profissional" rotulo="Autorizador" obrigatorio filtro={{ autorizador_aih: true }} valor={autorizada.autorizadorId} aoMudar={(v) => setAutorizada({ ...autorizada, autorizadorId: v })} />
              </Group>
            </Paper>
          )}
          {(novo === 'laudo' || (autorizada.numero.length >= 12 && autorizada.autorizadorId)) && <Formulario entidade="aih_laudo" emModal aoSalvar={(r) => void laudoIncluido(r)} aoCancelar={() => setNovo(null)} />}
        </Modal>
      )}
      {acao?.tipo === 'autorizar' && <ModalAutorizar laudos={[acao.laudo]} aoFechar={(ok) => (setAcao(null), ok && void carregar())} />}
      {acao?.tipo === 'lote' && <ModalAutorizar laudos={aprovados} aoFechar={(ok) => (setAcao(null), ok && void carregar())} />}
      {acao?.tipo === 'cancelar' && <ModalCancelar laudo={acao.laudo} aoFechar={(ok) => (setAcao(null), ok && void carregar())} />}
      {(acao?.tipo === 'internar' || acao?.tipo === 'saida') && <ModalInternacao laudo={acao.laudo} saida={acao.tipo === 'saida'} aoFechar={(ok) => (setAcao(null), ok && void carregar())} />}
      {acao?.tipo === 'detalhe' && <ModalDetalhe laudo={acao.laudo} aoFechar={() => setAcao(null)} />}
    </Stack>
  );
}

function TelaExportacaoAih() {
  useTituloJanela('AIH - exportação SISAIH01 / CIHA01');
  const [competencia, setCompetencia] = useState(dayjs().format('YYYYMM'));
  const [unidadeId, setUnidadeId] = useState<number | null>(null);
  const [reexportar, setReexportar] = useState(false);
  const [dados, setDados] = useState<any>(null);
  const [etiquetas, setEtiquetas] = useState<{ de: string | null; ate: string | null }>({ de: dayjs().startOf('month').format('YYYY-MM-DD'), ate: dayjs().format('YYYY-MM-DD') });
  const carregar = () => /^\d{6}$/.test(competencia) && api.get('/api/aih/exportacoes', { competencia }).then(setDados).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [competencia]);
  async function baixar(url: string, corpo: any) {
    try {
      const r = await api.arquivo(url, corpo);
      notificarOk(`Arquivo ${r.nome} gerado.`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm" maw={1200}>
      <Title order={4}>Exportação SIH/SUS: SISAIH01 e CIHA01</Title>
      <Paper withBorder p="sm">
        <Group align="flex-end">
          <TextInput label="Competência (AAAAMM)" value={competencia} onChange={(e) => setCompetencia(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} w={160} />
          <div style={{ minWidth: 320 }}>
            <SelecaoRef entidade="unidade" rotulo="Estabelecimento (vazio = todos)" valor={unidadeId} aoMudar={setUnidadeId} />
          </div>
        </Group>
      </Paper>
      <Tabs defaultValue="sisaih">
        <Tabs.List>
          <Tabs.Tab value="sisaih">SISAIH01</Tabs.Tab>
          <Tabs.Tab value="ciha">CIHA01</Tabs.Tab>
          <Tabs.Tab value="etiquetas">Etiquetas</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="sisaih" pt="sm">
          <Paper withBorder p="sm">
            <Text size="sm" mb="xs">
              Gera o arquivo de importação do SISAIH01 com as AIHs autorizadas e com saída registrada na competência, a partir dos laudos, procedimentos realizados e cadastros, sem digitação complementar.
              Pendentes de exportação: <b>{dados?.pendentes?.sisaih ?? 0}</b>.
            </Text>
            <Checkbox label="Incluir AIHs já exportadas (reapresentação)" checked={reexportar} onChange={(e) => setReexportar(e.currentTarget.checked)} mb="xs" />
            <Button leftSection={<IconDownload size={16} />} onClick={() => void baixar('/api/aih/sisaih01', { competencia, unidadeId, reexportar })}>
              Gerar arquivo SISAIH01
            </Button>
          </Paper>
        </Tabs.Panel>
        <Tabs.Panel value="ciha" pt="sm">
          <Paper withBorder p="sm">
            <Text size="sm" mb="xs">
              Comunicação de internações e atendimentos ambulatoriais não financiados pelo SUS. Os atendimentos realizados por convênio na competência são incluídos automaticamente. Registros
              pendentes: <b>{dados?.pendentes?.ciha ?? 0}</b>.
            </Text>
            <Group>
              <Button variant="light" onClick={() => void api.post('/api/aih/ciha/gerar', { competencia }).then((r) => { notificarOk(`${r.incluidos} registro(s) CIHA incluído(s) a partir dos atendimentos.`); void carregar(); }).catch(notificarErro)}>
                Gerar registros a partir dos atendimentos
              </Button>
              <Button leftSection={<IconDownload size={16} />} onClick={() => void baixar('/api/aih/ciha01', { competencia, unidadeId })}>
                Gerar arquivo CIHA01
              </Button>
            </Group>
          </Paper>
        </Tabs.Panel>
        <Tabs.Panel value="etiquetas" pt="sm">
          <Paper withBorder p="sm">
            <Group align="flex-end">
              <DateInput label="Autorizadas de" valueFormat="DD/MM/YYYY" value={dataDe(etiquetas.de)} onChange={(d) => setEtiquetas({ ...etiquetas, de: iso(d) })} />
              <DateInput label="até" valueFormat="DD/MM/YYYY" value={dataDe(etiquetas.ate)} onChange={(d) => setEtiquetas({ ...etiquetas, ate: iso(d) })} />
              <Button leftSection={<IconTags size={16} />} onClick={() => void api.arquivo('/api/aih/etiquetas', { ...etiquetas, unidadeId }, 'abrir').catch(notificarErro)}>
                Emitir etiquetas
              </Button>
            </Group>
          </Paper>
        </Tabs.Panel>
      </Tabs>
      <Paper withBorder p="sm">
        <Text size="sm" fw={600} mb="xs">
          Arquivos gerados
        </Text>
        <TabelaSimples
          linhas={dados?.lotes ?? []}
          vazio="Nenhum arquivo gerado na competência."
          colunas={[
            { titulo: 'Sistema', valor: (l: any) => l.tipo },
            { titulo: 'Competência', valor: (l: any) => l.competencia },
            { titulo: 'Estabelecimento', valor: (l: any) => l.unidade ?? 'Todos' },
            { titulo: 'Registros', valor: (l: any) => l.registros },
            { titulo: 'Gerado em', valor: (l: any) => fmtDataHora(l.gerado_em) },
            {
              titulo: '',
              valor: (l: any) => (
                <ActionIcon size="sm" variant="subtle" component="a" href={urlArquivo(l.arquivo_id)} target="_blank">
                  <IconDownload size={14} />
                </ActionIcon>
              ),
            },
          ]}
        />
      </Paper>
    </Stack>
  );
}

registrarTela({ id: 'aih', titulo: 'Laudos e autorizações', menu: 'AIH', padrao: '/t/aih', permissao: 'aih_laudo:consultar', modulo: 'AIH', palavras: ['internação', 'autorização', 'laudo', 'glosa', 'sih'], ordem: 1, render: () => <TelaAih /> });
registrarTela({ id: 'aih-exportacao', titulo: 'Exportação SISAIH01 / CIHA01', menu: 'AIH', padrao: '/t/aih-exportacao', permissao: 'aih_exportacao:executar', modulo: 'AIH', palavras: ['sisaih01', 'ciha', 'etiqueta', 'faturamento hospitalar'], ordem: 2, render: () => <TelaExportacaoAih /> });
registrarMenuRelatorios('AIH', 'AIH', 'aih_laudo:exportar');
