// Acesso ACS (TR 1.2.49): gerenciamento das cargas dos agentes pela unidade (cancelamento e redefinição de
// validade), conflitos de sincronização e mapa das visitas com satélite e calor.
import { useState } from 'react';
import { Alert, Badge, Button, Code, Group, Modal, SegmentedControl, SimpleGrid, Stack, Table, Tabs, Text, TextInput } from '@mantine/core';
import dayjs from 'dayjs';
import { api } from '@/api';
import { MapaVisitas } from '@/acs/MapaVisitas';
import { fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, useCarregar } from '@/componentes/comum';
import { pedirTexto } from '@/genericos/dialogos';
import { useTituloJanela } from '@/shell/Janelas';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const COR: Record<string, string> = { ATIVA: 'teal', RETORNADA: 'blue', CANCELADA: 'gray', EXPIRADA: 'red' };

/** Cargas dos ACS: cancelamento e redefinição de validade pelo operador da unidade (TR 1.2.49.8, 1.2.49.8.1, 1.2.49.8.2). */
function TelaCargas() {
  useTituloJanela('Cargas do aplicativo do ACS');
  const [situacao, setSituacao] = useState('ATIVA');
  const { dados, recarregar } = useCarregar<any[]>(() => api.get('/api/acs/cargas', { situacao: situacao === 'TODAS' ? undefined : situacao }), [situacao]);
  const { dados: conflitos, recarregar: recarregarConflitos } = useCarregar<any[]>(() => api.get('/api/acs/conflitos', { situacao: 'PENDENTE' }), []);
  const [validade, setValidade] = useState<any>(null);
  const [novaData, setNovaData] = useState('');
  const [motivo, setMotivo] = useState('');
  const cancelar = async (k: any) => {
    const m = await pedirTexto('Cancelar carga', 'Motivo do cancelamento', { obrigatorio: true });
    if (!m) return;
    await api.post(`/api/acs/cargas/${k.id}/cancelar`, { motivo: m }).then(() => (notificarOk('Carga cancelada; famílias liberadas para edição.'), recarregar())).catch(notificarErro);
  };
  const redefinir = async () => {
    await api
      .post(`/api/acs/cargas/${validade.id}/validade`, { validade: novaData, motivo })
      .then(() => {
        notificarOk('Validade redefinida.');
        setValidade(null);
        return recarregar();
      })
      .catch(notificarErro);
  };
  const resolver = (c: any, aplicar: boolean) => api.post(`/api/acs/conflitos/${c.id}/resolver`, { aplicar }).then(() => (notificarOk('Conflito resolvido.'), recarregarConflitos())).catch(notificarErro);
  return (
    <Tabs defaultValue="cargas">
      <Tabs.List>
        <Tabs.Tab value="cargas">Cargas</Tabs.Tab>
        <Tabs.Tab value="conflitos" rightSection={conflitos?.length ? <Badge size="xs" color="red">{conflitos.length}</Badge> : null}>
          Conflitos de sincronização
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="cargas" pt="sm">
        <SegmentedControl mb="sm" value={situacao} onChange={setSituacao} data={[{ value: 'ATIVA', label: 'Em campo' }, { value: 'RETORNADA', label: 'Retornadas' }, { value: 'CANCELADA', label: 'Canceladas' }, { value: 'EXPIRADA', label: 'Expiradas' }, { value: 'TODAS', label: 'Todas' }]} />
        <Table striped fz="xs" withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Carga</Table.Th>
              <Table.Th>Responsável</Table.Th>
              <Table.Th>Unidade / área / microárea</Table.Th>
              <Table.Th>Recebida em</Table.Th>
              <Table.Th>Famílias / pessoas</Table.Th>
              <Table.Th>Validade</Table.Th>
              <Table.Th>Última sincronização</Table.Th>
              <Table.Th>Visitas</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th>Ações</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(dados ?? []).map((k) => (
              <Table.Tr key={k.id}>
                <Table.Td>{k.id}</Table.Td>
                <Table.Td>{k.responsavel}</Table.Td>
                <Table.Td>
                  {k.unidade} / {k.area ?? '-'} / {k.microarea}
                </Table.Td>
                <Table.Td>{fmtDataHora(k.recebida_em)}</Table.Td>
                <Table.Td>
                  {k.familias} / {k.pessoas}
                </Table.Td>
                <Table.Td>
                  {fmtData(k.validade)} {k.vencida && <Badge size="xs" color="red">vencida</Badge>}
                </Table.Td>
                <Table.Td>{fmtDataHora(k.ultima_sincronizacao) || '-'}</Table.Td>
                <Table.Td>{k.visitas}</Table.Td>
                <Table.Td>
                  <Badge color={COR[k.situacao]}>{k.situacao}</Badge>
                  {k.conflitos_pendentes > 0 && <Badge color="red" ml={4}>{k.conflitos_pendentes} conflito(s)</Badge>}
                  {k.motivo && <Text size="10px" c="dimmed">{k.motivo}</Text>}
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {['ATIVA', 'EXPIRADA'].includes(k.situacao) && (
                      <Button size="compact-xs" variant="light" onClick={() => { setValidade(k); setNovaData(dayjs(k.validade).add(15, 'day').format('YYYY-MM-DD')); setMotivo(''); }}>
                        Redefinir validade
                      </Button>
                    )}
                    {k.situacao === 'ATIVA' && (
                      <Button size="compact-xs" color="red" variant="light" onClick={() => cancelar(k)}>
                        Cancelar
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" mt="xs">
          Enquanto a carga está em campo, as famílias e seus integrantes ficam bloqueados para alteração no sistema; a liberação é automática no retorno da carga ou após a validade.
        </Text>
      </Tabs.Panel>
      <Tabs.Panel value="conflitos" pt="sm">
        {!conflitos?.length && <Alert variant="light">Nenhum conflito pendente.</Alert>}
        <Stack>
          {(conflitos ?? []).map((c) => (
            <Alert key={c.id} color="orange" title={`${c.descricao} (carga ${c.carga_id}, ACS ${c.acs ?? '-'}, ${fmtDataHora(c.data_hora)})`}>
              <SimpleGrid cols={2}>
                <Stack gap={2}>
                  <Text size="xs" fw={600}>
                    Enviado pelo aparelho
                  </Text>
                  <Code block>{JSON.stringify(c.dados_dispositivo, null, 1)}</Code>
                </Stack>
                <Stack gap={2}>
                  <Text size="xs" fw={600}>
                    Valor atual no sistema
                  </Text>
                  <Code block>{JSON.stringify(c.dados_servidor, null, 1)}</Code>
                </Stack>
              </SimpleGrid>
              <Group mt="xs">
                <Button size="xs" onClick={() => resolver(c, true)} disabled={!c.registro_id}>
                  Aplicar alteração do aparelho
                </Button>
                <Button size="xs" variant="light" onClick={() => resolver(c, false)}>
                  Manter valor do sistema
                </Button>
              </Group>
            </Alert>
          ))}
        </Stack>
      </Tabs.Panel>
      <Modal opened={!!validade} onClose={() => setValidade(null)} title={`Redefinir validade da carga ${validade?.id}`}>
        <Stack>
          <TextInput type="date" label="Nova data para retorno" value={novaData} onChange={(e) => setNovaData(e.currentTarget.value)} />
          <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
          <Button onClick={redefinir} disabled={!novaData || motivo.length < 3}>
            Salvar
          </Button>
        </Stack>
      </Modal>
    </Tabs>
  );
}

/** Mapa interativo dos locais de visita com imagens de satélite e calor da cobertura (TR 1.2.49.2.1). */
function TelaMapa() {
  useTituloJanela('Mapa das visitas dos ACS');
  const [de, setDe] = useState(dayjs().subtract(90, 'day').format('YYYY-MM-DD'));
  const [ate, setAte] = useState(dayjs().format('YYYY-MM-DD'));
  const [unidadeId, setUnidadeId] = useState<number | null>(null);
  const [profissionalId, setProfissionalId] = useState<number | null>(null);
  const { dados } = useCarregar<any>(() => api.get('/api/acs/mapa', { de, ate, unidadeId, profissionalId }), [de, ate, unidadeId, profissionalId]);
  return (
    <Stack>
      <Group align="flex-end">
        <TextInput type="date" label="De" value={de} onChange={(e) => setDe(e.currentTarget.value)} />
        <TextInput type="date" label="Até" value={ate} onChange={(e) => setAte(e.currentTarget.value)} />
        <div style={{ width: 280 }}>
          <SelecaoRef entidade="unidade" rotulo="Unidade" valor={unidadeId} aoMudar={setUnidadeId} />
        </div>
        <div style={{ width: 280 }}>
          <SelecaoRef entidade="profissional" rotulo="Agente comunitário" valor={profissionalId} aoMudar={setProfissionalId} />
        </div>
      </Group>
      <MapaVisitas pontos={dados?.visitas ?? []} altura="65vh" />
    </Stack>
  );
}

registrarTela({ id: 'acs-cargas', titulo: 'Cargas do aplicativo do ACS', menu: 'Acesso ACS', padrao: '/t/acs/cargas', permissao: 'acs_carga:consultar', modulo: 'ACS', palavras: ['agente comunitário', 'carga', 'sincronização', 'conflito'], ordem: 1, render: () => <TelaCargas /> });
registrarTela({ id: 'acs-mapa', titulo: 'Mapa das visitas', menu: 'Acesso ACS', padrao: '/t/acs/mapa', permissao: 'acs_visita:consultar', modulo: 'ACS', palavras: ['mapa', 'calor', 'satélite', 'cobertura', 'visita'], ordem: 2, render: () => <TelaMapa /> });
registrarMenuRelatorios('ACS', 'Acesso ACS', 'acs_visita:exportar');
