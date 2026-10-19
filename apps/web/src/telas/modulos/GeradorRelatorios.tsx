// Gerador de relatórios e consultas (TR 1.1.1.64.3 a 1.1.1.64.8, 1.1.2.1.18): o operador monta relatórios
// a partir das estruturas de dados, de SQL de consulta ou da cópia de relatórios padrão, com layout,
// agrupamentos, gráfico, formato de impressão, privilégios por perfil e controle de versões.
import { useEffect, useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Checkbox, Grid, Group, Modal, MultiSelect, Paper, ScrollArea, SegmentedControl, Select, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconCopy, IconEye, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { api } from '@/api';
import { useTituloJanela } from '@/shell/Janelas';
import { pedirTexto } from '@/genericos/dialogos';
import { fmtDataHora, notificarErro, notificarOk, SelecaoRef } from '@/componentes/comum';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

const FORMATOS = [
  { value: 'texto', label: 'Texto' },
  { value: 'inteiro', label: 'Inteiro' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'moeda', label: 'Moeda' },
  { value: 'data', label: 'Data' },
  { value: 'data_hora', label: 'Data e hora' },
  { value: 'percentual', label: 'Percentual' },
  { value: 'booleano', label: 'Sim/Não' },
];
const TIPOS_FILTRO = [
  { value: 'texto', label: 'Texto' },
  { value: 'data', label: 'Data' },
  { value: 'inteiro', label: 'Número' },
  { value: 'ref', label: 'Cadastro (referência)' },
  { value: 'booleano', label: 'Sim/Não' },
];

interface Coluna {
  campo: string;
  titulo: string;
  formato?: string;
  total?: boolean;
  visivel?: boolean;
}
interface Filtro {
  nome: string;
  rotulo: string;
  tipo: string;
  ref?: string;
  obrigatorio?: boolean;
}

function Editor({ registro, aoFechar }: { registro: any | null; aoFechar: (ok: boolean) => void }) {
  const [d, setD] = useState<any>(registro ?? { origem: 'ENTIDADE', modulo: 'TEC', colunas: [], filtros: [], agrupar: [], perfis: [] });
  const [estruturas, setEstruturas] = useState<any[]>([]);
  const [bases, setBases] = useState<any[]>([]);
  const [modulos, setModulos] = useState<{ value: string; label: string }[]>([]);
  const [perfis, setPerfis] = useState<{ value: string; label: string }[]>([]);
  const [amostra, setAmostra] = useState<any>(null);
  useEffect(() => {
    api.get('/api/gerador/estruturas').then(setEstruturas).catch(notificarErro);
    api.get('/api/gerador/relatorios-base').then(setBases).catch(() => {});
    api.get('/api/meta/relatorio_personalizado').then((m) => setModulos((m.campos.find((c: any) => c.nome === 'modulo')?.opcoes ?? []).map(([value, label]: [string, string]) => ({ value, label })))).catch(() => {});
    api.get('/api/e/perfil/opcoes', { q: '' }).then((r: any[]) => setPerfis(r.map((x) => ({ value: String(x.id), label: x.rotulo })))).catch(() => {});
  }, []);
  const estrutura = estruturas.find((e) => e.nome === d.entidade);
  const colunas: Coluna[] = d.colunas ?? [];
  const filtros: Filtro[] = d.filtros ?? [];
  const set = (p: Record<string, unknown>) => setD({ ...d, ...p });
  const moverColuna = (i: number, delta: number) => {
    const c = [...colunas];
    const [x] = c.splice(i, 1);
    c.splice(Math.max(0, Math.min(c.length, i + delta)), 0, x);
    set({ colunas: c });
  };

  async function testarSql() {
    try {
      const r = await api.post('/api/gerador/testar-sql', { sql: d.sql, valores: {} });
      setAmostra(r);
      if (!colunas.length) set({ colunas: r.campos.map((c: string) => ({ campo: c, titulo: c, visivel: true })) });
      const params = [...new Set([...(d.sql as string).matchAll(/(?<!:):([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]))];
      if (params.length && !filtros.length) set({ filtros: params.map((p) => ({ nome: p, rotulo: p, tipo: /data|de$|ate$/.test(p) ? 'data' : 'texto', obrigatorio: true })) });
    } catch (e) {
      notificarErro(e);
    }
  }
  async function salvar() {
    const corpo = { ...d, agrupar: d.agrupar ?? [], perfis: (d.perfis ?? []).map(Number) };
    for (const k of ['id', 'criado_em', 'criado_por', 'atualizado_em', 'atualizado_por', '__rotulo', 'criado_por__rotulo', 'formato_id__rotulo', 'situacao', 'versao']) delete corpo[k];
    try {
      if (registro?.id) await api.put(`/api/e/relatorio_personalizado/${registro.id}`, corpo);
      else await api.post('/api/e/relatorio_personalizado', corpo);
      notificarOk('Relatório salvo como rascunho. Use "Pré-visualizar" e depois "Publicar".');
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }

  return (
    <Modal opened onClose={() => aoFechar(false)} title={registro?.id ? `Editar ${registro.titulo} (versão ${registro.versao})` : 'Novo relatório'} size="90%">
      <Stack gap="sm">
        <Grid gutter="xs">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <TextInput label="Identificador" required disabled={!!registro?.id} value={d.codigo ?? ''} onChange={(e) => set({ codigo: e.currentTarget.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <TextInput label="Título" required value={d.titulo ?? ''} onChange={(e) => set({ titulo: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Select label="Módulo (menu)" data={modulos} value={d.modulo} onChange={(v) => set({ modulo: v })} searchable />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <TextInput label="Grupo" value={d.grupo ?? ''} onChange={(e) => set({ grupo: e.currentTarget.value })} />
          </Grid.Col>
        </Grid>
        <SegmentedControl
          value={d.origem}
          onChange={(v) => set({ origem: v, colunas: [], filtros: [] })}
          data={[
            { value: 'ENTIDADE', label: 'Estrutura de dados' },
            { value: 'SQL', label: 'Instrução SQL' },
            { value: 'RELATORIO', label: 'Cópia de relatório existente' },
          ]}
        />
        {d.origem === 'ENTIDADE' && (
          <Grid gutter="xs">
            <Grid.Col span={{ base: 12, md: 4 }}>
              <Select
                label="Estrutura de dados"
                searchable
                data={estruturas.map((e) => ({ value: e.nome, label: e.titulo }))}
                value={d.entidade ?? null}
                onChange={(v) => {
                  const e = estruturas.find((x) => x.nome === v);
                  set({ entidade: v, colunas: (e?.campos ?? []).slice(0, 8).map((c: any) => ({ campo: c.nome, titulo: c.rotulo, visivel: true, formato: ['inteiro', 'decimal', 'moeda', 'data', 'data_hora'].includes(c.tipo) ? c.tipo : undefined })), filtros: [] });
                }}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 8 }}>
              <MultiSelect
                label="Campos disponíveis para filtro"
                data={(estrutura?.campos ?? []).map((c: any) => ({ value: c.nome, label: c.rotulo }))}
                value={filtros.map((f) => f.nome.split('__')[0])}
                onChange={(v) =>
                  set({
                    filtros: v.map((n) => {
                      const c = estrutura.campos.find((x: any) => x.nome === n);
                      const tipo = c.tipo === 'ref' ? 'ref' : ['data', 'data_hora'].includes(c.tipo) ? 'data' : ['inteiro', 'decimal', 'moeda'].includes(c.tipo) ? 'inteiro' : c.tipo === 'booleano' ? 'booleano' : c.opcoes ? 'opcao' : 'texto';
                      return { nome: n, rotulo: c.rotulo, tipo, ref: c.ref, opcoes: c.opcoes };
                    }),
                  })
                }
              />
            </Grid.Col>
          </Grid>
        )}
        {d.origem === 'SQL' && (
          <Stack gap={4}>
            <Textarea
              label="Instrução SQL (somente consulta; use :nome para parâmetros informados pelo operador)"
              autosize
              minRows={4}
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
              value={d.sql ?? ''}
              onChange={(e) => set({ sql: e.currentTarget.value })}
            />
            <Group>
              <Button size="xs" variant="light" onClick={() => void testarSql()}>
                Testar instrução e detectar campos
              </Button>
              {amostra && (
                <Text size="xs" c="dimmed">
                  {amostra.campos.length} campo(s): {amostra.campos.join(', ')} · {amostra.amostra.length} linha(s) de amostra
                </Text>
              )}
            </Group>
          </Stack>
        )}
        {d.origem === 'RELATORIO' && (
          <Select
            label="Relatório de origem"
            searchable
            data={bases.map((b) => ({ value: b.id, label: `${b.titulo} (${b.modulo})` }))}
            value={d.relatorio_base ?? null}
            onChange={(v) => set({ relatorio_base: v, titulo: d.titulo || bases.find((b) => b.id === v)?.titulo })}
          />
        )}
        <Grid gutter="sm">
          <Grid.Col span={{ base: 12, lg: 7 }}>
            <Paper withBorder p="xs">
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={600}>
                  Colunas (layout)
                </Text>
                <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => set({ colunas: [...colunas, { campo: '', titulo: '', visivel: true }] })}>
                  Coluna
                </Button>
              </Group>
              <ScrollArea h={260}>
                <Table fz="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Exibir</Table.Th>
                      <Table.Th>Campo</Table.Th>
                      <Table.Th>Título</Table.Th>
                      <Table.Th>Formato</Table.Th>
                      <Table.Th>Total</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {colunas.map((c, i) => (
                      <Table.Tr key={i}>
                        <Table.Td>
                          <Checkbox size="xs" checked={c.visivel !== false} onChange={(e) => set({ colunas: colunas.map((x, j) => (j === i ? { ...x, visivel: e.currentTarget.checked } : x)) })} />
                        </Table.Td>
                        <Table.Td>
                          {d.origem === 'ENTIDADE' ? (
                            <Select size="xs" data={(estrutura?.campos ?? []).map((x: any) => ({ value: x.nome, label: x.rotulo }))} value={c.campo || null} onChange={(v) => set({ colunas: colunas.map((x, j) => (j === i ? { ...x, campo: v ?? '', titulo: x.titulo || (estrutura.campos.find((y: any) => y.nome === v)?.rotulo ?? '') } : x)) })} searchable />
                          ) : (
                            <TextInput size="xs" value={c.campo} onChange={(e) => set({ colunas: colunas.map((x, j) => (j === i ? { ...x, campo: e.currentTarget.value } : x)) })} />
                          )}
                        </Table.Td>
                        <Table.Td>
                          <TextInput size="xs" value={c.titulo} onChange={(e) => set({ colunas: colunas.map((x, j) => (j === i ? { ...x, titulo: e.currentTarget.value } : x)) })} />
                        </Table.Td>
                        <Table.Td w={120}>
                          <Select size="xs" data={FORMATOS} value={c.formato ?? 'texto'} onChange={(v) => set({ colunas: colunas.map((x, j) => (j === i ? { ...x, formato: v === 'texto' ? undefined : (v ?? undefined) } : x)) })} />
                        </Table.Td>
                        <Table.Td>
                          <Checkbox size="xs" checked={!!c.total} onChange={(e) => set({ colunas: colunas.map((x, j) => (j === i ? { ...x, total: e.currentTarget.checked } : x)) })} />
                        </Table.Td>
                        <Table.Td>
                          <Group gap={0} wrap="nowrap">
                            <ActionIcon size="xs" variant="subtle" onClick={() => moverColuna(i, -1)}>
                              <IconArrowUp size={12} />
                            </ActionIcon>
                            <ActionIcon size="xs" variant="subtle" onClick={() => moverColuna(i, 1)}>
                              <IconArrowDown size={12} />
                            </ActionIcon>
                            <ActionIcon size="xs" variant="subtle" color="red" onClick={() => set({ colunas: colunas.filter((_, j) => j !== i) })}>
                              <IconTrash size={12} />
                            </ActionIcon>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                {!colunas.length && d.origem === 'RELATORIO' && (
                  <Text size="xs" c="dimmed" p="xs">
                    Sem colunas definidas: o layout do relatório de origem é mantido. Use "Pré-visualizar" para ver as colunas e ajustá-las.
                  </Text>
                )}
              </ScrollArea>
            </Paper>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Stack gap="xs">
              {d.origem === 'SQL' && (
                <Paper withBorder p="xs">
                  <Text size="sm" fw={600} mb={4}>
                    Parâmetros (filtros informados pelo operador)
                  </Text>
                  {filtros.map((f, i) => (
                    <Group key={i} gap={4} wrap="nowrap" mb={4}>
                      <TextInput size="xs" w={90} value={f.nome} onChange={(e) => set({ filtros: filtros.map((x, j) => (j === i ? { ...x, nome: e.currentTarget.value } : x)) })} />
                      <TextInput size="xs" placeholder="Rótulo" value={f.rotulo} onChange={(e) => set({ filtros: filtros.map((x, j) => (j === i ? { ...x, rotulo: e.currentTarget.value } : x)) })} />
                      <Select size="xs" w={120} data={TIPOS_FILTRO} value={f.tipo} onChange={(v) => set({ filtros: filtros.map((x, j) => (j === i ? { ...x, tipo: v ?? 'texto' } : x)) })} />
                      {f.tipo === 'ref' && <TextInput size="xs" w={90} placeholder="entidade" value={f.ref ?? ''} onChange={(e) => set({ filtros: filtros.map((x, j) => (j === i ? { ...x, ref: e.currentTarget.value } : x)) })} />}
                      <Checkbox size="xs" title="Obrigatório" checked={!!f.obrigatorio} onChange={(e) => set({ filtros: filtros.map((x, j) => (j === i ? { ...x, obrigatorio: e.currentTarget.checked } : x)) })} />
                    </Group>
                  ))}
                  <Button size="compact-xs" variant="subtle" onClick={() => set({ filtros: [...filtros, { nome: '', rotulo: '', tipo: 'texto' }] })}>
                    Adicionar parâmetro
                  </Button>
                </Paper>
              )}
              <MultiSelect label="Agrupar por (quebras com subtotais)" data={colunas.filter((c) => c.campo).map((c) => ({ value: c.campo, label: c.titulo || c.campo }))} value={d.agrupar ?? []} onChange={(v) => set({ agrupar: v })} />
              <Group grow>
                <Select label="Gráfico" clearable data={[{ value: 'barra', label: 'Barras' }, { value: 'linha', label: 'Linhas' }]} value={d.grafico?.tipo ?? null} onChange={(v) => set({ grafico: v ? { ...(d.grafico ?? {}), tipo: v } : null })} />
                <Select label="Eixo X" data={colunas.map((c) => c.campo).filter(Boolean)} value={d.grafico?.x ?? null} onChange={(v) => set({ grafico: { ...(d.grafico ?? { tipo: 'barra' }), x: v } })} disabled={!d.grafico} />
                <Select label="Valor" data={colunas.map((c) => c.campo).filter(Boolean)} value={d.grafico?.y ?? null} onChange={(v) => set({ grafico: { ...(d.grafico ?? { tipo: 'barra' }), y: v } })} disabled={!d.grafico} />
              </Group>
              <SelecaoRef entidade="formato_relatorio" rotulo="Formato de impressão (vazio = padrão)" valor={d.formato_id} aoMudar={(v) => set({ formato_id: v })} />
              <MultiSelect label="Perfis com acesso (vazio = todos do módulo)" data={perfis} value={(d.perfis ?? []).map(String)} onChange={(v) => set({ perfis: v.map(Number) })} searchable />
              <TextInput label="Notas da versão" value={d.observacao ?? ''} onChange={(e) => set({ observacao: e.currentTarget.value })} />
            </Stack>
          </Grid.Col>
        </Grid>
        <Group justify="flex-end">
          <Button onClick={() => void salvar()} disabled={!d.codigo || !d.titulo}>
            Salvar rascunho
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Previa({ registro, aoFechar }: { registro: any; aoFechar: () => void }) {
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [r, setR] = useState<any>(null);
  const executar = () => api.post(`/api/gerador/${registro.id}/previa`, { filtros }).then(setR).catch(notificarErro);
  return (
    <Modal opened onClose={aoFechar} title={`Pré-visualização: ${registro.titulo} (versão ${registro.versao})`} size="90%">
      <Stack gap="xs">
        <Group align="flex-end">
          {(registro.filtros ?? []).map((f: any) => (
            <TextInput key={f.nome} size="xs" label={f.rotulo} placeholder={f.tipo === 'data' ? 'AAAA-MM-DD' : ''} value={filtros[f.nome] ?? ''} onChange={(e) => setFiltros({ ...filtros, [f.nome]: e.currentTarget.value })} />
          ))}
          <Button size="xs" leftSection={<IconEye size={14} />} onClick={() => void executar()}>
            Executar
          </Button>
        </Group>
        {r && (
          <ScrollArea h={460}>
            <Text size="xs" c="dimmed">
              {r.linhas.length} registro(s){r.agrupar?.length ? ` · agrupado por ${r.agrupar.join(', ')}` : ''}
            </Text>
            <Table fz="xs" striped withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  {r.colunas.map((c: any) => (
                    <Table.Th key={c.campo}>{c.titulo}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {r.linhas.map((l: any, i: number) => (
                  <Table.Tr key={i}>
                    {r.colunas.map((c: any) => (
                      <Table.Td key={c.campo}>{l[c.campo] == null ? '' : String(l[c.campo])}</Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </Modal>
  );
}

function TelaGerador() {
  useTituloJanela('Gerador de relatórios');
  const [lista, setLista] = useState<any[]>([]);
  const [editando, setEditando] = useState<any | null | undefined>(undefined);
  const [previa, setPrevia] = useState<any>(null);
  const carregar = () =>
    api
      .get('/api/e/relatorio_personalizado', { tamanho: 500, ordem: 'codigo,versao desc' })
      .then((r) => setLista(r.linhas))
      .catch(notificarErro);
  useEffect(() => void carregar(), []);
  const grupos = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of lista) m.set(r.codigo, [...(m.get(r.codigo) ?? []), r]);
    return [...m.entries()];
  }, [lista]);
  async function acao(url: string, corpo: unknown, msg: string) {
    try {
      await api.post(url, corpo);
      notificarOk(msg);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Gerador de relatórios e consultas</Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditando(null)}>
          Novo relatório
        </Button>
      </Group>
      <Alert color="blue" py={6}>
        Os relatórios publicados aparecem no menu "Relatórios" do módulo escolhido, com filtros, gráfico, impressão e exportação. Alterações são feitas em novas versões, sem afetar a versão em uso até a publicação.
      </Alert>
      {grupos.map(([codigo, versoes]) => (
        <Paper key={codigo} withBorder p="sm">
          <Text fw={600}>
            {versoes[0].titulo} <Text span size="xs" c="dimmed">({codigo} · {versoes[0].modulo})</Text>
          </Text>
          <Table fz="xs" mt={4}>
            <Table.Tbody>
              {versoes.map((v) => (
                <Table.Tr key={v.id}>
                  <Table.Td w={70}>v{v.versao}</Table.Td>
                  <Table.Td w={120}>
                    <Badge size="xs" color={v.situacao === 'PUBLICADO' ? 'teal' : v.situacao === 'RASCUNHO' ? 'blue' : 'gray'}>
                      {v.situacao}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{v.origem}</Table.Td>
                  <Table.Td>{fmtDataHora(v.atualizado_em ?? v.criado_em)}</Table.Td>
                  <Table.Td>{v.observacao}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end">
                      {v.situacao === 'RASCUNHO' && (
                        <Button size="compact-xs" variant="light" onClick={() => setEditando(v)}>
                          Editar
                        </Button>
                      )}
                      <Button size="compact-xs" variant="subtle" leftSection={<IconEye size={12} />} onClick={() => setPrevia(v)}>
                        Pré-visualizar
                      </Button>
                      {v.situacao === 'RASCUNHO' && (
                        <Button size="compact-xs" color="teal" leftSection={<IconUpload size={12} />} onClick={() => void acao(`/api/gerador/${v.id}/publicar`, {}, 'Versão publicada.')}>
                          Publicar
                        </Button>
                      )}
                      <Button size="compact-xs" variant="subtle" onClick={() => void acao(`/api/gerador/${v.id}/copiar`, {}, 'Nova versão criada em rascunho.')}>
                        Nova versão
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        leftSection={<IconCopy size={12} />}
                        onClick={async () => {
                          const novo = await pedirTexto('Copiar relatório', 'Identificador do novo relatório');
                          if (novo) void acao(`/api/gerador/${v.id}/copiar`, { novoCodigo: novo }, 'Cópia criada.');
                        }}
                      >
                        Copiar
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      ))}
      {!grupos.length && <Text c="dimmed">Nenhum relatório personalizado.</Text>}
      {editando !== undefined && <Editor registro={editando} aoFechar={(ok) => (setEditando(undefined), ok && void carregar())} />}
      {previa && <Previa registro={previa} aoFechar={() => setPrevia(null)} />}
    </Stack>
  );
}

registrarTela({
  id: 'gerador-relatorios',
  titulo: 'Gerador de relatórios',
  menu: 'Administração/Relatórios',
  padrao: '/t/gerador-relatorios',
  permissao: 'gerador_relatorio:consultar',
  modulo: 'TEC',
  palavras: ['relatório personalizado', 'consulta', 'sql', 'layout'],
  ordem: 1,
  render: () => <TelaGerador />,
});
// Relatórios (padrão e personalizados) acessíveis no menu de cada módulo (TR 1.1.1.64.6).
registrarMenuRelatorios('AMB', 'Atendimento');
registrarMenuRelatorios('PEP', 'Prontuário');
registrarMenuRelatorios('TEC', 'Administração/Relatórios');
