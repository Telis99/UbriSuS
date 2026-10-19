// RAAS (TR 1.2.44, 1.2.13.1.30, 1.2.13.1.31, 1.2.13.1.36): registros psicossociais e de atenção domiciliar
// por competência, geração das ações a partir dos atendimentos, espelho, exportação e importação do arquivo.
import { useEffect, useState } from 'react';
import { ActionIcon, Badge, Button, FileButton, Group, Modal, Paper, SegmentedControl, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconDownload, IconFileImport, IconFileText, IconPlus, IconPrinter, IconRefresh } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api, urlArquivo } from '@/api';
import { abrirPdf, fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, TabelaSimples } from '@/componentes/comum';
import { Formulario } from '@/genericos/Formulario';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const LOCAL: Record<string, string> = { C: 'Serviço', T: 'Território', D: 'Domicílio' };

function TelaRaas() {
  useTituloJanela('RAAS - atenção psicossocial e domiciliar');
  const { abrir } = useJanelas();
  const [competencia, setCompetencia] = useState(dayjs().format('YYYYMM'));
  const [tipo, setTipo] = useState('');
  const [unidadeId, setUnidadeId] = useState<number | null>(null);
  const [dados, setDados] = useState<any>(null);
  const [aberto, setAberto] = useState<any>(null);
  const [acoes, setAcoes] = useState<any[]>([]);
  const [novo, setNovo] = useState(false);
  const [importacao, setImportacao] = useState<any>(null);
  const carregar = () => /^\d{6}$/.test(competencia) && api.get('/api/raas/registros', { competencia, tipo, unidadeId }).then(setDados).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [competencia, tipo, unidadeId]);
  useEffect(() => void (aberto && api.get(`/api/raas/registros/${aberto.id}/acoes`).then(setAcoes).catch(notificarErro)), [aberto]);

  async function gerar() {
    try {
      const r = await api.post('/api/raas/gerar', { competencia });
      notificarOk(`${r.geradas} ação(ões) gerada(s) a partir da produção registrada nos atendimentos.`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function importar(f: File | null) {
    if (!f) return;
    try {
      const conteudo = new TextDecoder('latin1').decode(await f.arrayBuffer());
      const r = await api.post('/api/raas/importar', { conteudo, nome: f.name });
      setImportacao(r);
      notificarOk(`Importação: ${r.registros} RAAS e ${r.acoes} ação(ões).`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>RAAS - Registro das Ações Ambulatoriais de Saúde</Title>
        <Group gap="xs">
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setNovo(true)}>
            Novo RAAS
          </Button>
          <Button size="xs" variant="default" leftSection={<IconFileText size={14} />} onClick={() => abrir('/t/relatorios/RAAS', 'Relatórios RAAS')}>
            Espelho e relatórios
          </Button>
        </Group>
      </Group>
      <Paper withBorder p="sm">
        <Group align="flex-end">
          <TextInput label="Competência (AAAAMM)" w={150} value={competencia} onChange={(e) => setCompetencia(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} />
          <SegmentedControl
            value={tipo}
            onChange={setTipo}
            data={[
              { value: '', label: 'Todos' },
              { value: 'PSICOSSOCIAL', label: 'Psicossocial' },
              { value: 'DOMICILIAR', label: 'Domiciliar' },
            ]}
          />
          <div style={{ minWidth: 300 }}>
            <SelecaoRef entidade="unidade" rotulo="Estabelecimento" valor={unidadeId} aoMudar={setUnidadeId} />
          </div>
          <Button variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void gerar()}>
            Gerar ações dos atendimentos {dados?.pendentesProducao ? `(${dados.pendentesProducao})` : ''}
          </Button>
          <Button leftSection={<IconDownload size={14} />} onClick={() => void api.arquivo('/api/raas/exportar', { competencia, tipo: tipo || null, unidadeId }).then((r) => { notificarOk(`Arquivo ${r.nome} gerado.`); void carregar(); }).catch(notificarErro)}>
            Exportar arquivo RAAS
          </Button>
          <FileButton onChange={(f) => void importar(f)} accept=".txt,text/plain">
            {(props) => (
              <Button {...props} variant="default" leftSection={<IconFileImport size={14} />}>
                Importar RAAS
              </Button>
            )}
          </FileButton>
        </Group>
        {importacao?.criticas?.length > 0 && (
          <Stack gap={0} mt="xs">
            {importacao.criticas.slice(0, 15).map((c: string) => (
              <Text key={c} size="xs" c="red">
                {c}
              </Text>
            ))}
          </Stack>
        )}
      </Paper>
      <Paper withBorder>
        <Table striped highlightOnHover fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tipo</Table.Th>
              <Table.Th>Usuário</Table.Th>
              <Table.Th>Estabelecimento</Table.Th>
              <Table.Th>Admissão</Table.Th>
              <Table.Th>CID</Table.Th>
              <Table.Th>Ações</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th w={70} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(dados?.registros ?? []).map((r: any) => (
              <Table.Tr key={r.id} onClick={() => setAberto(r)} style={{ cursor: 'pointer' }}>
                <Table.Td>
                  <Badge size="sm" color={r.tipo === 'DOMICILIAR' ? 'orange' : 'grape'} variant="light">
                    {r.tipo === 'DOMICILIAR' ? `AD ${r.modalidade_ad ?? ''}` : 'PS'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  {r.paciente}
                  <Text size="xs" c="dimmed">
                    CNS {r.cns ?? '-'}
                  </Text>
                </Table.Td>
                <Table.Td>{r.unidade}</Table.Td>
                <Table.Td>{fmtData(r.data_inicio)}</Table.Td>
                <Table.Td>{r.cid ?? '-'}</Table.Td>
                <Table.Td>{r.quantidade ?? 0}</Table.Td>
                <Table.Td>{r.situacao}</Table.Td>
                <Table.Td>
                  <Group gap={2} wrap="nowrap">
                    <ActionIcon size="sm" variant="subtle" title="Espelho" onClick={(e) => (e.stopPropagation(), void abrirPdf(`/api/raas/registros/${r.id}/espelho`))}>
                      <IconPrinter size={14} />
                    </ActionIcon>
                    <Button size="compact-xs" variant="subtle" onClick={(e) => (e.stopPropagation(), abrir(`/e/raas_registro/${r.id}`, 'RAAS'))}>
                      Editar
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!dados?.registros?.length && (
          <Text size="sm" c="dimmed" p="sm">
            Nenhum RAAS na competência. Os atendimentos do CAPS e da atenção domiciliar alimentam o RAAS automaticamente.
          </Text>
        )}
      </Paper>
      <Paper withBorder p="sm">
        <Text size="sm" fw={600} mb="xs">
          Arquivos exportados e importados
        </Text>
        <TabelaSimples
          linhas={dados?.lotes ?? []}
          vazio="Nenhum arquivo."
          colunas={[
            { titulo: 'Operação', valor: (l: any) => l.operacao },
            { titulo: 'Competência', valor: (l: any) => l.competencia },
            { titulo: 'Tipo', valor: (l: any) => l.tipo },
            { titulo: 'RAAS', valor: (l: any) => l.registros },
            { titulo: 'Ações', valor: (l: any) => l.acoes },
            { titulo: 'Data', valor: (l: any) => fmtDataHora(l.gerado_em) },
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
      {aberto && (
        <Modal opened onClose={() => setAberto(null)} title={`Ações - ${aberto.paciente}`} size="xl">
          <TabelaSimples
            linhas={acoes}
            colunas={[
              { titulo: 'Data', valor: (a: any) => fmtData(a.data) },
              { titulo: 'Ação', valor: (a: any) => a.acao },
              { titulo: 'Qtd.', valor: (a: any) => a.quantidade },
              { titulo: 'Profissional', valor: (a: any) => `${a.profissional ?? '-'} ${a.cbo_codigo ?? ''}` },
              { titulo: 'Local', valor: (a: any) => LOCAL[a.local] ?? a.local },
              { titulo: 'Origem', valor: (a: any) => <Text size="xs">{a.origem}</Text> },
            ]}
          />
          <Group justify="flex-end" mt="sm">
            <Button size="xs" variant="light" onClick={() => abrir(`/e/raas_registro/${aberto.id}`, 'RAAS')}>
              Registrar ação manualmente
            </Button>
          </Group>
        </Modal>
      )}
      {novo && (
        <Modal opened onClose={() => setNovo(false)} title="Novo RAAS" size="70rem">
          <Formulario entidade="raas_registro" emModal iniciais={{ competencia, tipo: tipo || 'PSICOSSOCIAL' }} aoSalvar={() => (setNovo(false), carregar())} aoCancelar={() => setNovo(false)} />
        </Modal>
      )}
    </Stack>
  );
}

registrarTela({ id: 'raas', titulo: 'RAAS psicossocial e domiciliar', menu: 'RAAS', padrao: '/t/raas', permissao: 'raas_registro:consultar', modulo: 'RAAS', palavras: ['raas', 'psicossocial', 'atenção domiciliar', 'melhor em casa'], ordem: 1, render: () => <TelaRaas /> });
registrarMenuRelatorios('RAAS', 'RAAS', 'raas_registro:exportar');
