// Regulação (TR 1.2.43.1): fila regulada por classificação de cores, detalhes da solicitação e do
// encaminhamento, prontuário e histórico de exames, autorização/negativa/devolução com motivos,
// alteração do tipo, agendamento nas vagas da regulação obedecendo à classificação, impressão e
// exclusão auditável da requisição de exames e alerta de requisição já existente.
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Drawer, Group, Modal, NumberInput, Paper, ScrollArea, SegmentedControl, Select, Stack, Table, Tabs, Text, Textarea, Title } from '@mantine/core';
import { IconCalendarPlus, IconPlus, IconPrinter } from '@tabler/icons-react';
import { api, urlArquivo } from '@/api';
import { abrirPdf, comConfirmacao, fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, TabelaSimples } from '@/componentes/comum';
import { CabecalhoPaciente, usePaciente } from '@/componentes/Paciente';
import { pedirTexto } from '@/genericos/dialogos';
import { useTituloJanela } from '@/shell/Janelas';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const COR: Record<string, string> = { VERMELHO: 'red', AMARELO: 'yellow', AZUL: 'blue' };
const ROTULO: Record<string, string> = { VERMELHO: 'Emergência', AMARELO: 'Urgente', AZUL: 'Não urgente' };
const COR_DECISAO: Record<string, string> = { PENDENTE: 'gray', AUTORIZADO: 'green', NEGADO: 'red', DEVOLVIDO: 'orange', AGENDADO: 'teal' };

function DetalheSolicitacao({ id, aoFechar, aoMudar }: { id: number; aoFechar: () => void; aoMudar: () => void }) {
  const [d, setD] = useState<any>(null);
  const [vagas, setVagas] = useState<any[]>([]);
  const [prontuario, setProntuario] = useState<any>(null);
  const [exames, setExames] = useState<any[]>([]);
  const [cancelamentos, setCancelamentos] = useState<any[]>([]);
  const [novoTipo, setNovoTipo] = useState<{ especialidadeId: number | null; procedimentoId: number | null; justificativa: string } | null>(null);
  const s = d?.solicitacao;
  const { paciente } = usePaciente(s?.paciente_id ?? null, 'regulacao');
  const carregar = () => api.get(`/api/regulacao/solicitacoes/${id}`).then(setD).catch(notificarErro);
  useEffect(() => {
    void carregar();
    api.get(`/api/regulacao/solicitacoes/${id}/vagas`).then(setVagas).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  async function acao(url: string, corpo: any, msg: string) {
    try {
      await api.post(url, corpo);
      notificarOk(msg);
      void carregar();
      aoMudar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function comMotivo(acaoNome: string, titulo: string) {
    const motivo = await pedirTexto(titulo, 'Motivo (informado ao solicitante)', { obrigatorio: true, longo: true });
    if (motivo) await acao(`/api/regulacao/solicitacoes/${id}/${acaoNome}`, { motivo }, 'Decisão registrada.');
  }
  async function agendar(horarioId: number) {
    try {
      const r = await comConfirmacao(async (ok) => {
        let justificativa: string | null = null;
        if (ok) {
          justificativa = await pedirTexto('Agendar fora da ordem', 'Justificativa', { obrigatorio: true });
          if (!justificativa) throw new Error('Agendamento cancelado: justificativa não informada.');
        }
        return api.post(`/api/regulacao/solicitacoes/${id}/agendar`, { horarioId, confirmarAvisos: ok, justificativa });
      }, 'Ordem de classificação');
      if (r) {
        notificarOk(`Agendado para ${r.data} ${r.hora ?? ''} - protocolo ${r.senha}.`);
        void carregar();
        aoMudar();
      }
    } catch (e) {
      notificarErro(e);
    }
  }
  if (!d) return null;
  const pendente = s.situacao === 'AGUARDANDO';
  return (
    <Drawer opened onClose={aoFechar} position="right" size="75%" title={`Solicitação regulada nº ${s.id}`}>
      <Stack gap="xs">
        {paciente && <CabecalhoPaciente paciente={paciente} compacto />}
        <Group gap="xs">
          <Badge color={COR[s.prioridade]} size="lg">
            {ROTULO[s.prioridade]}
          </Badge>
          <Badge color={COR_DECISAO[s.decisao ?? 'PENDENTE']} variant="light" size="lg">
            {s.decisao ?? 'PENDENTE'}
          </Badge>
          <Badge variant="outline">{s.situacao}</Badge>
          <Text size="sm">
            {s.especialidade ?? s.procedimento} · incluída em {fmtDataHora(s.incluido_em)}
          </Text>
        </Group>
        {d.duplicidades?.length > 0 && (
          <Alert color="orange" title="O paciente já possui requisição para o mesmo procedimento">
            {d.duplicidades.map((x: any) => (
              <Text key={x.documento + x.data} size="sm">
                {x.item}: <b>{x.situacao === 'AGENDADO' ? 'Agendado' : 'Requisitado'}</b> em {fmtData(x.data)} ({x.documento})
              </Text>
            ))}
          </Alert>
        )}
        {pendente && (
          <Paper withBorder p="xs">
            <Group gap="xs">
              <Text size="sm" fw={600}>
                Classificação:
              </Text>
              <SegmentedControl
                size="xs"
                value={s.prioridade}
                onChange={(v) => void acao(`/api/regulacao/solicitacoes/${id}/classificar`, { prioridade: v }, 'Classificação alterada.')}
                data={[
                  { value: 'AZUL', label: 'Não urgente (azul)' },
                  { value: 'AMARELO', label: 'Urgente (amarelo)' },
                  { value: 'VERMELHO', label: 'Emergência (vermelho)' },
                ]}
              />
              <Button size="xs" color="green" onClick={() => void acao(`/api/regulacao/solicitacoes/${id}/autorizar`, {}, 'Solicitação autorizada para agendamento.')}>
                Autorizar
              </Button>
              <Button size="xs" color="orange" variant="light" onClick={() => void comMotivo('devolver', 'Devolver ao solicitante')}>
                Devolver
              </Button>
              <Button size="xs" color="red" variant="light" onClick={() => void comMotivo('negar', 'Negar solicitação')}>
                Negar
              </Button>
              <Button size="xs" variant="default" onClick={() => setNovoTipo({ especialidadeId: null, procedimentoId: null, justificativa: '' })}>
                Alterar tipo
              </Button>
            </Group>
          </Paper>
        )}
        <Tabs defaultValue="detalhes">
          <Tabs.List>
            <Tabs.Tab value="detalhes">Solicitação e encaminhamento</Tabs.Tab>
            <Tabs.Tab value="agendar">Agendar ({vagas.length} vagas)</Tabs.Tab>
            <Tabs.Tab value="prontuario" onClick={() => !prontuario && api.get(`/api/regulacao/pacientes/${s.paciente_id}/prontuario`).then(setProntuario).catch(notificarErro)}>
              Prontuário
            </Tabs.Tab>
            <Tabs.Tab value="exames" onClick={() => api.get(`/api/regulacao/pacientes/${s.paciente_id}/exames`).then(setExames).catch(notificarErro)}>
              Histórico de exames
            </Tabs.Tab>
            <Tabs.Tab value="cancelamentos" onClick={() => api.get(`/api/regulacao/pacientes/${s.paciente_id}/cancelamentos`).then(setCancelamentos).catch(notificarErro)}>
              Cancelamentos
            </Tabs.Tab>
            <Tabs.Tab value="historico">Histórico da regulação</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="detalhes" pt="xs">
            <Stack gap="xs">
              <Paper withBorder p="xs">
                <Text size="sm">
                  <b>Solicitante:</b> {s.unidade_solicitante ?? '-'} · {s.profissional_solicitante ?? '-'} {s.registro_solicitante ?? ''}
                </Text>
                <Text size="sm">
                  <b>Justificativa / dados clínicos:</b> {s.justificativa ?? '-'}
                </Text>
                {s.motivo && (
                  <Text size="sm" c="orange">
                    <b>Motivo:</b> {s.motivo}
                  </Text>
                )}
                {s.parecer && (
                  <Text size="sm">
                    <b>Parecer do regulador:</b> {s.parecer} ({s.regulador ?? ''} {fmtDataHora(s.avaliado_em)})
                  </Text>
                )}
              </Paper>
              {d.encaminhamento && (
                <Paper withBorder p="xs">
                  <Text size="sm" fw={600}>
                    Encaminhamento de {fmtData(d.encaminhamento.data)} - {d.encaminhamento.profissional}
                  </Text>
                  <Text size="sm">Urgência: {d.encaminhamento.urgencia} {d.encaminhamento.prioritario ? `(priorização: ${d.encaminhamento.justificativa_prioridade ?? ''})` : ''}</Text>
                  <Text size="sm">CID: {d.encaminhamento.cid ?? '-'} · Diagnóstico: {d.encaminhamento.diagnostico ?? '-'}</Text>
                  <Text size="sm">Investigação: {d.encaminhamento.investigacao ?? '-'}</Text>
                </Paper>
              )}
              {d.requisicao && (
                <Paper withBorder p="xs">
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      Requisição {d.requisicao.numero} de {fmtData(d.requisicao.data)} ({d.requisicao.situacao})
                    </Text>
                    <Group gap="xs">
                      <Button size="xs" variant="light" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/regulacao/requisicoes/${d.requisicao.id}/pdf`)}>
                        Imprimir requisição
                      </Button>
                      {d.requisicao.situacao !== 'CANCELADO' && (
                        <Button
                          size="xs"
                          color="red"
                          variant="subtle"
                          onClick={async () => {
                            const j = await pedirTexto('Excluir requisição de exames', 'Justificativa (fica no histórico de cancelamentos do paciente)', { obrigatorio: true, longo: true });
                            if (j) await acao(`/api/regulacao/requisicoes/${d.requisicao.id}/excluir`, { justificativa: j }, 'Requisição excluída.');
                          }}
                        >
                          Excluir requisição
                        </Button>
                      )}
                    </Group>
                  </Group>
                  <Text size="sm">Dados clínicos: {d.requisicao.dados_clinicos ?? '-'}</Text>
                  <Text size="sm">Justificativa: {d.requisicao.justificativa ?? '-'}</Text>
                </Paper>
              )}
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="agendar" pt="xs">
            {s.decisao !== 'AUTORIZADO' && pendente && (
              <Alert color="yellow" mb="xs">
                Autorize a solicitação para liberar o agendamento nas vagas reservadas à regulação.
              </Alert>
            )}
            <TabelaSimples
              linhas={vagas}
              vazio="Não há vagas de regulação livres para esta especialidade/exame."
              colunas={[
                { titulo: 'Data', valor: (v: any) => `${fmtData(v.data)} ${v.hora}` },
                { titulo: 'Agenda', valor: (v: any) => v.agenda },
                { titulo: 'Unidade', valor: (v: any) => v.unidade },
                { titulo: 'Profissional', valor: (v: any) => v.profissional ?? '-' },
                {
                  titulo: '',
                  valor: (v: any) => (
                    <Button size="compact-xs" disabled={s.decisao !== 'AUTORIZADO' || !pendente} leftSection={<IconCalendarPlus size={12} />} onClick={() => void agendar(v.id)}>
                      Agendar
                    </Button>
                  ),
                },
              ]}
            />
          </Tabs.Panel>
          <Tabs.Panel value="prontuario" pt="xs">
            <ScrollArea h={480}>
              {(prontuario?.atendimentos ?? []).map((a: any) => (
                <Paper key={a.id} withBorder p="xs" mb={6}>
                  <Text size="sm" fw={600}>
                    {fmtDataHora(a.entrada_em)} · {a.unidade} · {a.profissional ?? '-'} {a.especialidade ? `(${a.especialidade})` : ''}
                  </Text>
                  {a.cid && <Text size="xs">CID: {a.cid}</Text>}
                  {['queixa', 'subjetivo', 'objetivo', 'avaliacao', 'plano'].map((k) =>
                    a[k] ? (
                      <Text key={k} size="xs">
                        <b>{k.toUpperCase()}:</b> {a[k]}
                      </Text>
                    ) : null,
                  )}
                </Paper>
              ))}
              {prontuario && !prontuario.atendimentos.length && (
                <Text size="sm" c="dimmed">
                  Sem atendimentos registrados.
                </Text>
              )}
              {prontuario?.encaminhamentos?.length > 0 && (
                <TabelaSimples
                  linhas={prontuario.encaminhamentos}
                  colunas={[
                    { titulo: 'Encaminhamento', valor: (e: any) => fmtData(e.data) },
                    { titulo: 'Especialidade', valor: (e: any) => e.especialidade },
                    { titulo: 'Urgência', valor: (e: any) => e.urgencia },
                    { titulo: 'Diagnóstico', valor: (e: any) => e.diagnostico },
                    { titulo: 'Situação', valor: (e: any) => e.situacao },
                  ]}
                />
              )}
            </ScrollArea>
          </Tabs.Panel>
          <Tabs.Panel value="exames" pt="xs">
            <TabelaSimples
              linhas={exames}
              colunas={[
                { titulo: 'Data', valor: (e: any) => fmtData(e.data) },
                { titulo: 'Requisição', valor: (e: any) => e.numero },
                { titulo: 'Exame', valor: (e: any) => e.exame },
                { titulo: 'Situação', valor: (e: any) => e.situacao },
                { titulo: 'Resultado', valor: (e: any) => (e.resultado_arquivo_id ? <a href={urlArquivo(e.resultado_arquivo_id)} target="_blank" rel="noreferrer">laudo</a> : <Text size="xs">{e.resultado_texto ?? '-'}</Text>) },
                { titulo: 'Solicitante', valor: (e: any) => e.solicitante },
              ]}
            />
          </Tabs.Panel>
          <Tabs.Panel value="cancelamentos" pt="xs">
            <TabelaSimples
              linhas={cancelamentos}
              colunas={[
                { titulo: 'Data', valor: (c: any) => fmtDataHora(c.data) },
                { titulo: 'Tipo', valor: (c: any) => c.tipo },
                { titulo: 'Documento', valor: (c: any) => c.documento },
                { titulo: 'Justificativa', valor: (c: any) => c.justificativa },
                { titulo: 'Operador', valor: (c: any) => c.operador },
              ]}
            />
          </Tabs.Panel>
          <Tabs.Panel value="historico" pt="xs">
            <TabelaSimples
              linhas={d.historico}
              colunas={[
                { titulo: 'Data', valor: (h: any) => fmtDataHora(h.criado_em) },
                { titulo: 'Ação', valor: (h: any) => h.acao },
                { titulo: 'De', valor: (h: any) => h.de },
                { titulo: 'Para', valor: (h: any) => h.para },
                { titulo: 'Justificativa', valor: (h: any) => h.justificativa },
                { titulo: 'Operador', valor: (h: any) => h.operador },
              ]}
            />
          </Tabs.Panel>
        </Tabs>
      </Stack>
      {novoTipo && (
        <Modal opened onClose={() => setNovoTipo(null)} title="Alterar o tipo da consulta / exame">
          <Stack gap="xs">
            <SelecaoRef entidade="especialidade" rotulo="Nova especialidade" valor={novoTipo.especialidadeId} aoMudar={(v) => setNovoTipo({ ...novoTipo, especialidadeId: v })} />
            <SelecaoRef entidade="procedimento" rotulo="Novo exame / procedimento" valor={novoTipo.procedimentoId} aoMudar={(v) => setNovoTipo({ ...novoTipo, procedimentoId: v })} />
            <Textarea label="Justificativa" required value={novoTipo.justificativa} onChange={(e) => setNovoTipo({ ...novoTipo, justificativa: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button
                disabled={(!novoTipo.especialidadeId && !novoTipo.procedimentoId) || novoTipo.justificativa.trim().length < 3}
                onClick={() => {
                  const corpo = { justificativa: novoTipo.justificativa, ...(novoTipo.especialidadeId ? { especialidadeId: novoTipo.especialidadeId } : {}), ...(novoTipo.procedimentoId ? { procedimentoId: novoTipo.procedimentoId } : {}) };
                  setNovoTipo(null);
                  void acao(`/api/regulacao/solicitacoes/${id}/alterar-tipo`, corpo, 'Tipo da solicitação alterado.');
                }}
              >
                Alterar
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Drawer>
  );
}

function NovaSolicitacao({ aoFechar }: { aoFechar: (ok: boolean) => void }) {
  const [f, setF] = useState<Record<string, any>>({ prioridade: 'AZUL', justificativa: '' });
  async function salvar() {
    try {
      const r = await comConfirmacao((ok) => api.post('/api/regulacao/solicitacoes', { ...f, confirmarAvisos: ok }), 'Requisição já existente');
      if (r) {
        notificarOk('Solicitação incluída na fila da regulação.');
        aoFechar(true);
      }
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} title="Nova solicitação regulada">
      <Stack gap="xs">
        <SelecaoRef entidade="paciente" rotulo="Paciente" obrigatorio valor={f.pacienteId} aoMudar={(v) => setF({ ...f, pacienteId: v })} />
        <SelecaoRef entidade="especialidade" rotulo="Especialidade (consulta)" valor={f.especialidadeId} aoMudar={(v) => setF({ ...f, especialidadeId: v })} />
        <SelecaoRef entidade="procedimento" rotulo="Exame / procedimento" valor={f.procedimentoId} aoMudar={(v) => setF({ ...f, procedimentoId: v })} />
        <Select
          label="Classificação"
          value={f.prioridade}
          onChange={(v) => setF({ ...f, prioridade: v })}
          data={[
            { value: 'AZUL', label: 'Não urgente (azul)' },
            { value: 'AMARELO', label: 'Urgente (amarelo)' },
            { value: 'VERMELHO', label: 'Emergência (vermelho)' },
          ]}
        />
        <Textarea label="Justificativa / dados clínicos" required value={f.justificativa} onChange={(e) => setF({ ...f, justificativa: e.currentTarget.value })} />
        <Group justify="flex-end">
          <Button disabled={!f.pacienteId || (!f.especialidadeId && !f.procedimentoId) || f.justificativa.trim().length < 3} onClick={() => void salvar()}>
            Incluir na fila
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TelaRegulacao() {
  useTituloJanela('Regulação - fila regulada');
  const [filtro, setFiltro] = useState<Record<string, any>>({ situacao: 'AGUARDANDO' });
  const [linhas, setLinhas] = useState<any[]>([]);
  const [aberto, setAberto] = useState<number | null>(null);
  const [nova, setNova] = useState(false);
  const [lote, setLote] = useState(5);
  const carregar = () => api.get('/api/regulacao/fila', filtro).then(setLinhas).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [filtro]);
  async function agendarEmOrdem() {
    if (!filtro.especialidadeId && !filtro.procedimentoId) return notificarErro(new Error('Filtre a especialidade ou o exame para agendar a fila em ordem.'));
    try {
      const r = await api.post('/api/regulacao/agendar-em-ordem', { especialidadeId: filtro.especialidadeId ?? null, procedimentoId: filtro.procedimentoId ?? null, quantidade: lote });
      notificarOk(`${r.agendados.length} solicitação(ões) agendada(s) na ordem da classificação${r.semVagas ? '; vagas de regulação esgotadas' : ''}.`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Regulação - lista de espera regulada</Title>
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setNova(true)}>
          Nova solicitação regulada
        </Button>
      </Group>
      <Paper withBorder p="sm">
        <Group align="flex-end" gap="xs">
          <Select
            label="Situação"
            w={160}
            value={filtro.situacao}
            onChange={(v) => setFiltro({ ...filtro, situacao: v ?? 'AGUARDANDO' })}
            data={[
              { value: 'AGUARDANDO', label: 'Aguardando' },
              { value: 'AGENDADO', label: 'Agendadas' },
              { value: 'DEVOLVIDO', label: 'Devolvidas' },
              { value: 'CANCELADO', label: 'Negadas / canceladas' },
              { value: 'TODAS', label: 'Todas' },
            ]}
          />
          <Select label="Decisão" w={160} clearable value={filtro.decisao ?? null} onChange={(v) => setFiltro({ ...filtro, decisao: v })} data={['PENDENTE', 'AUTORIZADO', 'NEGADO', 'DEVOLVIDO', 'AGENDADO']} />
          <Select label="Classificação" w={170} clearable value={filtro.prioridade ?? null} onChange={(v) => setFiltro({ ...filtro, prioridade: v })} data={Object.entries(ROTULO).map(([value, label]) => ({ value, label }))} />
          <div style={{ minWidth: 240 }}>
            <SelecaoRef entidade="especialidade" rotulo="Especialidade" valor={filtro.especialidadeId} aoMudar={(v) => setFiltro({ ...filtro, especialidadeId: v })} />
          </div>
          <div style={{ minWidth: 240 }}>
            <SelecaoRef entidade="procedimento" rotulo="Exame / procedimento" valor={filtro.procedimentoId} aoMudar={(v) => setFiltro({ ...filtro, procedimentoId: v })} />
          </div>
          <NumberInput label="Agendar próximos" w={120} min={1} max={100} value={lote} onChange={(v) => setLote(Number(v) || 1)} />
          <Button variant="light" leftSection={<IconCalendarPlus size={14} />} onClick={() => void agendarEmOrdem()}>
            Agendar em ordem
          </Button>
        </Group>
      </Paper>
      <Paper withBorder>
        <Table striped highlightOnHover fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Classificação</Table.Th>
              <Table.Th>Paciente</Table.Th>
              <Table.Th>Especialidade / exame</Table.Th>
              <Table.Th>Solicitante</Table.Th>
              <Table.Th>Inclusão</Table.Th>
              <Table.Th>Espera</Table.Th>
              <Table.Th>Decisão</Table.Th>
              <Table.Th>Regulador</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {linhas.map((l) => (
              <Table.Tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setAberto(l.id)}>
                <Table.Td>
                  <Badge color={COR[l.prioridade]}>{ROTULO[l.prioridade]}</Badge>
                </Table.Td>
                <Table.Td>
                  {l.paciente}
                  <Text size="xs" c="dimmed">
                    {l.idade} anos · CNS {l.cns ?? '-'}
                  </Text>
                </Table.Td>
                <Table.Td>{l.especialidade ?? l.procedimento}</Table.Td>
                <Table.Td>
                  {l.unidade_solicitante}
                  <Text size="xs" c="dimmed">
                    {l.profissional_solicitante}
                  </Text>
                </Table.Td>
                <Table.Td>{fmtData(l.incluido_em)}</Table.Td>
                <Table.Td>{l.dias_espera} dia(s)</Table.Td>
                <Table.Td>
                  <Badge variant="light" color={COR_DECISAO[l.decisao]}>
                    {l.decisao}
                  </Badge>
                </Table.Td>
                <Table.Td>{l.regulador ?? '-'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!linhas.length && (
          <Text size="sm" c="dimmed" p="sm">
            Nenhuma solicitação na fila com os filtros informados.
          </Text>
        )}
      </Paper>
      {aberto && <DetalheSolicitacao id={aberto} aoFechar={() => setAberto(null)} aoMudar={() => void carregar()} />}
      {nova && <NovaSolicitacao aoFechar={(ok) => (setNova(false), ok && void carregar())} />}
    </Stack>
  );
}

registrarTela({ id: 'regulacao', titulo: 'Fila regulada', menu: 'Regulação', padrao: '/t/regulacao', permissao: 'regulacao:consultar', modulo: 'REG', palavras: ['regulador', 'auditor', 'autorizar', 'lista de espera', 'classificação'], ordem: 1, render: () => <TelaRegulacao /> });
registrarMenuRelatorios('REG', 'Regulação', 'regulacao:consultar');
