// APAC (TR 1.2.13.1.18 a 1.2.13.1.20): laudos de solicitação/autorização, autorização com a próxima
// numeração disponível, negativa, cancelamento, encerramento, vínculo da produção e arquivo APAC do SIA.
import { useEffect, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Menu, Modal, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDots, IconDownload, IconPlus, IconPrinter } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api, urlArquivo } from '@/api';
import { useAuth } from '@/auth/Auth';
import { abrirPdf, fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, TabelaSimples } from '@/componentes/comum';
import { Formulario } from '@/genericos/Formulario';
import { pedirTexto } from '@/genericos/dialogos';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { registrarTela } from '../registro';

const COR: Record<string, string> = { SOLICITADO: 'blue', AUTORIZADO: 'green', NEGADO: 'red', CANCELADO: 'gray', ENCERRADO: 'violet' };
const TIPO: Record<string, string> = { '1': 'Inicial', '2': 'Continuidade', '3': 'Única' };

function ModalAutorizarApac({ laudo, aoFechar }: { laudo: any; aoFechar: (ok: boolean) => void }) {
  const { eu } = useAuth();
  const [f, setF] = useState<{ numero: string; autorizadorId: number | null }>({ numero: '', autorizadorId: eu?.profissionalId ?? null });
  useEffect(() => void api.get('/api/aih/proximo-numero', { tipo: 'APAC', unidadeId: laudo.unidade_executante_id }).then((r) => setF((x) => ({ ...x, numero: r.numero ?? '' }))).catch(notificarErro), [laudo.unidade_executante_id]);
  async function confirmar() {
    try {
      const r = await api.post(`/api/apac/laudos/${laudo.id}/autorizar`, f);
      notificarOk(`APAC ${r.numero} autorizada, válida até ${fmtData(r.validadeFim)}.`);
      void abrirPdf(`/api/apac/laudos/${laudo.id}/pdf`);
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} title={`Autorizar APAC - ${laudo.paciente}`}>
      <Stack gap="xs">
        <Text size="sm">{laudo.procedimento}</Text>
        <TextInput label="Número da APAC (próximo disponível pré-carregado)" value={f.numero} onChange={(e) => setF({ ...f, numero: e.currentTarget.value.replace(/\D/g, '').slice(0, 13) })} />
        <SelecaoRef entidade="profissional" rotulo="Autorizador" obrigatorio filtro={{ autorizador_aih: true }} valor={f.autorizadorId} aoMudar={(v) => setF({ ...f, autorizadorId: v })} />
        <Group justify="flex-end">
          <Button disabled={!f.autorizadorId} onClick={() => void confirmar()}>
            Autorizar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TelaApac() {
  useTituloJanela('APAC - laudos e autorizações');
  const { abrir } = useJanelas();
  const { pode } = useAuth();
  const [situacao, setSituacao] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [linhas, setLinhas] = useState<any[]>([]);
  const [novo, setNovo] = useState(false);
  const [autorizar, setAutorizar] = useState<any>(null);
  const [competencia, setCompetencia] = useState(dayjs().format('YYYYMM'));
  const [lotes, setLotes] = useState<any[]>([]);
  const autoriza = pode('apac_autorizacao:executar', 'FAT');
  const carregar = () => {
    api.get('/api/apac/laudos', { situacao, busca }).then(setLinhas).catch(notificarErro);
    api.get('/api/apac/lotes').then(setLotes).catch(() => {});
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [situacao]);
  async function acao(url: string, rotulo: string, pedirMotivo = true) {
    const motivo = pedirMotivo ? await pedirTexto(rotulo, 'Motivo', { obrigatorio: true }) : '';
    if (motivo === null) return;
    try {
      const r = await api.post(url, pedirMotivo ? { motivo } : {});
      notificarOk(r?.vinculados !== undefined ? `${r.vinculados} procedimento(s) da produção vinculado(s).` : 'Operação registrada.');
      carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>APAC - procedimentos ambulatoriais de alta complexidade</Title>
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setNovo(true)}>
          Novo laudo de APAC
        </Button>
      </Group>
      <Paper withBorder p="sm">
        <Group align="flex-end">
          <Select label="Situação" clearable data={['SOLICITADO', 'AUTORIZADO', 'NEGADO', 'CANCELADO', 'ENCERRADO']} value={situacao} onChange={setSituacao} />
          <TextInput label="Paciente ou nº da APAC" value={busca} onChange={(e) => setBusca(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && carregar()} />
          <Button variant="light" onClick={carregar}>
            Pesquisar
          </Button>
        </Group>
      </Paper>
      <Paper withBorder>
        <Table striped highlightOnHover fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Laudo</Table.Th>
              <Table.Th>Solicitação</Table.Th>
              <Table.Th>Tipo</Table.Th>
              <Table.Th>Paciente</Table.Th>
              <Table.Th>Procedimento</Table.Th>
              <Table.Th>Executante</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th>Nº APAC / validade</Table.Th>
              <Table.Th>Proc. realizados</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {linhas.map((l) => (
              <Table.Tr key={l.id}>
                <Table.Td>{l.numero_laudo}</Table.Td>
                <Table.Td>{fmtData(l.data_solicitacao)}</Table.Td>
                <Table.Td>{TIPO[l.tipo_apac]}</Table.Td>
                <Table.Td>{l.paciente}</Table.Td>
                <Table.Td>{l.procedimento}</Table.Td>
                <Table.Td>{l.executante}</Table.Td>
                <Table.Td>
                  <Badge size="sm" variant="light" color={COR[l.situacao]}>
                    {l.situacao}
                  </Badge>
                  {l.motivo && (
                    <Text size="xs" c="dimmed">
                      {l.motivo}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {l.numero_apac ?? '-'}
                  {l.validade_inicio && (
                    <Text size="xs" c="dimmed">
                      {fmtData(l.validade_inicio)} a {fmtData(l.validade_fim)}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{l.procedimentos}</Table.Td>
                <Table.Td>
                  <Menu withinPortal position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" size="sm">
                        <IconDots size={14} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => abrir(`/e/apac_laudo/${l.id}`, `APAC ${l.numero_laudo}`)}>Abrir / procedimentos realizados</Menu.Item>
                      <Menu.Item leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/apac/laudos/${l.id}/pdf`)}>
                        Imprimir laudo de APAC
                      </Menu.Item>
                      {autoriza && l.situacao === 'SOLICITADO' && (
                        <>
                          <Menu.Item color="green" onClick={() => setAutorizar(l)}>
                            Autorizar
                          </Menu.Item>
                          <Menu.Item color="red" onClick={() => void acao(`/api/apac/laudos/${l.id}/negar`, 'Negar APAC')}>
                            Negar
                          </Menu.Item>
                        </>
                      )}
                      {l.situacao === 'AUTORIZADO' && <Menu.Item onClick={() => void acao(`/api/apac/laudos/${l.id}/vincular-producao`, '', false)}>Vincular produção do paciente</Menu.Item>}
                      {autoriza && l.situacao === 'AUTORIZADO' && <Menu.Item onClick={() => void acao(`/api/apac/laudos/${l.id}/encerrar`, 'Encerrar APAC')}>Encerrar</Menu.Item>}
                      {autoriza && ['SOLICITADO', 'AUTORIZADO'].includes(l.situacao) && (
                        <Menu.Item color="red" onClick={() => void acao(`/api/apac/laudos/${l.id}/cancelar`, 'Cancelar APAC')}>
                          Cancelar
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
      <Paper withBorder p="sm">
        <Text size="sm" fw={600} mb="xs">
          Arquivo APAC para o SIA (cabeçalho 01, registros 14 e 13)
        </Text>
        <Group align="flex-end" mb="xs">
          <TextInput label="Competência (AAAAMM)" value={competencia} onChange={(e) => setCompetencia(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} w={160} />
          <Button
            leftSection={<IconDownload size={16} />}
            onClick={() =>
              void api
                .arquivo('/api/apac/exportar', { competencia })
                .then((r) => {
                  notificarOk(`Arquivo ${r.nome} gerado.`);
                  carregar();
                })
                .catch(notificarErro)
            }
          >
            Gerar arquivo APAC
          </Button>
        </Group>
        <TabelaSimples
          linhas={lotes}
          vazio="Nenhum arquivo gerado."
          colunas={[
            { titulo: 'Competência', valor: (l: any) => l.competencia },
            { titulo: 'APACs', valor: (l: any) => l.apacs },
            { titulo: 'Linhas', valor: (l: any) => l.linhas },
            { titulo: 'Controle', valor: (l: any) => l.campo_controle },
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
      {novo && (
        <Modal opened onClose={() => setNovo(false)} title="Novo laudo de APAC" size="70rem">
          <Formulario
            entidade="apac_laudo"
            emModal
            iniciais={{ data_solicitacao: dayjs().format('YYYY-MM-DD') }}
            aoSalvar={(r) => {
              setNovo(false);
              notificarOk('Laudo de APAC incluído.');
              void abrirPdf(`/api/apac/laudos/${r.id}/pdf`);
              carregar();
            }}
            aoCancelar={() => setNovo(false)}
          />
        </Modal>
      )}
      {autorizar && <ModalAutorizarApac laudo={autorizar} aoFechar={(ok) => (setAutorizar(null), ok && carregar())} />}
    </Stack>
  );
}

registrarTela({ id: 'apac', titulo: 'APAC - laudos e autorizações', menu: 'Faturamento/APAC', padrao: '/t/apac', permissao: 'apac_laudo:consultar', modulo: 'FAT', palavras: ['alta complexidade', 'hemodiálise', 'quimioterapia', 'apac'], ordem: 1, render: () => <TelaApac /> });
