// Agendamento pelo aplicativo (TR 1.2.41.7): marcação de consultas não reguladas nas agendas liberadas,
// listas de agendadas, em espera, bloqueadas, canceladas e realizadas, cancelamento, transferência e fila pública.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Chip, Group, Modal, ScrollArea, SegmentedControl, Select, SimpleGrid, Stack, Switch, Tabs, Text, Textarea, Title, UnstyledButton } from '@mantine/core';
import { IconCalendarPlus, IconCalendarX, IconClock, IconMapPin, IconSwitchHorizontal, IconUsers, IconVideo } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api, ErroApi } from '@/api';
import { avisoErro, avisoOk, Cartao, diaSemana, Estado, Etiqueta, fmtData, fmtDataHora, Secao, useCidadao, useDados } from './comum';

function DadosAgendamento({ a }: { a: any }) {
  return (
    <Stack gap={2}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text fw={600}>{a.especialidade ?? a.procedimentos ?? 'Consulta'}</Text>
        <Etiqueta valor={a.situacao} />
      </Group>
      <Group gap={6}>
        <IconClock size={14} />
        <Text size="sm">
          {fmtData(a.data)} ({diaSemana(a.data)}) {a.hora ? `às ${a.hora}` : '(ordem de chegada)'}
        </Text>
      </Group>
      {a.profissional && <Text size="sm">Profissional: {a.profissional}</Text>}
      <Group gap={6} wrap="nowrap" align="flex-start">
        <IconMapPin size={14} style={{ marginTop: 3 }} />
        <Text size="sm">
          {a.unidade}
          {a.unidade_endereco ? ` — ${a.unidade_endereco}` : ''}
          {a.local ? ` (${a.local})` : ''}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        Protocolo {a.senha} · {a.tipo === 'TELECONSULTA' || a.tipo_agenda === 'TELECONSULTA' ? 'Teleconsulta' : a.tipo === 'EXAME' ? 'Exame' : 'Consulta'} · agendado em {fmtDataHora(a.criado_em)}
        {a.origem === 'APLICATIVO' ? ' pelo aplicativo' : ''}
      </Text>
      {a.preparo && (
        <Alert color="yellow" variant="light" p="xs" title="Preparo / orientações">
          <Text size="xs" style={{ whiteSpace: 'pre-line' }}>
            {a.preparo}
          </Text>
        </Alert>
      )}
    </Stack>
  );
}

/** Escolha de horário livre de uma agenda (horários disponíveis, TR 1.2.41.7.8). */
function EscolhaHorario({ agendaId, aoEscolher, selecionado }: { agendaId: number; aoEscolher: (h: any) => void; selecionado?: number | null }) {
  const { dados, erro, carregando } = useDados<any[]>(`/api/cidadao/horarios?agendaId=${agendaId}`, [agendaId]);
  const dias = useMemo(() => [...new Set((dados ?? []).map((h) => h.data))], [dados]);
  const [dia, setDia] = useState<string | null>(null);
  const diaAtual = dia ?? dias[0] ?? null;
  return (
    <Estado erro={erro} carregando={carregando} vazio={!dados?.length}>
      <Stack gap="xs">
        <ScrollArea type="auto" offsetScrollbars>
          <Group gap={6} wrap="nowrap">
            {dias.slice(0, 30).map((d) => (
              <UnstyledButton key={d} onClick={() => setDia(d)}>
                <Stack gap={0} align="center" px="xs" py={4} style={{ borderRadius: 8, minWidth: 56, background: d === diaAtual ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-gray-1)', color: d === diaAtual ? 'white' : undefined }}>
                  <Text size="xs">{dayjs(d).format('ddd')}</Text>
                  <Text fw={700}>{dayjs(d).format('DD')}</Text>
                  <Text size="xs">{dayjs(d).format('MMM')}</Text>
                </Stack>
              </UnstyledButton>
            ))}
          </Group>
        </ScrollArea>
        <SimpleGrid cols={4} spacing={6}>
          {(dados ?? [])
            .filter((h) => h.data === diaAtual)
            .map((h) => (
              <Button key={h.id} size="xs" variant={selecionado === h.id ? 'filled' : 'light'} onClick={() => aoEscolher(h)}>
                {h.hora}
              </Button>
            ))}
        </SimpleGrid>
      </Stack>
    </Estado>
  );
}

/** Nova marcação: especialidade → profissional/agenda → horário → confirmação (TR 1.2.41.7.1, 1.2.41.7.5 a 1.2.41.7.8). */
export function NovoAgendamento() {
  const { pessoa, sessao } = useCidadao();
  const navegar = useNavigate();
  const [tipo, setTipo] = useState<string>('');
  const { dados, erro, carregando } = useDados<any>(pessoa ? `/api/cidadao/ofertas?pessoaId=${pessoa.id}${tipo ? `&tipo=${tipo}` : ''}` : null, [pessoa?.id, tipo]);
  const [especialidadeId, setEspecialidadeId] = useState<string | null>(null);
  const [agenda, setAgenda] = useState<any>(null);
  const [horario, setHorario] = useState<any>(null);
  const [enviando, setEnviando] = useState(false);
  const agendas = (dados?.agendas ?? []).filter((a: any) => !especialidadeId || String(a.especialidade_id) === especialidadeId);
  const confirmar = async (confirmarAvisos = false) => {
    setEnviando(true);
    try {
      const r = await api.post('/api/cidadao/agendamentos', { pessoaId: pessoa!.id, horarioId: horario.id, confirmarAvisos });
      avisoOk(r.modo === 'SOLICITACAO' ? `Solicitação enviada (protocolo ${r.senha}). A unidade confirmará o horário.` : `Agendamento confirmado! Protocolo ${r.senha}.`);
      navegar('/cidadao/agendamentos');
    } catch (e) {
      if (e instanceof ErroApi && e.status === 409 && e.detalhes?.exigeConfirmacao) {
        if (window.confirm(`${e.message}\n\nDeseja agendar mesmo assim?`)) return confirmar(true);
      } else avisoErro(e);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Stack gap="md">
      <Title order={3}>Agendar consulta</Title>
      {sessao && sessao.membros.length > 1 && (
        <Alert variant="light" icon={<IconUsers size={16} />} p="xs">
          Agendando para <b>{pessoa?.nome}</b>. Troque o integrante no topo da tela.
        </Alert>
      )}
      <SegmentedControl value={tipo} onChange={(v) => { setTipo(v); setAgenda(null); setHorario(null); setEspecialidadeId(null); }} data={[{ value: '', label: 'Todas' }, { value: 'CONSULTA', label: 'Consultas' }, { value: 'TELECONSULTA', label: 'Teleconsulta' }, { value: 'EXAME', label: 'Exames' }]} fullWidth />
      <Estado erro={erro} carregando={carregando} vazio={!dados?.agendas?.length}>
        <Select
          label="1. Especialidade"
          placeholder="Escolha a especialidade"
          data={(dados?.especialidades ?? []).map((e: any) => ({ value: String(e.id), label: e.nome }))}
          value={especialidadeId}
          onChange={(v) => { setEspecialidadeId(v); setAgenda(null); setHorario(null); }}
          searchable
          clearable
        />
        <Text fw={600} size="sm">
          2. Profissional e local
        </Text>
        <Stack gap={6}>
          {agendas.map((a: any) => (
            <Cartao key={a.id} onClick={() => { setAgenda(a); setHorario(null); }} cor={agenda?.id === a.id ? 'blue' : undefined}>
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={0}>
                  <Text fw={600} size="sm">
                    {a.profissional ?? a.nome}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {a.especialidade} · {a.unidade}
                  </Text>
                  <Text size="xs">
                    {a.vagas > 0 ? `${a.vagas} horários livres · a partir de ${fmtData(a.primeira_data)}` : 'Sem horários livres no momento'}
                    {a.web_modo === 'SOLICITACAO' ? ' · confirmado pela unidade' : ''}
                  </Text>
                </Stack>
                {a.tipo === 'TELECONSULTA' && <IconVideo size={18} />}
              </Group>
            </Cartao>
          ))}
        </Stack>
        {agenda && (
          <>
            <Text fw={600} size="sm">
              3. Data e horário
            </Text>
            <EscolhaHorario agendaId={agenda.id} aoEscolher={setHorario} selecionado={horario?.id} />
          </>
        )}
        {horario && (
          <Cartao cor="teal">
            <Text size="sm">
              <b>{pessoa?.nome}</b> — {agenda.especialidade} com {agenda.profissional} em {fmtData(horario.data)} às {horario.hora}, {agenda.unidade}.
            </Text>
            <Button mt="sm" fullWidth onClick={() => confirmar(false)} loading={enviando} leftSection={<IconCalendarPlus size={16} />}>
              Confirmar agendamento
            </Button>
          </Cartao>
        )}
      </Estado>
    </Stack>
  );
}

function ModalCancelar({ ag, aoFechar }: { ag: any; aoFechar: (ok: boolean) => void }) {
  const [opcao, setOpcao] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState('');
  const motivo = [opcao, detalhe.trim()].filter(Boolean).join(' — ');
  const [enviando, setEnviando] = useState(false);
  const cancelar = async () => {
    setEnviando(true);
    try {
      const r = await api.post(`/api/cidadao/agendamentos/${ag.id}/cancelar`, { motivo });
      avisoOk(r.vagaReaproveitada ? 'Consulta cancelada. A vaga foi repassada a outro paciente da lista de espera.' : 'Consulta cancelada e vaga liberada para outro paciente.');
      aoFechar(true);
    } catch (e) {
      avisoErro(e);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Modal opened onClose={() => aoFechar(false)} title="Cancelar consulta" centered>
      <Stack>
        <DadosAgendamento a={ag} />
        <Select label="Motivo" data={['Não poderei comparecer', 'Já fui atendido(a)', 'Problema de saúde', 'Conflito de horário', 'Outro']} value={opcao} onChange={setOpcao} />
        <Textarea label="Detalhe (opcional)" value={detalhe} onChange={(e) => setDetalhe(e.currentTarget.value)} />
        <Button color="red" onClick={cancelar} loading={enviando} disabled={motivo.length < 3}>
          Cancelar consulta
        </Button>
      </Stack>
    </Modal>
  );
}

/** Transferência para outro horário da mesma especialidade (TR 1.2.41.7.16). */
function ModalTransferir({ ag, aoFechar }: { ag: any; aoFechar: (ok: boolean) => void }) {
  const { dados } = useDados<any>(`/api/cidadao/ofertas?pessoaId=${ag.paciente_id}`);
  const agendas = (dados?.agendas ?? []).filter((a: any) => a.especialidade === ag.especialidade);
  const [agendaId, setAgendaId] = useState<number | null>(null);
  const [horario, setHorario] = useState<any>(null);
  const [enviando, setEnviando] = useState(false);
  const transferir = async () => {
    setEnviando(true);
    try {
      const r = await api.post(`/api/cidadao/agendamentos/${ag.id}/transferir`, { horarioId: horario.id, motivo: 'Transferência solicitada pelo cidadão' });
      avisoOk(`Consulta transferida. Novo protocolo ${r.senha}.`);
      aoFechar(true);
    } catch (e) {
      avisoErro(e);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Modal opened onClose={() => aoFechar(false)} title="Transferir consulta" centered size="lg">
      <Stack>
        <Text size="sm">
          Atual: {fmtData(ag.data)} às {ag.hora} — {ag.profissional}
        </Text>
        <Select label="Profissional / local" data={agendas.map((a: any) => ({ value: String(a.id), label: `${a.profissional ?? a.nome} — ${a.unidade}` }))} value={agendaId ? String(agendaId) : null} onChange={(v) => { setAgendaId(v ? Number(v) : null); setHorario(null); }} />
        {agendaId && <EscolhaHorario agendaId={agendaId} aoEscolher={setHorario} selecionado={horario?.id} />}
        <Button onClick={transferir} loading={enviando} disabled={!horario} leftSection={<IconSwitchHorizontal size={16} />}>
          Transferir para {horario ? `${fmtData(horario.data)} às ${horario.hora}` : '...'}
        </Button>
      </Stack>
    </Modal>
  );
}

export function MeusAgendamentos() {
  const { pessoa } = useCidadao();
  const navegar = useNavigate();
  const { dados, erro, carregando, recarregar } = useDados<any>(pessoa ? `/api/cidadao/agendamentos?pessoaId=${pessoa.id}` : null, [pessoa?.id]);
  const [cancelando, setCancelando] = useState<any>(null);
  const [transferindo, setTransferindo] = useState<any>(null);
  const fechar = (ok: boolean) => {
    setCancelando(null);
    setTransferindo(null);
    if (ok) void recarregar();
  };
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Consultas</Title>
        <Button leftSection={<IconCalendarPlus size={16} />} onClick={() => navegar('/cidadao/agendar')}>
          Agendar
        </Button>
      </Group>
      <Estado erro={erro} carregando={carregando}>
        {dados && (
          <Tabs defaultValue="agendadas" variant="pills" radius="xl">
            <ScrollArea type="never">
              <Tabs.List style={{ flexWrap: 'nowrap' }}>
                <Tabs.Tab value="agendadas" rightSection={<Badge size="xs" circle>{dados.agendadas.length}</Badge>}>Agendadas</Tabs.Tab>
                <Tabs.Tab value="espera" rightSection={<Badge size="xs" circle>{dados.espera.length}</Badge>}>Em espera</Tabs.Tab>
                <Tabs.Tab value="bloqueadas">Bloqueadas</Tabs.Tab>
                <Tabs.Tab value="canceladas">Canceladas</Tabs.Tab>
                <Tabs.Tab value="realizadas">Realizadas</Tabs.Tab>
              </Tabs.List>
            </ScrollArea>
            <Tabs.Panel value="agendadas" pt="sm">
              <Stack gap="xs">
                {!dados.agendadas.length && <Estado vazio />}
                {dados.agendadas.map((a: any) => (
                  <Cartao key={a.id} cor="blue">
                    <DadosAgendamento a={a} />
                    <Group mt="xs" gap="xs">
                      {(a.tipo === 'TELECONSULTA' || a.tipo_agenda === 'TELECONSULTA') && (
                        <Button size="xs" color="teal" leftSection={<IconVideo size={14} />} onClick={() => navegar(`/cidadao/teleatendimento/${a.id}`)}>
                          Sala virtual
                        </Button>
                      )}
                      <Button size="xs" variant="light" leftSection={<IconSwitchHorizontal size={14} />} onClick={() => setTransferindo(a)} disabled={a.situacao === 'SOLICITADO'}>
                        Transferir
                      </Button>
                      <Button size="xs" variant="light" color="red" leftSection={<IconCalendarX size={14} />} onClick={() => setCancelando(a)}>
                        Cancelar
                      </Button>
                    </Group>
                  </Cartao>
                ))}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="espera" pt="sm">
              <Stack gap="xs">
                {!dados.espera.length && <Estado vazio />}
                {dados.espera.map((l: any) => (
                  <Cartao key={l.id} cor="yellow">
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={600}>{l.especialidade ?? l.procedimento}</Text>
                      <Badge size="lg" variant="filled">
                        {l.posicao}º de {l.total_fila}
                      </Badge>
                    </Group>
                    <Text size="sm">Incluído em {fmtDataHora(l.incluido_em)}{l.unidade_solicitante ? ` por ${l.unidade_solicitante}` : ''}</Text>
                    <Text size="xs" c="dimmed">
                      Prioridade {l.prioridade === 'VERMELHO' ? 'emergência' : l.prioridade === 'AMARELO' ? 'urgente' : 'eletiva'}
                      {l.regulada ? ' · fila da regulação' : ''}
                    </Text>
                  </Cartao>
                ))}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="bloqueadas" pt="sm">
              <Stack gap="xs">
                {!dados.bloqueadas.length && <Estado vazio />}
                {dados.bloqueadas.map((b: any, i: number) => (
                  <Cartao key={i} cor="red">
                    {b.origem_bloqueio === 'AGENDA' ? <DadosAgendamento a={b} /> : <Text fw={600}>{b.especialidade ?? b.procedimento} (lista de espera)</Text>}
                    <Alert color="red" variant="light" p="xs" mt="xs">
                      Motivo do bloqueio: {b.motivo_bloqueio ?? 'não informado'}
                    </Alert>
                  </Cartao>
                ))}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="canceladas" pt="sm">
              <Stack gap="xs">
                {!dados.canceladas.length && <Estado vazio />}
                {dados.canceladas.map((a: any) => (
                  <Cartao key={a.id} cor="gray">
                    <DadosAgendamento a={a} />
                    <Text size="xs" mt={4}>
                      {a.situacao === 'TRANSFERIDO' ? 'Transferido' : 'Cancelado'} em {fmtDataHora(a.cancelado_em)} por <b>{a.responsavel_cancelamento}</b>
                    </Text>
                    {a.motivo && (
                      <Text size="xs" c="dimmed">
                        Motivo: {a.motivo}
                      </Text>
                    )}
                  </Cartao>
                ))}
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="realizadas" pt="sm">
              <Stack gap="xs">
                {!dados.efetuadas.length && <Estado vazio />}
                {dados.efetuadas.map((a: any) => (
                  <Cartao key={a.id} cor="green">
                    <DadosAgendamento a={a} />
                    <Button size="xs" variant="subtle" mt={4} onClick={() => navegar(`/cidadao/ouvidoria?agendamento=${a.id}`)}>
                      Avaliar atendimento
                    </Button>
                  </Cartao>
                ))}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        )}
      </Estado>
      {cancelando && <ModalCancelar ag={cancelando} aoFechar={fechar} />}
      {transferindo && <ModalTransferir ag={transferindo} aoFechar={fechar} />}
    </Stack>
  );
}

/** Fila de espera pública por especialidade/exame, com opção de ver só os meus (TR 1.2.41.7.18). */
export function FilaPublica() {
  const { sessao } = useCidadao();
  const { dados, erro, carregando } = useDados<any>('/api/cidadao/fila-publica');
  const [sel, setSel] = useState<string | null>(null);
  const [meus, setMeus] = useState(false);
  const [tipo, id] = (sel ?? '').split(':');
  const fila = useDados<any>(sel ? `/api/cidadao/fila-publica?${tipo === 'E' ? 'especialidadeId' : 'procedimentoId'}=${id}&somenteMeus=${meus}` : null, [sel, meus]);
  return (
    <Stack gap="md">
      <Title order={3}>Fila de espera pública</Title>
      <Text size="sm" c="dimmed">
        Consulte a posição na fila das consultas especializadas e exames do município. Os pacientes são identificados apenas pelas iniciais.
      </Text>
      <Estado erro={erro} carregando={carregando} vazio={!dados?.resumo?.length}>
        <Select
          label="Especialidade ou exame"
          placeholder="Selecione"
          searchable
          data={[
            { group: 'Especialidades', items: (dados?.resumo ?? []).filter((r: any) => r.tipo === 'E').map((r: any) => ({ value: `E:${r.id}`, label: `${r.nome} (${r.aguardando})` })) },
            { group: 'Exames e procedimentos', items: (dados?.resumo ?? []).filter((r: any) => r.tipo === 'P').map((r: any) => ({ value: `P:${r.id}`, label: `${r.nome} (${r.aguardando})` })) },
          ]}
          value={sel}
          onChange={setSel}
        />
        {sessao && <Switch label="Mostrar somente meus agendamentos e da minha família" checked={meus} onChange={(e) => setMeus(e.currentTarget.checked)} />}
      </Estado>
      {sel && (
        <Estado erro={fila.erro} carregando={fila.carregando} vazio={!fila.dados?.fila?.length}>
          <Stack gap={4}>
            {(fila.dados?.fila ?? []).map((f: any) => (
              <Group key={f.id} justify="space-between" p="xs" style={{ borderRadius: 8, background: f.meu ? 'var(--mantine-color-teal-0)' : 'var(--mantine-color-gray-0)' }}>
                <Group gap="sm">
                  <Badge variant={f.meu ? 'filled' : 'light'} color={f.meu ? 'teal' : 'blue'} size="lg">
                    {f.posicao}º
                  </Badge>
                  <Stack gap={0}>
                    <Text size="sm" fw={f.meu ? 700 : 400}>
                      {f.meu ? f.nome : f.iniciais}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {f.cns_mascarado ?? ''} · desde {fmtData(f.incluido_em)}
                    </Text>
                  </Stack>
                </Group>
                {f.prioridade !== 'AZUL' && <Chip size="xs" checked color={f.prioridade === 'VERMELHO' ? 'red' : 'yellow'}>{f.prioridade === 'VERMELHO' ? 'Emergência' : 'Urgente'}</Chip>}
              </Group>
            ))}
          </Stack>
        </Estado>
      )}
    </Stack>
  );
}

export { DadosAgendamento };
