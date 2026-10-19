// Ambulatório de saúde mental - CAPS (TR 1.2.46): painel do usuário com atendimentos e medicamentos
// conforme o nível de acesso, acolhimento, atendimentos em programas e oficinas, PTS, sessões de
// oficina com lista de presença e agenda dos programas.
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Modal, Paper, SimpleGrid, Stack, Table, Tabs, Text, Textarea, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconLock, IconPlus, IconUsersGroup } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useAuth } from '@/auth/Auth';
import { fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, TabelaSimples } from '@/componentes/comum';
import { BuscaPaciente, CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { Formulario } from '@/genericos/Formulario';
import { useTituloJanela } from '@/shell/Janelas';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const TIPOS: Record<string, string> = { INDIVIDUAL: 'Individual', GRUPO: 'Grupo / oficina', FAMILIAR: 'Familiar', DOMICILIAR: 'Domiciliar', CRISE: 'Crise', ARTICULACAO: 'Articulação de rede', REABILITACAO: 'Reabilitação' };
const COR_RISCO: Record<string, string> = { BAIXO: 'green', MODERADO: 'yellow', ALTO: 'red' };

function Sigiloso() {
  return (
    <Group gap={4}>
      <IconLock size={12} />
      <Text size="xs" c="dimmed">
        restrito
      </Text>
    </Group>
  );
}

function TelaCaps({ pacienteInicial }: { pacienteInicial?: number }) {
  useTituloJanela('Saúde mental - usuário');
  const { eu } = useAuth();
  const [pacienteId, setPacienteId] = useState<number | null>(pacienteInicial ?? null);
  const { paciente, recarregar } = usePaciente(pacienteId, 'caps');
  const [painel, setPainel] = useState<any>(null);
  const [form, setForm] = useState<null | { entidade: string; titulo: string }>(null);
  const carregar = () => pacienteId && api.get(`/api/caps/pacientes/${pacienteId}/painel`).then(setPainel).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [pacienteId]);
  if (!pacienteId || !paciente)
    return (
      <Stack p="md">
        <Title order={4}>Saúde mental (CAPS) - selecione o usuário</Title>
        <BuscaPaciente aoSelecionar={setPacienteId} />
      </Stack>
    );
  const iniciais = { paciente_id: pacienteId, unidade_id: eu?.unidadeAtual, profissional_id: eu?.profissionalId, profissional_referencia_id: eu?.profissionalId, data: dayjs().format('YYYY-MM-DD'), data_inicio: dayjs().format('YYYY-MM-DD'), data_elaboracao: dayjs().format('YYYY-MM-DD') };
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Saúde mental (CAPS)</Title>
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => setPacienteId(null)}>
            Trocar usuário
          </Button>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setForm({ entidade: 'caps_acolhimento', titulo: 'Acolhimento' })}>
            Acolhimento
          </Button>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setForm({ entidade: 'caps_atendimento', titulo: 'Atendimento' })}>
            Atendimento
          </Button>
          <Button size="xs" variant="light" onClick={() => setForm({ entidade: 'caps_inscricao', titulo: 'Inscrição em programa / oficina' })}>
            Inscrever em programa
          </Button>
          <Button size="xs" variant="light" onClick={() => setForm({ entidade: 'caps_pts', titulo: 'Projeto terapêutico singular' })}>
            Novo PTS
          </Button>
        </Group>
      </Group>
      <CabecalhoPaciente paciente={paciente} compacto aoAtualizar={recarregar} />
      {painel && !painel.acesso.sigilo && (
        <Alert color="gray" icon={<IconLock size={16} />}>
          Seu perfil não possui acesso aos dados sigilosos (evolução, escuta e diagnóstico). Os atendimentos são exibidos sem o conteúdo clínico.
        </Alert>
      )}
      <Tabs defaultValue="atendimentos">
        <Tabs.List>
          <Tabs.Tab value="atendimentos">Atendimentos CAPS ({painel?.atendimentos?.length ?? 0})</Tabs.Tab>
          <Tabs.Tab value="acolhimentos">Acolhimentos</Tabs.Tab>
          <Tabs.Tab value="programas">Programas e oficinas</Tabs.Tab>
          <Tabs.Tab value="pts">PTS</Tabs.Tab>
          <Tabs.Tab value="medicamentos">Medicamentos prescritos</Tabs.Tab>
          <Tabs.Tab value="rede">Atendimentos na rede</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="atendimentos" pt="xs">
          <TabelaSimples
            linhas={painel?.atendimentos ?? []}
            colunas={[
              { titulo: 'Data', valor: (a: any) => `${fmtData(a.data)} ${a.hora ?? ''}` },
              { titulo: 'Tipo', valor: (a: any) => TIPOS[a.tipo] ?? a.tipo },
              { titulo: 'Programa / oficina', valor: (a: any) => [a.programa, a.oficina].filter(Boolean).join(' · ') },
              { titulo: 'Profissional', valor: (a: any) => a.profissional },
              { titulo: 'Procedimento', valor: (a: any) => <Text size="xs">{a.procedimento}</Text> },
              { titulo: 'Evolução', valor: (a: any) => (painel.acesso.sigilo ? <Text size="xs">{a.evolucao}</Text> : <Sigiloso />) },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="acolhimentos" pt="xs">
          <TabelaSimples
            linhas={painel?.acolhimentos ?? []}
            colunas={[
              { titulo: 'Data', valor: (a: any) => fmtDataHora(a.data_hora) },
              { titulo: 'Chegada', valor: (a: any) => a.demanda },
              { titulo: 'Motivo', valor: (a: any) => a.motivo },
              { titulo: 'Risco', valor: (a: any) => a.risco && <Badge color={COR_RISCO[a.risco]}>{a.risco}</Badge> },
              { titulo: 'Conduta', valor: (a: any) => a.conduta },
              { titulo: 'Escuta', valor: (a: any) => (painel.acesso.sigilo ? <Text size="xs">{a.escuta}</Text> : <Sigiloso />) },
              { titulo: 'Profissional', valor: (a: any) => a.profissional },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="programas" pt="xs">
          <TabelaSimples
            linhas={painel?.inscricoes ?? []}
            colunas={[
              { titulo: 'Programa', valor: (i: any) => i.programa },
              { titulo: 'Oficina', valor: (i: any) => i.oficina ?? '-' },
              { titulo: 'Desde', valor: (i: any) => fmtData(i.data_inicio) },
              { titulo: 'Saída', valor: (i: any) => fmtData(i.data_fim) },
              { titulo: 'Situação', valor: (i: any) => <Badge variant="light">{i.situacao}</Badge> },
              { titulo: 'Referência', valor: (i: any) => i.referencia },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="pts" pt="xs">
          <TabelaSimples
            linhas={painel?.pts ?? []}
            colunas={[
              { titulo: 'Elaborado', valor: (p: any) => fmtData(p.data_elaboracao) },
              { titulo: 'Reavaliação', valor: (p: any) => fmtData(p.data_reavaliacao) },
              { titulo: 'Situação', valor: (p: any) => p.situacao },
              { titulo: 'Referência', valor: (p: any) => p.referencia },
              { titulo: 'Objetivos', valor: (p: any) => <Text size="xs">{p.objetivos}</Text> },
              { titulo: 'Intervenções', valor: (p: any) => <Text size="xs">{p.intervencoes}</Text> },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="medicamentos" pt="xs">
          {painel && !painel.acesso.medicamentos ? (
            <Alert color="gray" icon={<IconLock size={16} />}>
              Perfil sem acesso aos medicamentos prescritos.
            </Alert>
          ) : (
            <TabelaSimples
              linhas={painel?.prescritos ?? []}
              colunas={[
                { titulo: 'Data', valor: (m: any) => fmtData(m.data) },
                { titulo: 'Receita', valor: (m: any) => `${m.numero} (${m.tipo_receita})` },
                { titulo: 'Medicamento', valor: (m: any) => m.medicamento },
                { titulo: 'Posologia', valor: (m: any) => m.posologia },
                { titulo: 'Qtd. / dispensada', valor: (m: any) => `${Number(m.quantidade ?? 0)} / ${Number(m.quantidade_dispensada ?? 0)}` },
                { titulo: 'Uso contínuo', valor: (m: any) => (m.uso_continuo ? 'Sim' : 'Não') },
                { titulo: 'Prescritor', valor: (m: any) => m.prescritor },
              ]}
            />
          )}
        </Tabs.Panel>
        <Tabs.Panel value="rede" pt="xs">
          <TabelaSimples
            linhas={painel?.outros ?? []}
            colunas={[
              { titulo: 'Data', valor: (a: any) => fmtDataHora(a.entrada_em) },
              { titulo: 'Unidade', valor: (a: any) => a.unidade },
              { titulo: 'Especialidade', valor: (a: any) => a.especialidade },
              { titulo: 'Profissional', valor: (a: any) => a.profissional },
              { titulo: 'CID / avaliação', valor: (a: any) => (painel.acesso.sigilo ? <Text size="xs">{[a.cid, a.avaliacao].filter(Boolean).join(' - ')}</Text> : <Sigiloso />) },
            ]}
          />
        </Tabs.Panel>
      </Tabs>
      {form && (
        <Modal opened onClose={() => setForm(null)} title={form.titulo} size="70rem">
          <Formulario
            entidade={form.entidade}
            emModal
            iniciais={iniciais}
            aoSalvar={() => {
              setForm(null);
              notificarOk(`${form.titulo} registrado.`);
              void carregar();
            }}
            aoCancelar={() => setForm(null)}
          />
        </Modal>
      )}
    </Stack>
  );
}

function TelaSessaoOficina() {
  useTituloJanela('Sessão de oficina / grupo');
  const { eu } = useAuth();
  const [oficinaId, setOficinaId] = useState<number | null>(null);
  const [profissionalId, setProfissionalId] = useState<number | null>(eu?.profissionalId ?? null);
  const [data, setData] = useState<Date | null>(new Date());
  const [participantes, setParticipantes] = useState<any[]>([]);
  const [presentes, setPresentes] = useState<number[]>([]);
  const [evolucao, setEvolucao] = useState('');
  useEffect(() => {
    if (!oficinaId) return setParticipantes([]);
    api
      .get(`/api/caps/oficinas/${oficinaId}/participantes`)
      .then((r) => (setParticipantes(r), setPresentes(r.map((p: any) => p.paciente_id))))
      .catch(notificarErro);
  }, [oficinaId]);
  async function registrar() {
    try {
      const r = await api.post(`/api/caps/oficinas/${oficinaId}/sessao`, { data: dayjs(data).format('YYYY-MM-DD'), profissionalId, evolucaoGrupo: evolucao || null, participantes: presentes.map((pacienteId) => ({ pacienteId })) });
      notificarOk(`${r.registrados} atendimento(s) em grupo registrado(s); ações lançadas no RAAS psicossocial.`);
      setEvolucao('');
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm" maw={900}>
      <Title order={4}>Sessão de oficina / atendimento em grupo</Title>
      <Paper withBorder p="sm">
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          <SelecaoRef entidade="caps_oficina" rotulo="Oficina" obrigatorio valor={oficinaId} aoMudar={setOficinaId} />
          <SelecaoRef entidade="profissional" rotulo="Profissional" obrigatorio valor={profissionalId} aoMudar={setProfissionalId} />
          <DateInput label="Data" valueFormat="DD/MM/YYYY" value={data} onChange={setData} maxDate={new Date()} />
        </SimpleGrid>
      </Paper>
      <Paper withBorder p="sm">
        <Text size="sm" fw={600} mb="xs">
          Lista de presença ({presentes.length}/{participantes.length})
        </Text>
        <Table fz="sm">
          <Table.Tbody>
            {participantes.map((p) => (
              <Table.Tr key={p.paciente_id}>
                <Table.Td w={40}>
                  <Checkbox checked={presentes.includes(p.paciente_id)} onChange={(e) => setPresentes(e.currentTarget.checked ? [...presentes, p.paciente_id] : presentes.filter((x) => x !== p.paciente_id))} />
                </Table.Td>
                <Table.Td>{p.nome}</Table.Td>
                <Table.Td>{p.cns}</Table.Td>
                <Table.Td>desde {fmtData(p.data_inicio)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!participantes.length && (
          <Text size="sm" c="dimmed">
            Selecione uma oficina com usuários inscritos.
          </Text>
        )}
        <Textarea mt="sm" label="Evolução do grupo" autosize minRows={3} value={evolucao} onChange={(e) => setEvolucao(e.currentTarget.value)} />
        <Group justify="flex-end" mt="sm">
          <Button leftSection={<IconUsersGroup size={16} />} disabled={!oficinaId || !profissionalId || !presentes.length} onClick={() => void registrar()}>
            Registrar sessão
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}

function TelaProgramasCaps() {
  useTituloJanela('Programas e agenda do CAPS');
  const [resumo, setResumo] = useState<any[]>([]);
  const [agenda, setAgenda] = useState<any[]>([]);
  useEffect(() => {
    api.get('/api/caps/resumo').then(setResumo).catch(notificarErro);
    api.get('/api/caps/agenda').then(setAgenda).catch(notificarErro);
  }, []);
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Programas, oficinas e agenda</Title>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        {resumo.map((p) => (
          <Paper key={p.id} withBorder p="sm">
            <Text fw={600} size="sm">
              {p.programa}
            </Text>
            <Text size="xs" c="dimmed">
              {p.oficinas} oficina(s)
            </Text>
            <Text size="xl" fw={700}>
              {p.inscritos}
              {p.vagas ? `/${p.vagas}` : ''}
            </Text>
            <Text size="xs">inscritos · {p.atendimentos_mes} atendimento(s) no mês</Text>
          </Paper>
        ))}
      </SimpleGrid>
      <Paper withBorder p="sm">
        <Text size="sm" fw={600} mb="xs">
          Próximos encontros (14 dias)
        </Text>
        <TabelaSimples
          linhas={agenda}
          vazio="Nenhum encontro agendado. Cadastre as agendas dos programas em Saúde mental > Cadastros."
          colunas={[
            { titulo: 'Data', valor: (a: any) => `${dayjs(a.data).format('ddd DD/MM')} ${a.hora}` },
            { titulo: 'Programa', valor: (a: any) => a.programa },
            { titulo: 'Oficina', valor: (a: any) => a.oficina ?? '-' },
            { titulo: 'Local', valor: (a: any) => a.local ?? '-' },
            { titulo: 'Profissional', valor: (a: any) => a.profissional ?? '-' },
            { titulo: 'Vagas', valor: (a: any) => (a.bloqueado ? <Badge color="gray">Bloqueado</Badge> : `${a.ocupadas}/${a.vagas}`) },
          ]}
        />
      </Paper>
    </Stack>
  );
}

registrarTela({ id: 'caps', titulo: 'Usuário: atendimento e acolhimento', menu: 'Saúde mental', padrao: '/t/caps', permissao: 'caps_atendimento:consultar', modulo: 'CAPS', palavras: ['caps', 'saúde mental', 'acolhimento', 'pts', 'psicossocial'], ordem: 1, render: ({ query }) => <TelaCaps pacienteInicial={query.get('paciente') ? Number(query.get('paciente')) : undefined} /> });
registrarTela({ id: 'caps-sessao', titulo: 'Sessão de oficina / grupo', menu: 'Saúde mental', padrao: '/t/caps-sessao', permissao: 'caps_atendimento:incluir', modulo: 'CAPS', palavras: ['oficina', 'grupo', 'presença'], ordem: 2, render: () => <TelaSessaoOficina /> });
registrarTela({ id: 'caps-programas', titulo: 'Programas e agenda', menu: 'Saúde mental', padrao: '/t/caps-programas', permissao: 'caps_programa:consultar', modulo: 'CAPS', palavras: ['programa', 'agenda', 'oficina'], ordem: 3, render: () => <TelaProgramasCaps /> });
registrarMenuRelatorios('CAPS', 'Saúde mental', 'caps_atendimento:exportar');
