// Atendimento remoto (TR 1.2.41): telas dos operadores para liberar o acesso dos cidadãos ao aplicativo,
// configurar o que fica disponível, confirmar/transferir agendamentos feitos pelo aplicativo e atender teleconsultas.
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Group, Modal, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, Table, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconCheck, IconLock, IconLockOpen, IconSend, IconUserCheck, IconUserX, IconVideo } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, Situacao, useCarregar, useIntervalo } from '@/componentes/comum';
import { confirmar, pedirTexto } from '@/genericos/dialogos';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const COR_CONTA: Record<string, string> = { SOLICITADA: 'yellow', ATIVA: 'teal', RECUSADA: 'red', BLOQUEADA: 'orange', INATIVA: 'gray' };

/** Liberação das solicitações de acesso pelo operador da unidade (TR 1.2.41.3), desbloqueio (TR 1.2.41.5) e validação de dependentes (TR 1.2.41.6.2). */
function TelaContas() {
  useTituloJanela('Acesso ao aplicativo do cidadão');
  const { abrir } = useJanelas();
  const [situacao, setSituacao] = useState('SOLICITADA');
  const [busca, setBusca] = useState('');
  const { dados, recarregar } = useCarregar<any[]>(() => api.get('/api/portal/contas', { situacao: situacao === 'TODAS' ? undefined : situacao, q: busca || undefined }), [situacao, busca]);
  const { dados: ind } = useCarregar<any>(() => api.get('/api/portal/indicadores'), [dados]);
  const { dados: pre } = useCarregar<any[]>(() => api.get('/api/portal/pre-cadastros').catch(() => []), []);
  const [liberando, setLiberando] = useState<any>(null);
  const [pessoaId, setPessoaId] = useState<number | null>(null);
  const acao = async (c: any, rota: string, corpo: any = {}, msg = 'Concluído.') => {
    try {
      const r = await api.post(`/api/portal/contas/${c.id}/${rota}`, corpo);
      notificarOk(r?.senhaTemporaria ? `Senha temporária: ${r.senhaTemporaria} (enviada também por SMS/e-mail)` : msg);
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const liberar = async () => {
    await acao(liberando, 'liberar', { pessoaId: pessoaId ?? undefined }, 'Acesso liberado e cidadão avisado.');
    setLiberando(null);
  };
  return (
    <Stack>
      {ind && (
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          {[
            ['Aguardando liberação', ind.solicitacoes, 'yellow'],
            ['Contas liberadas', ind.contas_ativas, 'teal'],
            ['Agendamentos no mês (app)', ind.agendamentos_mes, 'blue'],
            ['Acessos em 30 dias', ind.acessos_30_dias, 'grape'],
          ].map(([r, v, c]) => (
            <Card key={r as string} withBorder padding="sm">
              <Text size="xs" c="dimmed">
                {r}
              </Text>
              <Text fw={700} size="xl" c={c as string}>
                {v}
              </Text>
            </Card>
          ))}
        </SimpleGrid>
      )}
      <Tabs defaultValue="contas">
        <Tabs.List>
          <Tabs.Tab value="contas">Solicitações e contas</Tabs.Tab>
          <Tabs.Tab value="pre">Dependentes em pré-cadastro ({pre?.length ?? 0})</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="contas" pt="sm">
          <Group mb="sm">
            <SegmentedControl value={situacao} onChange={setSituacao} data={[{ value: 'SOLICITADA', label: 'Aguardando' }, { value: 'ATIVA', label: 'Liberadas' }, { value: 'BLOQUEADA', label: 'Bloqueadas' }, { value: 'RECUSADA', label: 'Recusadas' }, { value: 'TODAS', label: 'Todas' }]} />
            <TextInput placeholder="CNS, CPF ou nome" value={busca} onChange={(e) => setBusca(e.currentTarget.value)} />
          </Group>
          <Table striped highlightOnHover fz="xs" withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Solicitado em</Table.Th>
                <Table.Th>Nome / CNS</Table.Th>
                <Table.Th>Nascimento</Table.Th>
                <Table.Th>Cadastro do paciente</Table.Th>
                <Table.Th>Unidade</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th>Ações</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(dados ?? []).map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{fmtDataHora(c.solicitado_em)}</Table.Td>
                  <Table.Td>
                    <Text size="xs" fw={600}>
                      {c.nome_informado}
                    </Text>
                    <Text size="xs" c="dimmed">
                      CNS {c.cns} {c.celular ? `· ${c.celular}` : ''}
                    </Text>
                  </Table.Td>
                  <Table.Td>{fmtData(c.nascimento_informado)}</Table.Td>
                  <Table.Td>
                    {c.pessoa_id ? (
                      <Text size="xs">
                        {c.pessoa_nome} ({fmtData(c.pessoa_nascimento)}) {c.pessoa_nascimento !== c.nascimento_informado && <Badge color="red" size="xs">nascimento diverge</Badge>}
                      </Text>
                    ) : (
                      <Badge color="orange" size="xs">sem vínculo</Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{c.unidade}</Table.Td>
                  <Table.Td>
                    <Badge color={COR_CONTA[c.situacao]} size="sm">
                      {c.situacao}
                    </Badge>
                    {c.motivo && (
                      <Text size="10px" c="dimmed">
                        {c.motivo}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {['SOLICITADA', 'RECUSADA'].includes(c.situacao) && (
                        <Button size="compact-xs" color="teal" leftSection={<IconUserCheck size={12} />} onClick={() => { setLiberando(c); setPessoaId(c.pessoa_id ?? c.sugestoes?.[0]?.id ?? null); }}>
                          Liberar
                        </Button>
                      )}
                      {c.situacao === 'SOLICITADA' && (
                        <Button size="compact-xs" color="red" variant="light" leftSection={<IconUserX size={12} />} onClick={async () => { const m = await pedirTexto('Recusar solicitação', 'Motivo', { obrigatorio: true }); if (m) await acao(c, 'recusar', { motivo: m }, 'Solicitação recusada.'); }}>
                          Recusar
                        </Button>
                      )}
                      {c.situacao === 'ATIVA' && (
                        <Button size="compact-xs" color="orange" variant="light" leftSection={<IconLock size={12} />} onClick={async () => { const m = await pedirTexto('Bloquear conta', 'Motivo', { obrigatorio: true }); if (m) await acao(c, 'bloquear', { motivo: m }, 'Conta bloqueada.'); }}>
                          Bloquear
                        </Button>
                      )}
                      {c.situacao === 'BLOQUEADA' && (
                        <Button size="compact-xs" variant="light" leftSection={<IconLockOpen size={12} />} onClick={() => acao(c, 'desbloquear', {}, 'Conta desbloqueada.')}>
                          Desbloquear
                        </Button>
                      )}
                      {['ATIVA', 'BLOQUEADA'].includes(c.situacao) && (
                        <>
                          <Button size="compact-xs" variant="subtle" onClick={async () => (await confirmar('Senha temporária', 'Gerar nova senha temporária e enviar ao cidadão?')) && acao(c, 'senha-temporaria')}>
                            Senha temporária
                          </Button>
                          <Button size="compact-xs" variant="subtle" color="gray" onClick={async () => (await confirmar('Inativar', 'Inativar o acesso deste cidadão ao aplicativo?', 'Inativar', true)) && acao(c, 'inativar', {}, 'Acesso inativado.')}>
                            Inativar
                          </Button>
                        </>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {!dados?.length && (
            <Text c="dimmed" size="sm" p="sm">
              Nenhuma conta nesta situação.
            </Text>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="pre" pt="sm">
          <Alert variant="light" mb="sm">
            Integrantes incluídos pelo responsável familiar no aplicativo. Confira o documento apresentado, complete o cadastro e altere a situação para "Ativo" para liberar as funcionalidades.
          </Alert>
          <Table striped fz="xs" withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Incluído em</Table.Th>
                <Table.Th>Nome</Table.Th>
                <Table.Th>Nascimento</Table.Th>
                <Table.Th>Mãe</Table.Th>
                <Table.Th>Família / responsável</Table.Th>
                <Table.Th>Válido até</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(pre ?? []).map((p) => (
                <Table.Tr key={p.id}>
                  <Table.Td>{fmtDataHora(p.criado_em)}</Table.Td>
                  <Table.Td>{p.nome}</Table.Td>
                  <Table.Td>{fmtData(p.nascimento)}</Table.Td>
                  <Table.Td>{p.nome_mae}</Table.Td>
                  <Table.Td>
                    {p.familia} — {p.responsavel}
                  </Table.Td>
                  <Table.Td>{fmtData(p.valido_ate)}</Table.Td>
                  <Table.Td>
                    <Button size="compact-xs" onClick={() => abrir(`/e/paciente/${p.id}`, p.nome)}>
                      Validar cadastro
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
      </Tabs>
      <Modal opened={!!liberando} onClose={() => setLiberando(null)} title="Liberar acesso ao aplicativo" size="lg">
        {liberando && (
          <Stack>
            <Text size="sm">
              Solicitação de <b>{liberando.nome_informado}</b>, CNS {liberando.cns}, nascimento {fmtData(liberando.nascimento_informado)}
              {liberando.mae_informada ? `, mãe ${liberando.mae_informada}` : ''}.
            </Text>
            {!!liberando.sugestoes?.length && (
              <Alert variant="light" title="Cadastros compatíveis">
                {liberando.sugestoes.map((s: any) => (
                  <Text key={s.id} size="xs">
                    {s.id} — {s.nome} ({fmtData(s.nascimento)}) mãe {s.mae ?? '-'}
                  </Text>
                ))}
              </Alert>
            )}
            <SelecaoRef entidade="paciente" rotulo="Vincular ao cadastro do paciente" valor={pessoaId} aoMudar={(v) => setPessoaId(v)} />
            <Button color="teal" leftSection={<IconCheck size={16} />} onClick={liberar} disabled={!pessoaId}>
              Confirmar conferência e liberar
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

const FUNCOES: [string, string][] = [
  ['agendamento', 'Agendamento de consultas'],
  ['fila', 'Fila de espera pública'],
  ['vacinas', 'Vacinas'],
  ['medicamentos', 'Medicamentos'],
  ['exames', 'Exames e resultados'],
  ['historico', 'Histórico de atendimentos'],
  ['unidades', 'Unidades e mapa'],
  ['mensagens', 'Mensagens'],
  ['teleatendimento', 'Teleatendimento'],
  ['dependentes', 'Inclusão de dependentes'],
  ['manifestacoes', 'Avaliação e ouvidoria'],
];

function Antecedencia({ rotulo, valor, aoMudar }: { rotulo: string; valor: any; aoMudar: (v: any) => void }) {
  return (
    <Group align="flex-end" gap="xs">
      <NumberInput label={rotulo} min={0} value={valor?.quantidade ?? 0} onChange={(v) => aoMudar({ ...valor, quantidade: Number(v) || 0 })} w={220} />
      <SegmentedControl value={valor?.unidade ?? 'HORAS'} onChange={(u) => aoMudar({ ...valor, unidade: u })} data={[{ value: 'HORAS', label: 'horas' }, { value: 'DIAS', label: 'dias' }]} />
    </Group>
  );
}

/** Configuração do aplicativo: funcionalidades, modo e antecedências do agendamento, avisos, agendas e medicamentos (TR 1.2.41.7.2, 1.2.41.7.3, 1.2.41.7.10, 1.2.41.9.3). */
function TelaConfiguracao() {
  useTituloJanela('Configuração do aplicativo do cidadão');
  const [cfg, setCfg] = useState<Record<string, any> | null>(null);
  const [busca, setBusca] = useState('');
  const { dados: agendas, recarregar: recarregarAgendas } = useCarregar<any[]>(() => api.get('/api/portal/agendas'), []);
  const { dados: meds, recarregar: recarregarMeds } = useCarregar<any[]>(() => api.get('/api/portal/medicamentos', { q: busca || undefined }), [busca]);
  useEffect(() => {
    api
      .get<Record<string, { valor: any }>>('/api/portal/configuracao')
      .then((r) => setCfg(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.valor]))))
      .catch(notificarErro);
  }, []);
  const set = (k: string, v: any) => setCfg((c) => ({ ...c!, [k]: v }));
  const salvar = () => api.put('/api/portal/configuracao', cfg).then(() => notificarOk('Configuração salva.')).catch(notificarErro);
  const salvarAgenda = (a: any, mud: any) =>
    api
      .put(`/api/portal/agendas/${a.id}`, { disponivelWeb: a.disponivel_web, webModo: a.web_modo, antecedenciaAgendarHoras: a.antecedencia_agendar_horas ?? 0, antecedenciaCancelarHoras: a.antecedencia_cancelar_horas ?? 0, ...mud })
      .then(recarregarAgendas)
      .catch(notificarErro);
  if (!cfg) return null;
  return (
    <Tabs defaultValue="geral">
      <Tabs.List>
        <Tabs.Tab value="geral">Geral</Tabs.Tab>
        <Tabs.Tab value="agendas">Agendas liberadas</Tabs.Tab>
        <Tabs.Tab value="medicamentos">Medicamentos exibidos</Tabs.Tab>
        <Tabs.Tab value="termos">Termos e privacidade</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="geral" pt="md">
        <Stack maw={760}>
          <Title order={5}>Funcionalidades disponíveis</Title>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {FUNCOES.map(([k, r]) => (
              <Switch key={k} label={r} checked={cfg['portal.funcionalidades']?.[k] !== false} onChange={(e) => set('portal.funcionalidades', { ...cfg['portal.funcionalidades'], [k]: e.currentTarget.checked })} />
            ))}
          </SimpleGrid>
          <Title order={5}>Agendamento</Title>
          <Select
            label="Forma do agendamento pelo aplicativo"
            data={[{ value: 'AGENDA', label: 'Conforme definido em cada agenda' }, { value: 'DIRETO', label: 'Direto (confirmado na hora)' }, { value: 'SOLICITACAO', label: 'Solicitação confirmada por operador da unidade' }]}
            value={cfg['portal.agendamento_modo']}
            onChange={(v) => set('portal.agendamento_modo', v)}
          />
          <Antecedencia rotulo="Antecedência mínima para agendar" valor={cfg['portal.antecedencia_agendamento']} aoMudar={(v) => set('portal.antecedencia_agendamento', v)} />
          <Antecedencia rotulo="Antecedência mínima para cancelar/transferir" valor={cfg['portal.antecedencia_cancelamento']} aoMudar={(v) => set('portal.antecedencia_cancelamento', v)} />
          <Switch label="Oferecer automaticamente a vaga cancelada ao primeiro da lista de espera" checked={!!cfg['portal.vaga_para_lista_espera']} onChange={(e) => set('portal.vaga_para_lista_espera', e.currentTarget.checked)} />
          <Text size="sm" fw={600}>
            Aviso de confirmação do agendamento
          </Text>
          <Group>
            {(['app', 'sms', 'email'] as const).map((m) => (
              <Switch key={m} label={m === 'app' ? 'Aplicativo' : m.toUpperCase()} checked={cfg['portal.aviso_meios']?.[m] !== false} onChange={(e) => set('portal.aviso_meios', { ...cfg['portal.aviso_meios'], [m]: e.currentTarget.checked })} />
            ))}
          </Group>
          <Title order={5}>Segurança e exibição</Title>
          <Group grow>
            <NumberInput label="Tentativas de login antes do bloqueio" min={1} max={10} value={cfg['portal.max_tentativas']} onChange={(v) => set('portal.max_tentativas', Number(v))} />
            <NumberInput label="Minutos de inatividade da sessão" min={5} value={cfg['portal.sessao_inatividade_min']} onChange={(v) => set('portal.sessao_inatividade_min', Number(v))} />
          </Group>
          <Switch label="Exibir a quantidade em estoque dos medicamentos" checked={!!cfg['portal.exibir_quantidade_estoque']} onChange={(e) => set('portal.exibir_quantidade_estoque', e.currentTarget.checked)} />
          <Switch label="Exibir a evolução clínica (SOAP) no histórico" checked={!!cfg['portal.exibir_evolucao_clinica']} onChange={(e) => set('portal.exibir_evolucao_clinica', e.currentTarget.checked)} />
          <TextInput label="Endereço base das videochamadas" value={cfg['portal.video_url_base'] ?? ''} onChange={(e) => set('portal.video_url_base', e.currentTarget.value)} />
          <Group>
            <Button onClick={salvar}>Salvar configuração</Button>
          </Group>
        </Stack>
      </Tabs.Panel>
      <Tabs.Panel value="agendas" pt="md">
        <Text size="sm" c="dimmed" mb="xs">
          Somente agendas de especialidades não reguladas podem ser liberadas para marcação pelo aplicativo.
        </Text>
        <Table striped fz="xs" withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Agenda</Table.Th>
              <Table.Th>Unidade</Table.Th>
              <Table.Th>No aplicativo</Table.Th>
              <Table.Th>Modo</Table.Th>
              <Table.Th>Antecedência agendar (h)</Table.Th>
              <Table.Th>Antecedência cancelar (h)</Table.Th>
              <Table.Th>Agendados pelo app</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(agendas ?? []).map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td>
                  {a.nome} {a.regulada && <Badge size="xs" color="red">regulada</Badge>}
                </Table.Td>
                <Table.Td>{a.unidade}</Table.Td>
                <Table.Td>
                  <Switch checked={a.disponivel_web} disabled={a.regulada} onChange={(e) => salvarAgenda(a, { disponivelWeb: e.currentTarget.checked })} />
                </Table.Td>
                <Table.Td>
                  <Select size="xs" w={170} data={[{ value: 'DIRETO', label: 'Direto' }, { value: 'SOLICITACAO', label: 'Confirmação da unidade' }]} value={a.web_modo} onChange={(v) => salvarAgenda(a, { webModo: v })} />
                </Table.Td>
                <Table.Td>
                  <NumberInput size="xs" w={90} min={0} defaultValue={a.antecedencia_agendar_horas ?? 0} onBlur={(e) => salvarAgenda(a, { antecedenciaAgendarHoras: Number(e.currentTarget.value) || 0 })} />
                </Table.Td>
                <Table.Td>
                  <NumberInput size="xs" w={90} min={0} defaultValue={a.antecedencia_cancelar_horas ?? 0} onBlur={(e) => salvarAgenda(a, { antecedenciaCancelarHoras: Number(e.currentTarget.value) || 0 })} />
                </Table.Td>
                <Table.Td>{a.agendamentos_app}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Tabs.Panel>
      <Tabs.Panel value="medicamentos" pt="md">
        <TextInput placeholder="Buscar medicamento" value={busca} onChange={(e) => setBusca(e.currentTarget.value)} mb="xs" maw={360} />
        <Table striped fz="xs" withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Medicamento</Table.Th>
              <Table.Th>Saldo na rede</Table.Th>
              <Table.Th>Exibir no aplicativo</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(meds ?? []).map((m) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  {m.nome} {m.concentracao}
                </Table.Td>
                <Table.Td>{Number(m.saldo).toLocaleString('pt-BR')}</Table.Td>
                <Table.Td>
                  <Switch checked={m.disponivel_app} onChange={(e) => api.put(`/api/portal/medicamentos/${m.id}`, { disponivelApp: e.currentTarget.checked }).then(recarregarMeds).catch(notificarErro)} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Tabs.Panel>
      <Tabs.Panel value="termos" pt="md">
        <Stack maw={760}>
          <TextInput label="Versão vigente dos termos" value={cfg['portal.versao_termos'] ?? ''} onChange={(e) => set('portal.versao_termos', e.currentTarget.value)} w={200} />
          <Textarea label="Termos de uso e política de privacidade (LGPD)" autosize minRows={8} value={cfg['portal.termos_uso'] ?? ''} onChange={(e) => set('portal.termos_uso', e.currentTarget.value)} />
          <Group>
            <Button onClick={salvar}>Salvar</Button>
          </Group>
        </Stack>
      </Tabs.Panel>
    </Tabs>
  );
}

/** Transferência, na unidade, de consulta agendada pelo aplicativo (TR 1.2.41.7.15). */
function ModalTransferir({ ag, aoFechar }: { ag: any; aoFechar: (ok: boolean) => void }) {
  const [data, setData] = useState(dayjs(ag.data).add(1, 'day').format('YYYY-MM-DD'));
  const [horarioId, setHorarioId] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const { dados } = useCarregar<any>(() => api.get('/api/agendamento/horarios', { data, especialidadeId: ag.especialidade_id }), [data]);
  const livres = (dados?.horarios ?? []).filter((h: any) => h.situacao === 'LIVRE' && h.tipo_vaga === 'ELETIVA');
  const transferir = async () => {
    try {
      await api.post(`/api/agendamento/${ag.id}/transferir`, { horarioId: Number(horarioId), motivo });
      notificarOk('Consulta transferida e paciente notificado.');
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  };
  return (
    <Modal opened onClose={() => aoFechar(false)} title={`Transferir consulta de ${ag.paciente}`}>
      <Stack>
        <TextInput type="date" label="Nova data" value={data} onChange={(e) => { setData(e.currentTarget.value); setHorarioId(null); }} />
        <Select label="Horário livre" data={livres.map((h: any) => ({ value: String(h.id), label: `${h.hora} — ${h.agenda}` }))} value={horarioId} onChange={setHorarioId} nothingFoundMessage="Sem horários livres" />
        <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
        <Button onClick={transferir} disabled={!horarioId || motivo.length < 3}>
          Transferir
        </Button>
      </Stack>
    </Modal>
  );
}

/** Agendamentos feitos pelo aplicativo: confirmação pela unidade quando parametrizado (TR 1.2.41.7.2) e transferência. */
function TelaAgendamentosApp() {
  useTituloJanela('Agendamentos pelo aplicativo');
  const [situacao, setSituacao] = useState('SOLICITADO');
  const { dados, recarregar } = useCarregar<any[]>(() => api.get('/api/portal/agendamentos', { situacao: situacao === 'TODOS' ? undefined : situacao }), [situacao]);
  const [transferindo, setTransferindo] = useState<any>(null);
  const confirmarAg = (a: any) => api.post(`/api/portal/agendamentos/${a.id}/confirmar`).then(() => (notificarOk('Agendamento confirmado e cidadão avisado.'), recarregar())).catch(notificarErro);
  const recusar = async (a: any) => {
    const m = await pedirTexto('Recusar solicitação', 'Motivo', { obrigatorio: true });
    if (m) await api.post(`/api/portal/agendamentos/${a.id}/recusar`, { motivo: m }).then(() => (notificarOk('Solicitação recusada e horário liberado.'), recarregar())).catch(notificarErro);
  };
  return (
    <Stack>
      <SegmentedControl w={420} value={situacao} onChange={setSituacao} data={[{ value: 'SOLICITADO', label: 'Aguardando confirmação' }, { value: 'AGENDADO', label: 'Agendados' }, { value: 'TODOS', label: 'Todos (30 dias)' }]} />
      <Table striped fz="xs" withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Data</Table.Th>
            <Table.Th>Paciente</Table.Th>
            <Table.Th>Especialidade / profissional</Table.Th>
            <Table.Th>Unidade</Table.Th>
            <Table.Th>Protocolo</Table.Th>
            <Table.Th>Situação</Table.Th>
            <Table.Th>Ações</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(dados ?? []).map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td>
                {fmtData(a.data)} {a.hora}
              </Table.Td>
              <Table.Td>
                {a.paciente}
                <Text size="10px" c="dimmed">
                  CNS {a.cns} · {a.celular}
                </Text>
              </Table.Td>
              <Table.Td>
                {a.especialidade} — {a.profissional}
              </Table.Td>
              <Table.Td>{a.unidade}</Table.Td>
              <Table.Td>{a.senha}</Table.Td>
              <Table.Td>
                <Situacao valor={a.situacao} />
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {a.situacao === 'SOLICITADO' && (
                    <>
                      <Button size="compact-xs" color="teal" onClick={() => confirmarAg(a)}>
                        Confirmar
                      </Button>
                      <Button size="compact-xs" color="red" variant="light" onClick={() => recusar(a)}>
                        Recusar
                      </Button>
                    </>
                  )}
                  {['AGENDADO', 'CONFIRMADO'].includes(a.situacao) && (
                    <Button size="compact-xs" variant="light" onClick={() => setTransferindo(a)}>
                      Transferir
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {transferindo && <ModalTransferir ag={transferindo} aoFechar={(ok) => { setTransferindo(null); if (ok) void recarregar(); }} />}
    </Stack>
  );
}

/** Teleatendimento: sala virtual (videochamada) e conversa com o paciente da teleconsulta. */
function TelaTeleatendimento() {
  useTituloJanela('Teleatendimento');
  const [data, setData] = useState(dayjs().format('YYYY-MM-DD'));
  const { dados, recarregar } = useCarregar<any[]>(() => api.get('/api/portal/teleatendimentos', { data }), [data]);
  const [sel, setSel] = useState<any>(null);
  const [sala, setSala] = useState<any>(null);
  const [texto, setTexto] = useState('');
  const carregarSala = async (a = sel) => a && setSala(await api.get(`/api/portal/teleatendimentos/${a.id}`));
  useIntervalo(() => void carregarSala(), 5000, !!sel);
  const enviar = async () => {
    await api.post(`/api/portal/teleatendimentos/${sel.id}/mensagens`, { texto }).catch(notificarErro);
    setTexto('');
    await carregarSala();
  };
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Stack>
        <TextInput type="date" label="Data" value={data} onChange={(e) => setData(e.currentTarget.value)} w={180} />
        {(dados ?? []).map((a) => (
          <Card key={a.id} withBorder padding="sm" onClick={() => { setSel(a); void carregarSala(a); }} style={{ cursor: 'pointer', borderColor: sel?.id === a.id ? 'var(--mantine-color-teal-6)' : undefined }}>
            <Group justify="space-between">
              <Text fw={600} size="sm">
                {a.hora} — {a.paciente}
              </Text>
              <Badge color={a.paciente_entrou_em ? 'teal' : 'gray'}>{a.paciente_entrou_em ? 'paciente na sala' : a.situacao_sala ?? 'sala não aberta'}</Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {a.especialidade} · {a.profissional} {a.mensagens_paciente ? `· ${a.mensagens_paciente} mensagem(ns)` : ''}
            </Text>
          </Card>
        ))}
        {!dados?.length && <Text c="dimmed">Nenhuma teleconsulta nesta data.</Text>}
      </Stack>
      {sala && (
        <Stack>
          <Group>
            <Button component="a" href={sala.sala.link_video} target="_blank" leftSection={<IconVideo size={16} />} color="teal">
              Abrir videochamada
            </Button>
            <Button variant="light" color="red" onClick={() => api.post(`/api/portal/teleatendimentos/${sel.id}/encerrar`).then(() => (carregarSala(), recarregar())).catch(notificarErro)}>
              Encerrar sala
            </Button>
          </Group>
          <Card withBorder mah={380} style={{ overflow: 'auto' }}>
            <Stack gap={6}>
              {sala.mensagens.map((m: any) => (
                <Text key={m.id} size="sm" ta={m.autor === 'PROFISSIONAL' ? 'right' : 'left'}>
                  <b>{m.autor === 'PROFISSIONAL' ? (m.operador ?? 'Profissional') : 'Paciente'}:</b> {m.texto}{' '}
                  <Text span size="10px" c="dimmed">
                    {fmtDataHora(m.data_hora)}
                  </Text>
                </Text>
              ))}
            </Stack>
          </Card>
          <Group wrap="nowrap">
            <TextInput style={{ flex: 1 }} value={texto} onChange={(e) => setTexto(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && texto && enviar()} placeholder="Mensagem ao paciente" />
            <Button onClick={enviar} disabled={!texto}>
              <IconSend size={16} />
            </Button>
          </Group>
        </Stack>
      )}
    </SimpleGrid>
  );
}

registrarTela({ id: 'portal-contas', titulo: 'Acesso ao aplicativo do cidadão', menu: 'Atendimento remoto', padrao: '/t/portal/contas', permissao: 'portal_conta:consultar', modulo: 'APP', palavras: ['aplicativo', 'cidadão', 'liberar acesso', 'portal'], ordem: 1, render: () => <TelaContas /> });
registrarTela({ id: 'portal-agendamentos', titulo: 'Agendamentos pelo aplicativo', menu: 'Atendimento remoto', padrao: '/t/portal/agendamentos', permissao: 'agendamento:consultar', modulo: 'APP', palavras: ['aplicativo', 'confirmar agendamento'], ordem: 2, render: () => <TelaAgendamentosApp /> });
registrarTela({ id: 'portal-teleatendimento', titulo: 'Teleatendimento', menu: 'Atendimento remoto', padrao: '/t/portal/teleatendimento', permissao: 'portal_teleatendimento:consultar', modulo: 'APP', palavras: ['teleconsulta', 'vídeo', 'remoto'], ordem: 3, render: () => <TelaTeleatendimento /> });
registrarTela({ id: 'portal-configuracao', titulo: 'Configuração do aplicativo', menu: 'Atendimento remoto', padrao: '/t/portal/configuracao', permissao: 'portal_configuracao:executar', modulo: 'APP', palavras: ['aplicativo', 'parâmetros', 'antecedência'], ordem: 4, render: () => <TelaConfiguracao /> });
registrarMenuRelatorios('APP', 'Atendimento remoto', 'portal_conta:exportar');
