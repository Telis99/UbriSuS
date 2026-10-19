// Componentes de paciente usados em todas as telas de atendimento.
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCloudDownload, IconInfoCircle, IconSearch, IconUserPlus } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { formatarCns, formatarCpf } from '@compartilhado/validacao';
import { api, urlArquivo } from '@/api';
import { Formulario } from '@/genericos/Formulario';
import { MASCARAS } from '@/genericos/campos';
import type { Alerta } from '@/tipos';

export interface ResumoPaciente {
  id: number;
  nome: string;
  nome_social?: string;
  data_nascimento?: string;
  nascimento?: string;
  sexo: string;
  foto_id?: string;
  nome_mae?: string;
  nome_pai?: string;
  cns?: string;
  cpf?: string;
  celular?: string;
  municipio?: string;
  prontuario?: string;
  situacao?: string;
  condicoes_saude?: string[];
  alergias?: { substancia: string; gravidade?: string }[];
  gestante?: boolean;
  idade?: { anos: number; meses: number; dias: number } | null;
  alertas?: Alerta[];
}

export const idadeExtensa = (i?: { anos: number; meses: number; dias: number } | null) =>
  i ? `${i.anos} ano(s), ${i.meses} mês(es) e ${i.dias} dia(s)` : '';

const COR_ALERTA = { info: 'blue', aviso: 'yellow', perigo: 'red' } as const;

/** Cabeçalho com foto, idade em anos/meses/dias, alergias e alertas do paciente (TR 1.2.10.17, 1.2.16.12). */
export function CabecalhoPaciente({ paciente, compacto, aoAtualizar }: { paciente: ResumoPaciente; compacto?: boolean; aoAtualizar?: () => void }) {
  const cond = paciente.condicoes_saude ?? [];
  return (
    <Paper withBorder p="sm" radius="md">
      <Group align="flex-start" wrap="nowrap">
        <Avatar src={paciente.foto_id ? urlArquivo(paciente.foto_id) : null} size={compacto ? 56 : 84} radius="md" color="blue">
          {paciente.nome?.[0]}
        </Avatar>
        <Stack gap={2} style={{ flex: 1 }}>
          <Group gap="xs">
            <Text fw={700} size="lg">
              {paciente.nome_social ? `${paciente.nome_social} (${paciente.nome})` : paciente.nome}
            </Text>
            {paciente.situacao && paciente.situacao !== 'ATIVO' && <Badge color={paciente.situacao === 'PRE_CADASTRO' ? 'yellow' : 'red'}>{paciente.situacao.replace('_', '-')}</Badge>}
            {paciente.gestante && <Badge color="pink">Gestante</Badge>}
            {cond.includes('hipertensao') && <Badge color="orange">Hipertenso</Badge>}
            {cond.includes('diabetes') && <Badge color="grape">Diabético</Badge>}
          </Group>
          <Text size="sm">
            {paciente.sexo === 'F' ? 'Feminino' : paciente.sexo === 'M' ? 'Masculino' : 'Sexo ignorado'} · <b>{idadeExtensa(paciente.idade)}</b>
            {(paciente.data_nascimento ?? paciente.nascimento) && ` · nasc. ${dayjs(paciente.data_nascimento ?? paciente.nascimento).format('DD/MM/YYYY')}`}
          </Text>
          <Text size="xs" c="dimmed">
            Prontuário: <b>{paciente.prontuario ?? '-'}</b> · CNS: {paciente.cns ? formatarCns(paciente.cns) : '-'} · CPF: {paciente.cpf ? formatarCpf(paciente.cpf) : '-'}
            {paciente.celular ? ` · Tel.: ${MASCARAS.telefone(paciente.celular)}` : ''}
          </Text>
          {!compacto && (
            <Text size="xs" c="dimmed">
              Mãe: {paciente.nome_mae ?? '-'} · Pai: {paciente.nome_pai ?? '-'} · Município: {paciente.municipio ?? '-'}
            </Text>
          )}
          {!!paciente.alergias?.length && (
            <Group gap={4}>
              <Text size="xs" c="red" fw={700}>
                ALERGIAS:
              </Text>
              {paciente.alergias.map((a) => (
                <Badge key={a.substancia} color="red" variant="filled" size="sm">
                  {a.substancia}
                </Badge>
              ))}
            </Group>
          )}
        </Stack>
      </Group>
      {!!paciente.alertas?.length && (
        <Stack gap={4} mt="xs">
          {paciente.alertas.map((a, i) => (
            <Alert key={i} color={COR_ALERTA[a.nivel]} py={4} icon={a.nivel === 'info' ? <IconInfoCircle size={16} /> : <IconAlertTriangle size={16} />}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm">{a.mensagem}</Text>
                {a.tipo === 'aviso_paciente' && (
                  <Button size="compact-xs" variant="subtle" onClick={() => api.post(`/api/pacientes/avisos/${a.dados.avisoId}/avisado`).then(aoAtualizar)}>
                    Avisado
                  </Button>
                )}
              </Group>
            </Alert>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

export function usePaciente(id: number | null, rotina?: string) {
  const [paciente, setPaciente] = useState<ResumoPaciente | null>(null);
  const carregar = useCallback(async () => {
    if (!id) return setPaciente(null);
    setPaciente(await api.get(`/api/pacientes/${id}/resumo`, { rotina }));
  }, [id, rotina]);
  useEffect(() => {
    void carregar();
  }, [carregar]);
  return { paciente, recarregar: carregar };
}

/** Pesquisa de pacientes pelos campos exigidos com contador de resultados (TR 1.2.12.17). */
export function BuscaPaciente({ aoSelecionar, permitirCadastro = true }: { aoSelecionar: (id: number) => void; permitirCadastro?: boolean }) {
  const [f, setF] = useState<Record<string, string>>({});
  const [res, setRes] = useState<{ total: number; linhas: any[] } | null>(null);
  const [cadastro, setCadastro] = useState<null | 'completo' | 'pre'>(null);
  const [iniciais, setIniciais] = useState<Record<string, any>>({});
  const [buscando, setBuscando] = useState(false);

  async function buscar() {
    setBuscando(true);
    try {
      setRes(await api.get('/api/pacientes/busca', f));
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setBuscando(false);
    }
  }

  async function buscarCadsus() {
    try {
      const r = await api.post('/api/cadsus/consultar', { cpf: f.cpf || undefined, cns: f.cns || undefined });
      if (!r.encontrado) return notifications.show({ message: 'Cidadão não encontrado no CADSUS.' });
      setIniciais(Object.fromEntries(Object.entries(r.dados).filter(([, v]) => v != null)));
      setCadastro('completo');
    } catch (e) {
      notifications.show({ color: 'yellow', title: 'CADSUS', message: (e as Error).message });
    }
  }

  const campo = (nome: string, rotulo: string, props: Record<string, any> = {}) => (
    <TextInput size="xs" label={rotulo} value={f[nome] ?? ''} onChange={(e) => setF({ ...f, [nome]: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && void buscar()} {...props} />
  );

  return (
    <Stack gap="xs">
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="xs">
        {campo('nome', 'Nome do paciente', { autoFocus: true })}
        {campo('mae', 'Nome da mãe')}
        <DateInput size="xs" label="Data de nascimento" valueFormat="DD/MM/YYYY" clearable value={f.nascimento ? new Date(f.nascimento + 'T00:00') : null} onChange={(d) => setF({ ...f, nascimento: d ? dayjs(d).format('YYYY-MM-DD') : '' })} />
        <Select
          size="xs"
          label="Situação cadastral"
          clearable
          value={f.situacao ?? null}
          onChange={(v) => setF({ ...f, situacao: v ?? '' })}
          data={[
            { value: 'ATIVO', label: 'Ativo' },
            { value: 'DESCONHECIDO', label: 'Desconhecido' },
            { value: 'MUDOU', label: 'Mudou-se' },
            { value: 'FALECIDO', label: 'Falecido' },
            { value: 'PRE_CADASTRO', label: 'Pré-cadastro' },
          ]}
        />
        {campo('cpf', 'CPF', { inputMode: 'numeric' })}
        {campo('rg', 'RG')}
        {campo('cns', 'Cartão Nacional de Saúde', { inputMode: 'numeric' })}
        {campo('prontuario', 'Prontuário')}
      </SimpleGrid>
      <Group justify="space-between">
        <Group gap="xs">
          <Button size="xs" leftSection={<IconSearch size={14} />} onClick={() => void buscar()} loading={buscando}>
            Pesquisar
          </Button>
          {(f.cpf || f.cns) && (
            <Tooltip label="Busca ativa na base nacional (CADSUS/RNDS)">
              <Button size="xs" variant="light" leftSection={<IconCloudDownload size={14} />} onClick={() => void buscarCadsus()}>
                Buscar no CADSUS
              </Button>
            </Tooltip>
          )}
        </Group>
        {permitirCadastro && (
          <Group gap="xs">
            <Button size="xs" variant="default" leftSection={<IconUserPlus size={14} />} onClick={() => (setIniciais({}), setCadastro('completo'))}>
              Cadastro completo
            </Button>
            <Button size="xs" variant="default" color="yellow" onClick={() => (setIniciais({ situacao: 'PRE_CADASTRO' }), setCadastro('pre'))}>
              Pré-cadastro (urgência)
            </Button>
          </Group>
        )}
      </Group>
      {res && (
        <Paper withBorder>
          <Group px="sm" py={4} justify="space-between">
            <Text size="xs" c="dimmed">
              {res.total} registro(s) encontrado(s)
            </Text>
          </Group>
          <ScrollArea.Autosize mah={260}>
            <Table highlightOnHover fz="xs" striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Código</Table.Th>
                  <Table.Th>Nome</Table.Th>
                  <Table.Th>Mãe</Table.Th>
                  <Table.Th>Nascimento</Table.Th>
                  <Table.Th>Idade</Table.Th>
                  <Table.Th>CPF</Table.Th>
                  <Table.Th>RG</Table.Th>
                  <Table.Th>Situação</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {res.linhas.map((l) => (
                  <Table.Tr key={l.codigo} style={{ cursor: 'pointer' }} onClick={() => aoSelecionar(l.codigo)}>
                    <Table.Td>{l.codigo}</Table.Td>
                    <Table.Td fw={500}>{l.nome_social ? `${l.nome_social} (${l.nome})` : l.nome}</Table.Td>
                    <Table.Td>{l.nome_mae}</Table.Td>
                    <Table.Td>{dayjs(l.data_nascimento).format('DD/MM/YYYY')}</Table.Td>
                    <Table.Td>{l.idade}</Table.Td>
                    <Table.Td>{l.cpf ? formatarCpf(l.cpf) : ''}</Table.Td>
                    <Table.Td>{l.rg}</Table.Td>
                    <Table.Td>
                      <Badge size="xs" color={l.situacao === 'ATIVO' ? 'teal' : 'yellow'}>
                        {l.situacao}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        </Paper>
      )}
      <Modal opened={!!cadastro} onClose={() => setCadastro(null)} size="90%" title={cadastro === 'pre' ? 'Pré-cadastro para atendimento de urgência' : 'Cadastro de paciente (padrão CADSUS)'}>
        {cadastro && (
          <Formulario
            entidade="paciente"
            iniciais={{ ...iniciais, nome: f.nome?.toUpperCase() || iniciais.nome, nome_mae: f.mae?.toUpperCase() || iniciais.nome_mae, data_nascimento: f.nascimento || iniciais.data_nascimento, cpf: f.cpf || iniciais.cpf, cns: f.cns || iniciais.cns }}
            emModal
            aoSalvar={(r) => {
              setCadastro(null);
              aoSelecionar(r.id);
            }}
            aoCancelar={() => setCadastro(null)}
          />
        )}
      </Modal>
    </Stack>
  );
}

/** Atualização rápida do CNS e telefone sem sair da tela (TR 1.2.10.18). */
export function AtualizacaoRapida({ paciente, aoSalvar }: { paciente: ResumoPaciente; aoSalvar: () => void }) {
  const [cns, setCns] = useState(paciente.cns ?? '');
  const [cel, setCel] = useState(paciente.celular ?? '');
  return (
    <Group align="flex-end" gap="xs">
      <TextInput size="xs" label="CNS" value={MASCARAS.cns(cns.replace(/\D/g, ''))} onChange={(e) => setCns(e.currentTarget.value.replace(/\D/g, ''))} w={170} />
      <TextInput size="xs" label="Celular" value={MASCARAS.telefone(cel.replace(/\D/g, ''))} onChange={(e) => setCel(e.currentTarget.value.replace(/\D/g, ''))} w={150} />
      <Button
        size="xs"
        variant="light"
        onClick={() =>
          api
            .patch(`/api/pacientes/${paciente.id}/rapido`, { cns: cns || undefined, celular: cel || undefined })
            .then(() => (notifications.show({ color: 'teal', message: 'Dados atualizados.' }), aoSalvar()))
            .catch((e) => notifications.show({ color: 'red', message: e.message }))
        }
      >
        Atualizar
      </Button>
    </Group>
  );
}
