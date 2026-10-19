// Faturamento SIA/SUS (TR 1.2.13): competência, críticas SIGTAP, geração do BPA (agrupado ou por
// unidade), importação de prestadores, digitação de produção e prévias.
import { useEffect, useState } from 'react';
import { ActionIcon, Badge, Button, Checkbox, FileButton, Grid, Group, NumberInput, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconDownload, IconFileImport, IconFileText, IconRefresh, IconTrash } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api, urlArquivo } from '@/api';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { fmtDataHora, notificarErro, notificarOk, SelecaoRef, Situacao, TabelaSimples } from '@/componentes/comum';
import { registrarMenuRelatorios } from './Relatorios';
import { registrarTela } from './registro';

const moeda = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function TelaFaturamento() {
  useTituloJanela('Faturamento - BPA');
  const { abrir } = useJanelas();
  const [competencia, setCompetencia] = useState(dayjs().format('YYYYMM'));
  const [unidadeId, setUnidadeId] = useState<number | null>(null);
  const [dados, setDados] = useState<any>(null);
  const [porUnidade, setPorUnidade] = useState(false);
  const [fechar, setFechar] = useState(false);
  const [incluirCriticas, setIncluirCriticas] = useState(false);
  const [importacao, setImportacao] = useState<any>(null);

  const carregar = () => /^\d{6}$/.test(competencia) && api.get('/api/faturamento/resumo', { competencia, unidadeId }).then(setDados).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [competencia, unidadeId]);

  async function revalidar() {
    try {
      const r = await api.post('/api/faturamento/revalidar', { competencia });
      notificarOk(`${r.total} registro(s) revalidado(s); ${r.criticas} com crítica.`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function gerar() {
    if (porUnidade && !unidadeId) return notificarErro(new Error('Selecione a unidade para gerar o BPA individual da unidade.'));
    try {
      const r = await api.arquivo('/api/faturamento/bpa', { competencia, unidadeId: porUnidade ? unidadeId : null, fecharCompetencia: fechar, incluirCriticas });
      notificarOk(`Arquivo ${r.nome} gerado.`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function importar(arquivo: File | null) {
    if (!arquivo) return;
    try {
      const conteudo = new TextDecoder('latin1').decode(await arquivo.arrayBuffer());
      const r = await api.post('/api/faturamento/importar-bpa', { conteudo });
      setImportacao(r);
      notificarOk(`${r.importadas} linha(s) importada(s) da competência ${r.competencia}.`);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }

  const totais = (dados?.linhas ?? []).reduce((s: any, l: any) => ({ registros: s.registros + l.registros, quantidade: s.quantidade + l.quantidade, valor: s.valor + Number(l.valor), criticas: s.criticas + (l.situacao === 'CRITICA' ? l.registros : 0) }), {
    registros: 0,
    quantidade: 0,
    valor: 0,
    criticas: 0,
  });
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Faturamento ambulatorial (SIA/SUS)</Title>
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<IconFileText size={14} />} onClick={() => abrir('/t/relatorios/FAT', 'Relatórios')}>
            Prévias e boletins impressos
          </Button>
          <Button size="xs" variant="default" onClick={() => abrir('/t/digitacao-producao', 'Digitação de produção')}>
            Digitação de produção
          </Button>
        </Group>
      </Group>
      <Paper withBorder p="sm">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 6, md: 2 }}>
            <TextInput label="Competência (AAAAMM)" value={competencia} onChange={(e) => setCompetencia(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 4 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade" valor={unidadeId} aoMudar={setUnidadeId} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Group gap="xs" justify="flex-end">
              <Badge size="lg" color={dados?.situacao === 'ABERTA' ? 'teal' : 'gray'}>
                Competência {dados?.situacao ?? '-'}
              </Badge>
              <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void revalidar()}>
                Revalidar críticas SIGTAP
              </Button>
            </Group>
          </Grid.Col>
        </Grid>
      </Paper>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        {[
          ['Registros', totais.registros],
          ['Procedimentos', totais.quantidade],
          ['Valor estimado', moeda(totais.valor)],
          ['Com crítica', totais.criticas],
        ].map(([r, v]) => (
          <Paper key={r as string} withBorder p="sm">
            <Text size="xs" c="dimmed">
              {r}
            </Text>
            <Text size="xl" fw={700} c={r === 'Com crítica' && Number(v) > 0 ? 'red' : undefined}>
              {v}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>
      <Grid gutter="sm">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Paper withBorder p="sm">
            <Text size="sm" fw={600} mb="xs">
              Produção por instrumento e situação
            </Text>
            <TabelaSimples
              linhas={dados?.linhas ?? []}
              colunas={[
                { titulo: 'Instrumento', valor: (l: any) => (l.instrumento === 'BPA_I' ? 'BPA individualizado' : 'BPA consolidado') },
                { titulo: 'Situação', valor: (l: any) => <Situacao valor={l.situacao} /> },
                { titulo: 'Registros', valor: (l: any) => l.registros },
                { titulo: 'Quantidade', valor: (l: any) => l.quantidade },
                { titulo: 'Valor', valor: (l: any) => moeda(l.valor) },
              ]}
            />
            <Text size="sm" fw={600} mt="md" mb="xs">
              Críticas SIGTAP ({dados?.criticas?.length ?? 0})
            </Text>
            <TabelaSimples
              linhas={dados?.criticas ?? []}
              vazio="Nenhuma crítica na competência."
              colunas={[
                { titulo: 'Data', valor: (l: any) => dayjs(l.data).format('DD/MM') },
                { titulo: 'Unidade', valor: (l: any) => l.unidade },
                { titulo: 'Procedimento', valor: (l: any) => l.procedimento },
                { titulo: 'Profissional / CBO', valor: (l: any) => `${l.profissional ?? '-'} ${l.cbo_codigo ?? ''}` },
                { titulo: 'Crítica', valor: (l: any) => <Text size="xs" c="red">{l.critica}</Text> },
                {
                  titulo: '',
                  valor: (l: any) => (
                    <Button size="compact-xs" variant="subtle" onClick={() => abrir(`/e/producao/${l.id}`, 'Produção')}>
                      Corrigir
                    </Button>
                  ),
                },
              ]}
            />
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack gap="sm">
            <Paper withBorder p="sm">
              <Text size="sm" fw={600} mb="xs">
                Gerar arquivo BPA (layout SIA/SUS)
              </Text>
              <Stack gap={6}>
                <Checkbox label="Arquivo da unidade selecionada (desmarcado = um arquivo para todas as unidades)" checked={porUnidade} onChange={(e) => setPorUnidade(e.currentTarget.checked)} />
                <Checkbox label="Incluir registros com crítica" checked={incluirCriticas} onChange={(e) => setIncluirCriticas(e.currentTarget.checked)} />
                <Checkbox label="Marcar a competência como enviada (nova produção vai para a próxima competência)" checked={fechar} onChange={(e) => setFechar(e.currentTarget.checked)} />
                <Button leftSection={<IconDownload size={16} />} onClick={() => void gerar()}>
                  Gerar e baixar BPA
                </Button>
              </Stack>
            </Paper>
            <Paper withBorder p="sm">
              <Text size="sm" fw={600} mb="xs">
                Importar BPA de prestadores
              </Text>
              <FileButton onChange={(f) => void importar(f)} accept=".txt,.*,text/plain">
                {(props) => (
                  <Button {...props} variant="light" leftSection={<IconFileImport size={16} />}>
                    Selecionar arquivo
                  </Button>
                )}
              </FileButton>
              {importacao && (
                <Stack gap={2} mt="xs">
                  <Text size="xs">
                    Competência {importacao.competencia}: {importacao.importadas} linha(s) importada(s), {importacao.criticas.length} crítica(s).
                  </Text>
                  {importacao.criticas.slice(0, 20).map((c: string) => (
                    <Text key={c} size="xs" c="red">
                      {c}
                    </Text>
                  ))}
                </Stack>
              )}
            </Paper>
            <Paper withBorder p="sm">
              <Text size="sm" fw={600} mb="xs">
                Arquivos gerados
              </Text>
              <TabelaSimples
                linhas={dados?.lotes ?? []}
                vazio="Nenhum arquivo gerado nesta competência."
                colunas={[
                  { titulo: 'Gerado em', valor: (l: any) => fmtDataHora(l.gerado_em) },
                  { titulo: 'Unidade', valor: (l: any) => l.unidade ?? 'Todas (agrupado)' },
                  { titulo: 'Linhas', valor: (l: any) => l.linhas },
                  { titulo: 'Controle', valor: (l: any) => l.campo_controle },
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
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function TelaDigitacao() {
  useTituloJanela('Digitação de produção');
  const [f, setF] = useState<Record<string, any>>({ data: dayjs().format('YYYY-MM-DD') });
  const [itens, setItens] = useState<{ chave: number; procedimentoId: number | null; rotulo?: string; quantidade: number; pacienteId: number | null }[]>([{ chave: 1, procedimentoId: null, quantidade: 1, pacienteId: null }]);
  async function gravar() {
    try {
      const r = await api.post('/api/faturamento/digitacao', { unidadeId: f.unidadeId, profissionalId: f.profissionalId ?? null, data: f.data, itens: itens.filter((i) => i.procedimentoId).map(({ procedimentoId, quantidade, pacienteId }) => ({ procedimentoId, quantidade, pacienteId })) });
      const criticas = r.filter((x: any) => x && !x.valido);
      notificarOk(`${r.length} lançamento(s) gravado(s)${criticas.length ? `; ${criticas.length} com crítica: ${criticas.flatMap((x: any) => x.criticas).join(' ')}` : ''}.`);
      setItens([{ chave: Date.now(), procedimentoId: null, quantidade: 1, pacienteId: null }]);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm" maw={1100}>
      <Title order={4}>Digitação da produção ambulatorial</Title>
      <Text size="sm" c="dimmed">
        Para unidades ainda não informatizadas. Os lançamentos passam pelas mesmas validações SIGTAP (sexo, idade, CBO) da produção automática.
      </Text>
      <Paper withBorder p="sm">
        <Grid gutter="xs">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade" obrigatorio valor={f.unidadeId} aoMudar={(v) => setF({ ...f, unidadeId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <SelecaoRef entidade="profissional" rotulo="Profissional (para BPA-I/CBO)" valor={f.profissionalId} aoMudar={(v) => setF({ ...f, profissionalId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <DateInput label="Data do atendimento" valueFormat="DD/MM/YYYY" maxDate={new Date()} value={new Date(f.data + 'T12:00')} onChange={(d) => d && setF({ ...f, data: dayjs(d).format('YYYY-MM-DD') })} />
          </Grid.Col>
        </Grid>
        <Table mt="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Procedimento (SIGTAP)</Table.Th>
              <Table.Th w={110}>Quantidade</Table.Th>
              <Table.Th>Paciente (BPA-I)</Table.Th>
              <Table.Th w={40} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {itens.map((i) => (
              <Table.Tr key={i.chave}>
                <Table.Td>
                  <SelecaoRef entidade="procedimento" rotulo="" valor={i.procedimentoId} aoMudar={(v, r) => setItens(itens.map((x) => (x.chave === i.chave ? { ...x, procedimentoId: v, rotulo: r } : x)))} />
                </Table.Td>
                <Table.Td>
                  <NumberInput min={1} value={i.quantidade} onChange={(v) => setItens(itens.map((x) => (x.chave === i.chave ? { ...x, quantidade: Number(v) || 1 } : x)))} />
                </Table.Td>
                <Table.Td>
                  <SelecaoRef entidade="paciente" rotulo="" valor={i.pacienteId} aoMudar={(v) => setItens(itens.map((x) => (x.chave === i.chave ? { ...x, pacienteId: v } : x)))} />
                </Table.Td>
                <Table.Td>
                  <ActionIcon variant="subtle" color="red" onClick={() => setItens(itens.length > 1 ? itens.filter((x) => x.chave !== i.chave) : itens)}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group justify="space-between" mt="xs">
          <Button variant="subtle" size="xs" onClick={() => setItens([...itens, { chave: Date.now(), procedimentoId: null, quantidade: 1, pacienteId: null }])}>
            Adicionar linha
          </Button>
          <Button disabled={!f.unidadeId || !itens.some((i) => i.procedimentoId)} onClick={() => void gravar()}>
            Gravar produção
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}

registrarTela({ id: 'faturamento', titulo: 'BPA e críticas', menu: 'Faturamento', padrao: '/t/faturamento', permissao: 'faturamento_bpa:executar', modulo: 'FAT', palavras: ['bpa', 'sia', 'sigtap', 'produção', 'competência'], ordem: 1, render: () => <TelaFaturamento /> });
registrarTela({ id: 'digitacao-producao', titulo: 'Digitação de produção', menu: 'Faturamento', padrao: '/t/digitacao-producao', permissao: 'producao:incluir', modulo: 'FAT', palavras: ['lançar procedimento'], ordem: 2, render: () => <TelaDigitacao /> });
registrarMenuRelatorios('FAT', 'Faturamento', 'producao:exportar');
