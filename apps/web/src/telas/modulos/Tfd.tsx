// Tratamento Fora do Domicílio (TR 1.2.35): localização de laudos, inclusão com impressão automática,
// decisões sobre o laudo e o tratamento, complementos, trâmites e liberação do agendamento de transporte.
import { useState } from 'react';
import { Alert, Badge, Button, Grid, Group, Modal, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput, Timeline, Title } from '@mantine/core';
import { IconBus, IconCheck, IconEdit, IconFilePlus, IconPrinter, IconSearch } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useAuth } from '@/auth/Auth';
import { pedirTexto } from '@/genericos/dialogos';
import { Formulario, registrarExtensaoFormulario } from '@/genericos/Formulario';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { abrirPdf, fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, TabelaSimples, useCarregar } from '@/componentes/comum';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const SITUACOES = [
  { value: 'ABERTO', label: 'Aberto' },
  { value: 'APROVADO', label: 'Aprovado' },
  { value: 'AUTORIZADO', label: 'Autorizado' },
  { value: 'GLOSADO', label: 'Glosado' },
  { value: 'NEGADO', label: 'Negado' },
  { value: 'ARQUIVADO', label: 'Arquivado' },
];
const COR: Record<string, string> = { ABERTO: 'blue', APROVADO: 'cyan', AUTORIZADO: 'green', GLOSADO: 'orange', NEGADO: 'red', ARQUIVADO: 'gray', PENDENTE: 'yellow' };
const TRANSPORTE: Record<string, string> = {
  VEICULO_MUNICIPAL: 'Veículo da Secretaria de Saúde',
  AMBULANCIA: 'Ambulância',
  ONIBUS_LINHA: 'Ônibus de linha',
  AEREO: 'Aéreo',
  PROPRIO: 'Meio próprio',
  OUTRO: 'Outro',
};

function ModalAutorizarTratamento({ aberto, aoFechar, aoConfirmar }: { aberto: boolean; aoFechar: () => void; aoConfirmar: (c: Record<string, any>) => void }) {
  const [c, setC] = useState<Record<string, any>>({});
  return (
    <Modal opened={aberto} onClose={aoFechar} title="Autorizar tratamento (TR 1.2.35.15)">
      <Stack gap="xs">
        <SelecaoRef entidade="local_destino" rotulo="Local de tratamento" obrigatorio valor={c.localTratamentoId} aoMudar={(v) => setC({ ...c, localTratamentoId: v })} />
        <Textarea label="Motivo" required value={c.motivo ?? ''} onChange={(e) => setC({ ...c, motivo: e.currentTarget.value })} />
        <TextInput type="datetime-local" label="Data e hora do atendimento no destino (opcional)" value={c.dataHora ?? ''} onChange={(e) => setC({ ...c, dataHora: e.currentTarget.value })} />
        <Button
          disabled={!c.localTratamentoId || !c.motivo?.trim()}
          onClick={() => aoConfirmar({ localTratamentoId: c.localTratamentoId, motivo: c.motivo, dataHoraAgendamento: c.dataHora ? dayjs(c.dataHora).toISOString() : null })}
        >
          Autorizar tratamento
        </Button>
      </Stack>
    </Modal>
  );
}

/** Processo de TFD: dados do laudo, decisões, complementos e trâmites (TR 1.2.35.4 a 1.2.35.18). */
function ProcessoTfd({ id, aoAlterar }: { id: number; aoAlterar: () => void }) {
  const { pode } = useAuth();
  const { abrir } = useJanelas();
  const { dados, recarregar } = useCarregar<any>(() => api.get(`/api/tfd/laudos/${id}`), [id]);
  const [editar, setEditar] = useState(false);
  const [autTrat, setAutTrat] = useState(false);
  const [complemento, setComplemento] = useState('');
  const [agendar, setAgendar] = useState(false);
  const [dataHora, setDataHora] = useState('');
  if (!dados) return <Text c="dimmed">Carregando...</Text>;
  const l = dados.laudo;
  const decide = pode('tfd_decisao:executar');
  const acao = async (nome: string, msg: string, corpo: Record<string, any> = {}, pedirMotivo?: string) => {
    let motivo: string | null | undefined = corpo.motivo;
    if (pedirMotivo) {
      motivo = await pedirTexto(msg, pedirMotivo, { longo: true });
      if (!motivo) return;
    }
    try {
      await api.post(`/api/tfd/laudos/${id}/acoes/${nome}`, { ...corpo, motivo });
      notificarOk(msg);
      await recarregar();
      aoAlterar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const aprovado = ['APROVADO', 'AUTORIZADO'].includes(l.situacao);
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="start">
        <Stack gap={0}>
          <Title order={5}>
            Laudo nº {l.numero} <Badge color={COR[l.situacao]}>{l.situacao}</Badge>{' '}
            {aprovado && <Badge color={COR[l.situacao_tratamento]} variant="light">{`Tratamento ${l.situacao_tratamento.toLowerCase()}`}</Badge>}
          </Title>
          <Text size="sm" fw={600}>
            {l.paciente} · CNS {l.cns ?? '-'}
          </Text>
          <Text size="xs">
            Aberto em {fmtData(l.data_abertura)} · {l.unidade} · {l.profissional}
          </Text>
          <Text size="xs">
            CID {l.cid_codigo} - {l.cid_nome} · {l.procedimento_codigo} - {l.procedimento}
          </Text>
          {l.local_tratamento && (
            <Text size="xs" c="green.8">
              Local de tratamento: {l.local_tratamento} ({l.municipio_tratamento}){l.agendamento_data_hora ? ` · atendimento em ${fmtDataHora(l.agendamento_data_hora)}` : ''}
            </Text>
          )}
          {l.motivo_decisao && (
            <Text size="xs" c="orange.8">
              Motivo: {l.motivo_decisao}
            </Text>
          )}
        </Stack>
        <Group gap={4}>
          <Button size="xs" variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/tfd/laudos/${id}/pdf`)}>
            Reimprimir laudo
          </Button>
          {l.situacao === 'AUTORIZADO' && (
            <Button size="xs" variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/tfd/laudos/${id}/pedido`)}>
              Pedido de TFD
            </Button>
          )}
          {!['ARQUIVADO', 'NEGADO'].includes(l.situacao) && (
            <Button size="xs" variant="light" leftSection={<IconEdit size={14} />} onClick={() => setEditar(true)}>
              Alterar laudo
            </Button>
          )}
        </Group>
      </Group>
      {decide && (
        <Paper withBorder p="xs">
          <Text size="xs" fw={600} mb={4}>
            Laudo
          </Text>
          <Group gap={4}>
            {l.situacao === 'ABERTO' && (
              <Button size="xs" color="cyan" leftSection={<IconCheck size={14} />} onClick={() => void acao('aprovar', 'Laudo aprovado.')}>
                Aprovar
              </Button>
            )}
            {['ABERTO', 'APROVADO'].includes(l.situacao) && (
              <Button size="xs" color="orange" variant="light" onClick={() => void acao('glosar', 'Laudo glosado.', {}, 'Motivo da glosa')}>
                Glosar
              </Button>
            )}
            {l.situacao === 'GLOSADO' && (
              <Button size="xs" variant="light" onClick={() => void acao('reapresentar', 'Laudo reapresentado.')}>
                Reapresentar após correção
              </Button>
            )}
            {l.situacao === 'APROVADO' && (
              <>
                <Button size="xs" color="green" onClick={() => void acao('autorizar', 'Laudo autorizado.')}>
                  Autorizar laudo
                </Button>
                <Button size="xs" color="red" variant="light" onClick={() => void acao('negar', 'Laudo negado.', {}, 'Motivo da negação')}>
                  Negar laudo
                </Button>
              </>
            )}
            {l.situacao === 'AUTORIZADO' && (
              <Button size="xs" color="red" variant="subtle" onClick={() => void acao('cancelar-autorizacao', 'Autorização do pedido cancelada.', {}, 'Motivo do cancelamento da autorização')}>
                Cancelar autorização do pedido
              </Button>
            )}
            {l.situacao !== 'ARQUIVADO' && (
              <Button size="xs" color="gray" variant="light" onClick={() => void acao('arquivar', 'Laudo arquivado.', {}, 'Motivo do arquivamento')}>
                Arquivar
              </Button>
            )}
          </Group>
          {aprovado && (
            <>
              <Text size="xs" fw={600} mt="xs" mb={4}>
                Tratamento
              </Text>
              <Group gap={4}>
                {l.situacao_tratamento === 'PENDENTE' && (
                  <>
                    <Button size="xs" color="green" onClick={() => setAutTrat(true)}>
                      Autorizar tratamento
                    </Button>
                    <Button size="xs" color="red" variant="light" onClick={() => void acao('negar-tratamento', 'Tratamento negado.', {}, 'Motivo da negação do tratamento')}>
                      Negar tratamento
                    </Button>
                  </>
                )}
                {l.situacao_tratamento === 'AUTORIZADO' && (
                  <>
                    <Button
                      size="xs"
                      leftSection={<IconBus size={14} />}
                      onClick={() => abrir(`/t/transporte/agendamento?paciente=${l.paciente_id}&tfd=${l.id}`, 'Agendamento de transporte')}
                    >
                      Agendar transporte
                    </Button>
                    <Button size="xs" variant="light" onClick={() => setAgendar(true)}>
                      Registrar atendimento no destino
                    </Button>
                    <Button size="xs" color="red" variant="subtle" onClick={() => void acao('cancelar-tratamento', 'Autorização do tratamento cancelada.', {}, 'Motivo do cancelamento da autorização do tratamento')}>
                      Cancelar autorização do tratamento
                    </Button>
                  </>
                )}
              </Group>
            </>
          )}
        </Paper>
      )}
      {l.situacao_tratamento === 'AUTORIZADO' && !decide && (
        <Button size="xs" leftSection={<IconBus size={14} />} onClick={() => abrir(`/t/transporte/agendamento?paciente=${l.paciente_id}&tfd=${l.id}`, 'Agendamento de transporte')}>
          Agendar transporte
        </Button>
      )}
      <Tabs defaultValue="tramites" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="tramites">Trâmites ({dados.tramites.length})</Tabs.Tab>
          <Tabs.Tab value="clinico">Laudo</Tabs.Tab>
          <Tabs.Tab value="complementos">Complementos ({dados.complementos.length})</Tabs.Tab>
          <Tabs.Tab value="outros">Acompanhantes, documentos e ajudas</Tabs.Tab>
          <Tabs.Tab value="transporte">Transporte ({dados.viagens.length})</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="tramites" pt="xs">
          <ScrollArea h={360}>
            <Timeline bulletSize={14} lineWidth={2}>
              {dados.tramites.map((t: any) => (
                <Timeline.Item key={t.id} title={<Text size="sm" fw={600}>{t.acao}</Text>}>
                  <Text size="xs" c="dimmed">
                    {fmtDataHora(t.data_hora)} · {t.operador ?? 'sistema'}
                    {t.situacao ? ` · ${t.situacao}` : ''}
                  </Text>
                  {t.descricao && <Text size="xs">{t.descricao}</Text>}
                </Timeline.Item>
              ))}
            </Timeline>
          </ScrollArea>
        </Tabs.Panel>
        <Tabs.Panel value="clinico" pt="xs">
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
            {[
              ['Diagnóstico inicial', l.diagnostico_inicial],
              ['Diagnóstico provável', l.diagnostico_provavel],
              ['Histórico da doença', l.historico_doenca],
              ['Exame físico', l.exame_fisico],
              ['Exames complementares', l.exames_complementares],
              ['Tratamentos realizados', l.tratamentos_realizados],
              ['Razões que impossibilitam o tratamento no município', l.razoes_impossibilidade],
              ['Transporte / acompanhante', `${TRANSPORTE[l.tipo_transporte] ?? l.tipo_transporte} · ${l.necessita_acompanhante ? `necessita acompanhante: ${l.justificativa_acompanhante ?? ''}` : 'sem acompanhante'}`],
            ].map(([t, v]) => (
              <Paper key={t} withBorder p={6}>
                <Text size="xs" fw={600}>
                  {t}
                </Text>
                <Text size="xs">{v || '-'}</Text>
              </Paper>
            ))}
          </SimpleGrid>
          {l.alterado_em && (
            <Text size="xs" c="dimmed" mt={4}>
              Última alteração em {fmtDataHora(l.alterado_em)} por {l.alterado_por_nome ?? '-'}
            </Text>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="complementos" pt="xs">
          <TabelaSimples
            linhas={dados.complementos}
            colunas={[
              { titulo: 'Data e hora', valor: (c: any) => fmtDataHora(c.data_hora) },
              { titulo: 'Usuário', valor: (c) => c.operador ?? '-' },
              { titulo: 'Complemento', valor: (c) => c.texto },
            ]}
          />
          {l.situacao !== 'ARQUIVADO' && (
            <Group align="end" mt="xs">
              <Textarea label="Novo complemento (data, hora e usuário registrados automaticamente)" style={{ flex: 1 }} autosize minRows={2} value={complemento} onChange={(e) => setComplemento(e.currentTarget.value)} />
              <Button
                disabled={complemento.trim().length < 3}
                onClick={async () => {
                  try {
                    await api.post(`/api/tfd/laudos/${id}/complementos`, { texto: complemento });
                    setComplemento('');
                    notificarOk('Complemento incluído.');
                    await recarregar();
                  } catch (e) {
                    notificarErro(e);
                  }
                }}
              >
                Incluir complemento
              </Button>
            </Group>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="outros" pt="xs">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Acompanhantes
            </Text>
            <TabelaSimples linhas={dados.acompanhantes} colunas={[{ titulo: 'Nome', valor: (a: any) => a.nome }, { titulo: 'Parentesco', valor: (a) => a.parentesco ?? '' }, { titulo: 'CPF', valor: (a) => a.cpf ?? '' }]} />
            <Text size="sm" fw={600}>
              Documentos
            </Text>
            <TabelaSimples linhas={dados.documentos} colunas={[{ titulo: 'Tipo', valor: (d: any) => d.tipo ?? '' }, { titulo: 'Descrição', valor: (d) => d.descricao }, { titulo: 'Arquivo', valor: (d) => (d.arquivo_id ? <a href={`/api/arquivos/${d.arquivo_id}`} target="_blank" rel="noreferrer">abrir</a> : '-') }]} />
            <Text size="sm" fw={600}>
              Ajudas de custo
            </Text>
            <TabelaSimples
              linhas={dados.ajudas}
              colunas={[
                { titulo: 'Data', valor: (a: any) => fmtData(a.data) },
                { titulo: 'Tipo', valor: (a) => a.tipo },
                { titulo: 'Beneficiário', valor: (a) => a.beneficiario },
                { titulo: 'Valor', valor: (a) => Number(a.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
                { titulo: 'Situação', valor: (a) => a.situacao },
              ]}
            />
            <Group>
              <Button size="xs" variant="light" onClick={() => abrir(`/e/laudo_tfd/${id}`, `Laudo de TFD ${l.numero}`)}>
                Incluir acompanhantes, documentos e ajudas de custo
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="transporte" pt="xs">
          <TabelaSimples
            linhas={dados.viagens}
            colunas={[
              { titulo: 'Data', valor: (v: any) => `${fmtData(v.data_saida)} ${v.hora}` },
              { titulo: 'Rota', valor: (v) => v.rota ?? 'Viagem extra' },
              { titulo: 'Destino', valor: (v) => v.local_destino ?? '' },
              { titulo: 'Protocolo', valor: (v) => v.protocolo },
              { titulo: 'Acompanhantes', valor: (v) => v.acompanhantes },
              { titulo: 'Situação', valor: (v) => v.situacao },
              {
                titulo: '',
                valor: (v) => (
                  <Button size="compact-xs" variant="subtle" leftSection={<IconPrinter size={12} />} onClick={() => void abrirPdf(`/api/transporte/passageiros/${v.id}/comprovante`)}>
                    Comprovante
                  </Button>
                ),
              },
            ]}
          />
        </Tabs.Panel>
      </Tabs>
      <Modal opened={editar} onClose={() => setEditar(false)} title={`Alterar laudo ${l.numero}`} size="xl">
        <Formulario
          entidade="laudo_tfd"
          id={id}
          emModal
          aoSalvar={() => {
            setEditar(false);
            void recarregar();
            aoAlterar();
          }}
          aoCancelar={() => setEditar(false)}
        />
      </Modal>
      <Modal opened={agendar} onClose={() => setAgendar(false)} title="Atendimento agendado no destino">
        <Stack gap="xs">
          <TextInput type="datetime-local" label="Data e hora do atendimento" value={dataHora} onChange={(e) => setDataHora(e.currentTarget.value)} />
          <Button
            disabled={!dataHora}
            onClick={async () => {
              setAgendar(false);
              await acao('agendar', 'Agendamento no destino registrado.', { dataHoraAgendamento: dayjs(dataHora).toISOString() });
            }}
          >
            Gravar
          </Button>
        </Stack>
      </Modal>
      <ModalAutorizarTratamento
        aberto={autTrat}
        aoFechar={() => setAutTrat(false)}
        aoConfirmar={async (c) => {
          setAutTrat(false);
          await acao('autorizar-tratamento', 'Tratamento autorizado. O agendamento de transporte está liberado.', c);
        }}
      />
    </Stack>
  );
}

function TelaTfd({ query }: { query: URLSearchParams }) {
  useTituloJanela('Processos de TFD');
  const { eu } = useAuth();
  const [filtro, setFiltro] = useState<Record<string, any>>({ de: dayjs().subtract(6, 'month').format('YYYY-MM-DD'), ate: dayjs().format('YYYY-MM-DD') });
  const [busca, setBusca] = useState<Record<string, any>>(filtro);
  const [sel, setSel] = useState<number | null>(query.get('laudo') ? Number(query.get('laudo')) : null);
  const [novo, setNovo] = useState(false);
  const { dados, recarregar } = useCarregar<any[]>(() => api.get('/api/tfd/laudos', busca), [JSON.stringify(busca)]);
  const campo = (nome: string, rotulo: string, props: Record<string, any> = {}) => (
    <TextInput size="xs" label={rotulo} value={filtro[nome] ?? ''} onChange={(e) => setFiltro({ ...filtro, [nome]: e.currentTarget.value })} onKeyDown={(e) => e.key === 'Enter' && setBusca(filtro)} {...props} />
  );
  return (
    <Stack gap="xs">
      {/* Localização por data de abertura, número, paciente e profissional (TR 1.2.35.5). */}
      <Paper withBorder p="xs">
        <Group align="end" gap="xs">
          {campo('de', 'Abertura de', { type: 'date' })}
          {campo('ate', 'Abertura até', { type: 'date' })}
          {campo('numero', 'Número do laudo', { w: 120 })}
          {campo('paciente', 'Nome do paciente')}
          {campo('profissional', 'Profissional solicitante')}
          <Select size="xs" label="Situação" w={140} clearable data={SITUACOES} value={filtro.situacao ?? null} onChange={(v) => setFiltro({ ...filtro, situacao: v ?? '' })} />
          <Button size="xs" leftSection={<IconSearch size={14} />} onClick={() => setBusca(filtro)}>
            Localizar
          </Button>
          <Button size="xs" color="teal" leftSection={<IconFilePlus size={14} />} onClick={() => setNovo(true)}>
            Novo laudo
          </Button>
        </Group>
      </Paper>
      <Grid>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <ScrollArea h="72vh">
            <Table fz="xs" highlightOnHover striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Laudo</Table.Th>
                  <Table.Th>Paciente</Table.Th>
                  <Table.Th>Situação</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(dados ?? []).map((l) => (
                  <Table.Tr key={l.id} onClick={() => setSel(l.id)} style={{ cursor: 'pointer' }} bg={sel === l.id ? 'var(--mantine-color-blue-light)' : undefined}>
                    <Table.Td>
                      <Text size="xs" fw={600}>
                        {l.numero}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {fmtData(l.data_abertura)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {l.paciente}
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {l.cid} · {l.profissional}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge size="xs" color={COR[l.situacao]}>
                        {l.situacao_atual}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {!dados?.length && (
              <Text size="sm" c="dimmed" p="xs">
                Nenhum laudo encontrado.
              </Text>
            )}
          </ScrollArea>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 7 }}>
          {sel ? (
            <ProcessoTfd key={sel} id={sel} aoAlterar={() => void recarregar()} />
          ) : (
            <Alert color="gray">Selecione um laudo para ver o processo, as decisões e os trâmites.</Alert>
          )}
        </Grid.Col>
      </Grid>
      <Modal opened={novo} onClose={() => setNovo(false)} title="Novo laudo de TFD" size="xl">
        {/* Impressão automática do laudo após a inclusão (TR 1.2.35.2). */}
        <Formulario
          entidade="laudo_tfd"
          emModal
          iniciais={{ data_abertura: dayjs().format('YYYY-MM-DD'), unidade_solicitante_id: eu?.unidadeAtual ?? undefined, profissional_solicitante_id: eu?.profissionalId ?? undefined, paciente_id: query.get('paciente') ? Number(query.get('paciente')) : undefined }}
          aoSalvar={(r) => {
            setNovo(false);
            setSel(r.id);
            void recarregar();
            void abrirPdf(`/api/tfd/laudos/${r.id}/pdf`);
          }}
          aoCancelar={() => setNovo(false)}
        />
      </Modal>
    </Stack>
  );
}

// Ações no formulário genérico do laudo.
function AcoesLaudo({ r }: { r: any }) {
  const { abrir } = useJanelas();
  return (
    <Group gap={4}>
      <Button variant="default" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/tfd/laudos/${r.id}/pdf`)}>
        Imprimir laudo
      </Button>
      <Button onClick={() => abrir(`/t/tfd?laudo=${r.id}`, 'Processos de TFD')}>Abrir processo</Button>
    </Group>
  );
}
registrarExtensaoFormulario('laudo_tfd', { acoes: (r) => (r?.id ? <AcoesLaudo r={r} /> : null) });

registrarTela({
  id: 'tfd-processos',
  titulo: 'Processos de TFD',
  menu: 'TFD',
  padrao: '/t/tfd',
  permissao: 'laudo_tfd:consultar',
  modulo: 'TFD',
  palavras: ['tratamento fora do domicílio', 'laudo', 'glosa', 'autorização', 'tfd'],
  ordem: 1,
  render: ({ query }) => <TelaTfd query={query} />,
});
registrarMenuRelatorios('TFD', 'TFD', 'laudo_tfd:exportar');
