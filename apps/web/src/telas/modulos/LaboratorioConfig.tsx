// Laboratório - configuração e apoio (TR 1.2.47 e 1.2.48): visualização prévia do layout do exame,
// editor de modelos de laudo e de mapa (texto formatado ou HTML), editor de etiquetas com prévia em
// tempo real, materiais/entradas/inutilizações, monitor de interfaceamento, controle de qualidade
// (Levey-Jennings) e laboratórios de apoio.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  ColorInput,
  Grid,
  Group,
  Menu,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconArrowDown,
  IconArrowUp,
  IconBarcode,
  IconBold,
  IconCode,
  IconCopy,
  IconDeviceFloppy,
  IconFileTypePdf,
  IconItalic,
  IconKey,
  IconList,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconStrikethrough,
  IconSubscript,
  IconSuperscript,
  IconTable,
  IconTrash,
  IconUnderline,
  IconUpload,
} from '@tabler/icons-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useAuth } from '@/auth/Auth';
import { abrirPdf, comConfirmacao, fmtData, fmtDataHora, notificarErro, notificarOk, SelecaoRef, TabelaSimples, useCarregar } from '@/componentes/comum';
import { registrarExtensaoFormulario } from '@/genericos/Formulario';
import { confirmar } from '@/genericos/dialogos';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';
import { FormResultado, lerComoDataUri, ListaAlertas, pdfPost, SituacaoItem, useAvaliacao } from './LaboratorioComum';

const L = '/api/laboratorio';
const I = '/api/interfaceamento';
const hoje = () => dayjs().format('YYYY-MM-DD');
const CampoData = ({ rotulo, valor, aoMudar }: { rotulo: string; valor: string | null | undefined; aoMudar: (v: string | null) => void }) => (
  <DateInput size="xs" label={rotulo} valueFormat="DD/MM/YYYY" clearable value={valor ? new Date(valor + 'T12:00') : null} onChange={(d) => aoMudar(d ? dayjs(d).format('YYYY-MM-DD') : null)} />
);
const moeda = (v: any) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------------------------------------------------------------------------
// Layout do exame com visualização prévia (TR 1.2.47.7, 1.2.47.27, 1.2.47.28)
// ---------------------------------------------------------------------------
function TelaLayoutExame({ query }: { query: URLSearchParams }) {
  useTituloJanela('Layout do exame');
  const { abrir } = useJanelas();
  const [exameId, setExameId] = useState<number | null>(query.get('exame') ? Number(query.get('exame')) : null);
  const [teste, setTeste] = useState({ sexo: 'F', idade: 40 });
  const [valores, setValores] = useState<Record<string, any>>({});
  const { dados } = useCarregar(() => (exameId ? api.get(`${L}/exames/${exameId}/layout`, teste) : Promise.resolve(null)), [exameId, teste.sexo, teste.idade]);
  const aval = useAvaliacao(exameId ? `${L}/exames/${exameId}/avaliar` : null, valores, teste);
  useEffect(() => setValores({}), [exameId]);
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Layout do exame e visualização prévia do resultado</Title>
      <Group align="flex-end">
        <div style={{ width: 380 }}>
          <SelecaoRef entidade="lab_exame" rotulo="Exame" valor={exameId} aoMudar={setExameId} />
        </div>
        <Select size="xs" w={140} label="Sexo do paciente teste" data={[{ value: 'F', label: 'Feminino' }, { value: 'M', label: 'Masculino' }]} value={teste.sexo} onChange={(v) => setTeste({ ...teste, sexo: v ?? 'F' })} />
        <NumberInput size="xs" w={110} label="Idade (anos)" min={0} max={120} value={teste.idade} onChange={(v) => setTeste({ ...teste, idade: Number(v) || 0 })} />
        <Button size="xs" variant="light" disabled={!exameId} onClick={() => abrir(`/e/lab_exame/${exameId}`)}>
          Editar cadastro, variáveis e referências
        </Button>
        <Button size="xs" leftSection={<IconFileTypePdf size={14} />} disabled={!exameId} onClick={() => void pdfPost(`${L}/exames/${exameId}/previa-laudo`, teste)}>
          Prévia do laudo
        </Button>
      </Group>
      {dados?.exame && (
        <Paper withBorder p="sm">
          <Group gap="xs" mb="xs">
            <Title order={5}>
              {dados.exame.sigla} - {dados.exame.nome}
            </Title>
            <Badge variant="light">{dados.exame.secao}</Badge>
            <Badge variant="light">prazo {dados.exame.prazo_entrega_dias} dia(s)</Badge>
            {dados.exame.usa_interfaceamento && <Badge color="grape">interfaceado</Badge>}
            {dados.exame.quantidade_amostras > 1 && <Badge color="yellow">{dados.exame.quantidade_amostras} amostras</Badge>}
          </Group>
          <Text size="xs" c="dimmed" mb="xs">
            Digite valores de teste para conferir fórmulas, referências por sexo/idade e alertas.
          </Text>
          <ListaAlertas avaliacao={aval} />
          <FormResultado layout={dados.layout} valores={valores} rotulos={{}} avaliacao={aval} predefinidos={dados.predefinidos} aoMudar={(c, v) => setValores((x) => ({ ...x, [c]: v }))} />
        </Paper>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Editor de modelos de laudo e de mapa de trabalho (TR 1.2.47.32 a 1.2.47.37)
// ---------------------------------------------------------------------------
/** Remove scripts, iframes e atributos de evento do HTML do modelo antes de exibi-lo no editor. */
function sanitizar(html: string) {
  return html
    .replace(/<(script|iframe|object|embed|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|iframe|object|embed)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1=""');
}

function EditorRico({ html, aoMudar, campos }: { html: string; aoMudar: (h: string) => void; campos: [string, string][] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fonte, setFonte] = useState(false);
  const [cor, setCor] = useState('#c00000');
  useEffect(() => {
    if (ref.current && !fonte && ref.current.innerHTML !== html) ref.current.innerHTML = sanitizar(html);
  }, [html, fonte]);
  const cmd = (c: string, v?: string) => {
    ref.current?.focus();
    document.execCommand(c, false, v);
    aoMudar(ref.current?.innerHTML ?? '');
  };
  const inserir = (h: string) => cmd('insertHTML', h);
  const imagem = async (f: File | null) => f && inserir(`<img src="${await lerComoDataUri(f)}" width="160">`);
  const botao = (icone: React.ReactNode, titulo: string, fn: () => void) => (
    <Tooltip label={titulo}>
      <ActionIcon variant="default" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={fn}>
        {icone}
      </ActionIcon>
    </Tooltip>
  );
  return (
    <Stack gap={4}>
      <Group gap={4}>
        {botao(<IconBold size={14} />, 'Negrito', () => cmd('bold'))}
        {botao(<IconItalic size={14} />, 'Itálico', () => cmd('italic'))}
        {botao(<IconUnderline size={14} />, 'Sublinhado', () => cmd('underline'))}
        {botao(<IconStrikethrough size={14} />, 'Tachado', () => cmd('strikeThrough'))}
        {botao(<IconSubscript size={14} />, 'Subscrito', () => cmd('subscript'))}
        {botao(<IconSuperscript size={14} />, 'Sobrescrito', () => cmd('superscript'))}
        <Select size="xs" w={90} placeholder="Tamanho" data={[{ value: '1', label: '7 pt' }, { value: '2', label: '8 pt' }, { value: '3', label: '9 pt' }, { value: '4', label: '11 pt' }, { value: '5', label: '14 pt' }, { value: '6', label: '18 pt' }]} onChange={(v) => v && cmd('fontSize', v)} />
        <Select size="xs" w={110} placeholder="Fonte" data={['Roboto', 'Arial', 'Times New Roman', 'Courier New']} onChange={(v) => v && cmd('fontName', v)} />
        <ColorInput size="xs" w={110} value={cor} onChange={setCor} />
        {botao(<Text size="xs" fw={700} c={cor}>A</Text>, 'Aplicar cor', () => cmd('foreColor', cor))}
        {botao(<IconAlignLeft size={14} />, 'Alinhar à esquerda', () => cmd('justifyLeft'))}
        {botao(<IconAlignCenter size={14} />, 'Centralizar', () => cmd('justifyCenter'))}
        {botao(<IconAlignRight size={14} />, 'Alinhar à direita', () => cmd('justifyRight'))}
        {botao(<IconAlignJustified size={14} />, 'Justificar', () => cmd('justifyFull'))}
        {botao(<IconList size={14} />, 'Lista', () => cmd('insertUnorderedList'))}
        {botao(<Text size="xs">⇥</Text>, 'Tabulação', () => inserir('&emsp;&emsp;'))}
        {botao(<IconTable size={14} />, 'Inserir tabela', () => inserir('<table border="1"><tr><th>Coluna 1</th><th>Coluna 2</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></table><p></p>'))}
        <Tooltip label="Inserir imagem/figura">
          <ActionIcon variant="default" size="sm" component="label">
            <IconPhoto size={14} />
            <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => void imagem(e.currentTarget.files?.[0] ?? null)} />
          </ActionIcon>
        </Tooltip>
        <Menu>
          <Menu.Target>
            <Button size="compact-xs" variant="light">
              Inserir campo
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <ScrollArea h={320}>
              {campos.map(([k, r]) => (
                <Menu.Item key={k} onClick={() => (fonte ? aoMudar(html + `{{${k}}}`) : inserir(`{{${k}}}`))}>
                  <Text size="xs">
                    {r} <Code>{`{{${k}}}`}</Code>
                  </Text>
                </Menu.Item>
              ))}
            </ScrollArea>
          </Menu.Dropdown>
        </Menu>
        <Switch size="xs" label={<Group gap={2}><IconCode size={12} />HTML</Group>} checked={fonte} onChange={(e) => setFonte(e.currentTarget.checked)} />
      </Group>
      {fonte ? (
        <Textarea autosize minRows={18} styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} value={html} onChange={(e) => aoMudar(e.currentTarget.value)} />
      ) : (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={() => aoMudar(ref.current?.innerHTML ?? '')}
          style={{ minHeight: 380, border: '1px solid var(--mantine-color-gray-4)', borderRadius: 4, padding: 12, background: 'white', fontFamily: 'Roboto, Arial, sans-serif', fontSize: 12, overflow: 'auto' }}
        />
      )}
    </Stack>
  );
}

function TelaModelos() {
  useTituloJanela('Editor de modelos');
  const [tipo, setTipo] = useState<'laudo' | 'mapa'>('laudo');
  const ent = tipo === 'laudo' ? 'lab_modelo_laudo' : 'lab_mapa_trabalho';
  const { dados: lista, recarregar } = useCarregar(() => api.get(`/api/e/${ent}`, { tamanho: 200 }), [ent]);
  const { dados: campos } = useCarregar(() => api.get(`${L}/modelos/campos`), []);
  const [m, setM] = useState<Record<string, any> | null>(null);
  const [exameTeste, setExameTeste] = useState<number | null>(null);
  const salvar = async () => {
    try {
      const corpo = { nome: m!.nome, exame_id: m!.exame_id ?? null, orientacao: m!.orientacao ?? 'RETRATO', html: m!.html ?? '', ativo: m!.ativo ?? true, ...(tipo === 'laudo' ? { material_id: m!.material_id ?? null } : { secao_id: m!.secao_id ?? null }) };
      const r = m!.id ? await api.put(`/api/e/${ent}/${m!.id}`, corpo) : await api.post(`/api/e/${ent}`, corpo);
      notificarOk('Modelo salvo. Laudos já liberados permanecem com o modelo da época da liberação.');
      setM({ ...m, id: r.id, versao: r.versao });
      void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const previa = () => {
    const exame = exameTeste ?? m?.exame_id;
    if (!exame) return notificarErro(new Error('Selecione um exame para a prévia.'));
    if (tipo === 'laudo') void pdfPost(`${L}/exames/${exame}/previa-laudo`, { html: m?.html ?? '', orientacao: m?.orientacao });
    else if (m?.id) abrirPdf(`${L}/mapa-personalizado/${m.id}`);
  };
  return (
    <Grid p="md" gutter="sm">
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Stack gap="xs">
          <SegmentedControl size="xs" value={tipo} onChange={(v) => (setTipo(v as any), setM(null))} data={[{ value: 'laudo', label: 'Modelos de laudo' }, { value: 'mapa', label: 'Mapas de trabalho' }]} />
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setM({ nome: '', html: '<p></p>', orientacao: 'RETRATO', ativo: true })}>
            Novo modelo
          </Button>
          {(lista?.linhas ?? []).map((x: any) => (
            <Paper key={x.id} withBorder p={6} style={{ cursor: 'pointer', borderColor: m?.id === x.id ? 'var(--mantine-color-blue-6)' : undefined }} onClick={() => setM(x)}>
              <Text size="xs" fw={600}>
                {x.nome}
              </Text>
              <Group gap={4}>
                <Text size="10px" c="dimmed">
                  {x.exame_id__rotulo ?? x.secao_id__rotulo ?? 'geral'} · {x.orientacao?.toLowerCase()}
                  {x.versao ? ` · v${x.versao}` : ''}
                </Text>
                {!x.ativo && <Badge size="xs" color="gray">inativo</Badge>}
              </Group>
            </Paper>
          ))}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 9 }}>
        {m ? (
          <Stack gap="xs">
            <Grid gutter="xs" align="flex-end">
              <Grid.Col span={4}>
                <TextInput size="xs" label="Nome" value={m.nome ?? ''} onChange={(e) => setM({ ...m, nome: e.currentTarget.value })} />
              </Grid.Col>
              <Grid.Col span={3}>
                <SelecaoRef entidade="lab_exame" rotulo="Exame" valor={m.exame_id} aoMudar={(v) => setM({ ...m, exame_id: v })} />
              </Grid.Col>
              <Grid.Col span={2}>
                {tipo === 'laudo' ? (
                  <SelecaoRef entidade="lab_material" rotulo="Material" valor={m.material_id} aoMudar={(v) => setM({ ...m, material_id: v })} />
                ) : (
                  <SelecaoRef entidade="lab_secao" rotulo="Seção" valor={m.secao_id} aoMudar={(v) => setM({ ...m, secao_id: v })} />
                )}
              </Grid.Col>
              <Grid.Col span={2}>
                <Select size="xs" label="Orientação" data={[{ value: 'RETRATO', label: 'Retrato' }, { value: 'PAISAGEM', label: 'Paisagem' }]} value={m.orientacao ?? 'RETRATO'} onChange={(v) => setM({ ...m, orientacao: v })} />
              </Grid.Col>
              <Grid.Col span={1}>
                <Switch size="xs" label="Ativo" checked={m.ativo !== false} onChange={(e) => setM({ ...m, ativo: e.currentTarget.checked })} />
              </Grid.Col>
            </Grid>
            <EditorRico html={m.html ?? ''} aoMudar={(h) => setM((x) => ({ ...x, html: h }))} campos={(tipo === 'laudo' ? campos?.laudo : campos?.mapa) ?? []} />
            <Group justify="space-between">
              <Group gap="xs" align="flex-end">
                {tipo === 'laudo' && (
                  <div style={{ width: 280 }}>
                    <SelecaoRef entidade="lab_exame" rotulo="Exame para a prévia" valor={exameTeste ?? m.exame_id} aoMudar={setExameTeste} />
                  </div>
                )}
                <Button size="xs" variant="light" leftSection={<IconFileTypePdf size={14} />} onClick={previa}>
                  Visualização prévia
                </Button>
              </Group>
              <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} disabled={!m.nome} onClick={() => void salvar()}>
                Salvar modelo
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text c="dimmed" p="md">
            Selecione ou crie um modelo. Use o editor de texto ou o código HTML e insira os campos do exame, da amostra, do resultado e da unidade prestadora.
          </Text>
        )}
      </Grid.Col>
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Etiquetas com visualização em tempo real (TR 1.2.47.43.34 a 1.2.47.43.38)
// ---------------------------------------------------------------------------
interface Linha {
  texto?: string;
  codigoBarras?: string;
  tamanho?: number;
  negrito?: boolean;
  alinhamento?: 'left' | 'center' | 'right';
  altura?: number;
}

function PreviaEtiqueta({ m, linhas, exemplo }: { m: { largura_mm: number; altura_mm: number }; linhas: Linha[]; exemplo: Record<string, string> }) {
  const escala = 4;
  const preencher = (t: string) => t.replace(/\{([\w.]+)\}/g, (_x, k: string) => exemplo[k] ?? '');
  return (
    <div style={{ width: Number(m.largura_mm) * escala, height: Number(m.altura_mm) * escala, border: '1px dashed #888', borderRadius: 4, padding: 1.5 * escala, background: 'white', overflow: 'hidden', fontFamily: 'Roboto, Arial', color: '#000' }}>
      {linhas.map((l, i) =>
        l.codigoBarras ? (
          <div key={i} style={{ height: (l.altura ?? 7) * escala, margin: '2px 0', background: 'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 3px,#000 3px 4px,#fff 4px 7px,#000 7px 8px,#fff 8px 10px)' }} title={exemplo[l.codigoBarras] ?? l.codigoBarras} />
        ) : (
          <div key={i} style={{ fontSize: (l.tamanho ?? 6) * escala * 0.353 * 1.33, fontWeight: l.negrito ? 700 : 400, textAlign: l.alinhamento ?? 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.05 }}>
            {preencher(l.texto ?? '')}
          </div>
        ),
      )}
    </div>
  );
}

function TelaEtiquetas() {
  useTituloJanela('Modelos de etiqueta');
  const { dados: lista, recarregar } = useCarregar(() => api.get('/api/e/lab_modelo_etiqueta', { tamanho: 100 }), []);
  const { dados: info } = useCarregar(() => api.get(`${L}/etiquetas/campos`), []);
  const [m, setM] = useState<Record<string, any> | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const selecionar = (x: any) => (setM(x), setLinhas(x.linhas?.length ? x.linhas : (info?.padrao ?? [])));
  const mudar = (i: number, p: Partial<Linha>) => setLinhas(linhas.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const mover = (i: number, d: number) => {
    const n = [...linhas];
    const [x] = n.splice(i, 1);
    n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x);
    setLinhas(n);
  };
  const salvar = async () => {
    try {
      const corpo = { nome: m!.nome, tipo: m!.tipo ?? 'AMOSTRA', largura_mm: m!.largura_mm, altura_mm: m!.altura_mm, termica: !!m!.termica, padrao: !!m!.padrao, ativo: m!.ativo !== false, linhas };
      const r = m!.id ? await api.put(`/api/e/lab_modelo_etiqueta/${m!.id}`, corpo) : await api.post('/api/e/lab_modelo_etiqueta', corpo);
      setM({ ...m, id: r.id });
      notificarOk('Modelo de etiqueta salvo.');
      void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const campos = info?.campos ?? [];
  return (
    <Grid p="md" gutter="sm">
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Stack gap="xs">
          <Title order={5}>Modelos de etiqueta</Title>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => selecionar({ nome: 'NOVO MODELO', tipo: 'AMOSTRA', largura_mm: 50, altura_mm: 25, termica: true, ativo: true, linhas: [] })}>
            Novo modelo
          </Button>
          {(lista?.linhas ?? []).map((x: any) => (
            <Paper key={x.id} withBorder p={6} style={{ cursor: 'pointer', borderColor: m?.id === x.id ? 'var(--mantine-color-blue-6)' : undefined }} onClick={() => selecionar(x)}>
              <Text size="xs" fw={600}>
                {x.nome}
              </Text>
              <Text size="10px" c="dimmed">
                {x.largura_mm} × {x.altura_mm} mm · {x.termica ? 'térmica' : 'folha'} {x.padrao ? '· padrão' : ''}
              </Text>
            </Paper>
          ))}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 9 }}>
        {m ? (
          <Stack gap="xs">
            <Grid gutter="xs" align="flex-end">
              <Grid.Col span={3}>
                <TextInput size="xs" label="Nome" value={m.nome} onChange={(e) => setM({ ...m, nome: e.currentTarget.value })} />
              </Grid.Col>
              <Grid.Col span={2}>
                <Select size="xs" label="Uso" data={[{ value: 'AMOSTRA', label: 'Amostras' }, { value: 'PROTOCOLO', label: 'Protocolo' }, { value: 'MATERIAL', label: 'Material' }]} value={m.tipo} onChange={(v) => setM({ ...m, tipo: v })} />
              </Grid.Col>
              <Grid.Col span={2}>
                <NumberInput size="xs" label="Largura (mm)" decimalScale={1} value={Number(m.largura_mm)} onChange={(v) => setM({ ...m, largura_mm: Number(v) || 10 })} />
              </Grid.Col>
              <Grid.Col span={2}>
                <NumberInput size="xs" label="Altura (mm)" decimalScale={1} value={Number(m.altura_mm)} onChange={(v) => setM({ ...m, altura_mm: Number(v) || 10 })} />
              </Grid.Col>
              <Grid.Col span={3}>
                <Group gap="xs">
                  <Switch size="xs" label="Térmica" checked={!!m.termica} onChange={(e) => setM({ ...m, termica: e.currentTarget.checked })} />
                  <Switch size="xs" label="Padrão" checked={!!m.padrao} onChange={(e) => setM({ ...m, padrao: e.currentTarget.checked })} />
                </Group>
              </Grid.Col>
            </Grid>
            <Grid gutter="md">
              <Grid.Col span={{ base: 12, md: 7 }}>
                <Stack gap={4}>
                  {linhas.map((l, i) => (
                    <Group key={i} gap={4} wrap="nowrap">
                      {l.codigoBarras !== undefined ? (
                        <Select size="xs" style={{ flex: 1 }} leftSection={<IconBarcode size={14} />} data={campos.map(([value, label]: [string, string]) => ({ value, label }))} value={l.codigoBarras} onChange={(v) => mudar(i, { codigoBarras: v ?? 'amostra.codigo' })} />
                      ) : (
                        <TextInput
                          size="xs"
                          style={{ flex: 1 }}
                          value={l.texto ?? ''}
                          onChange={(e) => mudar(i, { texto: e.currentTarget.value })}
                          rightSection={
                            <Menu>
                              <Menu.Target>
                                <ActionIcon size="xs" variant="subtle">
                                  +
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <ScrollArea h={260}>
                                  {campos.map(([k, r]: [string, string]) => (
                                    <Menu.Item key={k} onClick={() => mudar(i, { texto: `${l.texto ?? ''}{${k}}` })}>
                                      <Text size="xs">{r}</Text>
                                    </Menu.Item>
                                  ))}
                                </ScrollArea>
                              </Menu.Dropdown>
                            </Menu>
                          }
                        />
                      )}
                      {l.codigoBarras !== undefined ? (
                        <NumberInput size="xs" w={70} title="Altura (mm)" value={l.altura ?? 7} onChange={(v) => mudar(i, { altura: Number(v) || 7 })} />
                      ) : (
                        <>
                          <NumberInput size="xs" w={60} title="Tamanho (pt)" decimalScale={1} value={l.tamanho ?? 6} onChange={(v) => mudar(i, { tamanho: Number(v) || 6 })} />
                          <ActionIcon size="sm" variant={l.negrito ? 'filled' : 'default'} onClick={() => mudar(i, { negrito: !l.negrito })}>
                            <IconBold size={12} />
                          </ActionIcon>
                          <ActionIcon size="sm" variant="default" onClick={() => mudar(i, { alinhamento: l.alinhamento === 'center' ? 'right' : l.alinhamento === 'right' ? 'left' : 'center' })}>
                            {l.alinhamento === 'center' ? <IconAlignCenter size={12} /> : l.alinhamento === 'right' ? <IconAlignRight size={12} /> : <IconAlignLeft size={12} />}
                          </ActionIcon>
                        </>
                      )}
                      <ActionIcon size="sm" variant="subtle" onClick={() => mover(i, -1)}>
                        <IconArrowUp size={12} />
                      </ActionIcon>
                      <ActionIcon size="sm" variant="subtle" onClick={() => mover(i, 1)}>
                        <IconArrowDown size={12} />
                      </ActionIcon>
                      <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}>
                        <IconTrash size={12} />
                      </ActionIcon>
                    </Group>
                  ))}
                  <Group gap="xs">
                    <Button size="compact-xs" variant="light" onClick={() => setLinhas([...linhas, { texto: '', tamanho: 6 }])}>
                      + Linha de texto
                    </Button>
                    <Button size="compact-xs" variant="light" onClick={() => setLinhas([...linhas, { codigoBarras: 'amostra.codigo', altura: 7 }])}>
                      + Código de barras
                    </Button>
                    <Button size="compact-xs" variant="subtle" onClick={() => setLinhas(info?.padrao ?? [])}>
                      Restaurar padrão
                    </Button>
                  </Group>
                </Stack>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 5 }}>
                <Text size="xs" c="dimmed" mb={4}>
                  Visualização em tempo real (escala ampliada, dados de exemplo)
                </Text>
                <PreviaEtiqueta m={m as any} linhas={linhas} exemplo={info?.exemplo ?? {}} />
              </Grid.Col>
            </Grid>
            <Group justify="flex-end">
              <Button size="xs" variant="light" leftSection={<IconFileTypePdf size={14} />} onClick={() => void pdfPost(`${L}/etiquetas/previa`, { largura_mm: m.largura_mm, altura_mm: m.altura_mm, termica: !!m.termica, linhas })}>
                Imprimir teste
              </Button>
              <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={() => void salvar()}>
                Salvar
              </Button>
            </Group>
          </Stack>
        ) : (
          <Text c="dimmed" p="md">
            Selecione um modelo para configurar tamanho e conteúdo de cada linha.
          </Text>
        )}
      </Grid.Col>
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Materiais, entradas e inutilizações (TR 1.2.47.40 a 1.2.47.42)
// ---------------------------------------------------------------------------
function TelaMateriais() {
  useTituloJanela('Materiais do laboratório');
  const { abrir } = useJanelas();
  const [f, setF] = useState<Record<string, any>>({ situacao: 'ATIVO' });
  const { dados: linhas, recarregar } = useCarregar(() => api.get<any[]>(`${L}/materiais`, f), [JSON.stringify(f)]);
  const [sel, setSel] = useState<number[]>([]);
  const [prod, setProd] = useState<any>(null);
  const [lotes, setLotes] = useState<any[]>([]);
  const ver = (p: any) => (setProd(p), api.get(`/api/farmacia/produtos/${p.id}/lotes`).then(setLotes).catch(notificarErro));
  const duplicar = async (id: number) => {
    try {
      const r = await api.post(`/api/e/produto/${id}/clonar`);
      notificarOk('Cadastro duplicado.');
      abrir(`/e/produto/${r.id}`);
    } catch (e) {
      notificarErro(e);
    }
  };
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Materiais do laboratório</Title>
        <Group gap="xs">
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => abrir('/e/produto/novo?tipo=LABORATORIO')}>
            Novo material
          </Button>
          <Button size="xs" variant="light" leftSection={<IconBarcode size={14} />} disabled={!sel.length} onClick={() => void pdfPost(`${L}/materiais/etiquetas`, { ids: sel, copias: 1 })}>
            Etiquetas ({sel.length})
          </Button>
        </Group>
      </Group>
      <Paper withBorder p="xs">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 12, md: 4 }}>
            <TextInput size="xs" label="Nome ou código de barras" onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, nome: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="grupo_produto" rotulo="Grupo" valor={f.grupoId} aoMudar={(v) => setF({ ...f, grupoId: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <TextInput size="xs" label="CATMAT" onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, catmat: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Select size="xs" label="Situação cadastral" clearable data={[{ value: 'ATIVO', label: 'Ativo' }, { value: 'INATIVO', label: 'Inativo' }]} value={f.situacao ?? null} onChange={(v) => setF({ ...f, situacao: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 1 }}>
            <Switch size="xs" label="Todos" checked={!!f.todos} onChange={(e) => setF({ ...f, todos: e.currentTarget.checked })} />
          </Grid.Col>
        </Grid>
      </Paper>
      <Grid gutter="sm">
        <Grid.Col span={{ base: 12, md: prod ? 7 : 12 }}>
          <Paper withBorder>
            <ScrollArea h="calc(100vh - 320px)">
              <Table fz="xs" striped highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={28} />
                    <Table.Th>Material</Table.Th>
                    <Table.Th>Grupo</Table.Th>
                    <Table.Th>CATMAT</Table.Th>
                    <Table.Th>Código de barras</Table.Th>
                    <Table.Th ta="right">Saldo</Table.Th>
                    <Table.Th ta="right">Mínimo</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(linhas ?? []).map((p) => (
                    <Table.Tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => void ver(p)}>
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Checkbox size="xs" checked={sel.includes(p.id)} onChange={(e) => setSel(e.currentTarget.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                      </Table.Td>
                      <Table.Td>
                        {p.nome} {!p.ativo && <Badge size="xs" color="gray">inativo</Badge>} {p.similares > 0 && <Badge size="xs" variant="outline">{p.similares} similar(es)</Badge>}
                      </Table.Td>
                      <Table.Td>{p.grupo}</Table.Td>
                      <Table.Td>{p.catmat}</Table.Td>
                      <Table.Td>{p.codigos_barras}</Table.Td>
                      <Table.Td ta="right" c={Number(p.saldo) < Number(p.estoque_minimo ?? 0) ? 'red' : undefined}>
                        {Number(p.saldo).toLocaleString('pt-BR')}
                      </Table.Td>
                      <Table.Td ta="right">{p.estoque_minimo}</Table.Td>
                      <Table.Td onClick={(e) => e.stopPropagation()}>
                        <Group gap={2} wrap="nowrap">
                          <Button size="compact-xs" variant="subtle" onClick={() => abrir(`/e/produto/${p.id}`)}>
                            Cadastro
                          </Button>
                          <Tooltip label="Duplicar cadastro">
                            <ActionIcon size="sm" variant="subtle" onClick={() => void duplicar(p.id)}>
                              <IconCopy size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
        </Grid.Col>
        {prod && (
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Paper withBorder p="sm">
              <Group justify="space-between">
                <Text fw={600} size="sm">
                  {prod.nome}: estoque em todas as unidades
                </Text>
                <ActionIcon variant="subtle" onClick={() => void recarregar()}>
                  <IconRefresh size={14} />
                </ActionIcon>
              </Group>
              <TabelaSimples
                linhas={lotes}
                vazio="Sem lotes com saldo."
                colunas={[
                  { titulo: 'Unidade', valor: (l: any) => l.unidade },
                  { titulo: 'Lote', valor: (l: any) => l.lote },
                  { titulo: 'Validade', valor: (l: any) => <Text size="xs" c={l.vencido ? 'red' : undefined}>{fmtData(l.validade)}</Text> },
                  { titulo: 'Saldo', valor: (l: any) => Number(l.quantidade).toLocaleString('pt-BR') },
                  { titulo: '', valor: (l: any) => (l.bloqueado ? <Badge size="xs" color="red">bloqueado</Badge> : null) },
                ]}
              />
              <Text size="xs" c="dimmed" mt="xs">
                Locais de armazenamento (local, sala, estante e prateleira), estoque mínimo/ideal por unidade e similares/genéricos ficam no cadastro do material.
              </Text>
            </Paper>
          </Grid.Col>
        )}
      </Grid>
    </Stack>
  );
}

function TelaEntradas() {
  useTituloJanela('Entradas de materiais');
  const { eu } = useAuth();
  const [f, setF] = useState<Record<string, any>>({ de: dayjs().subtract(60, 'day').format('YYYY-MM-DD'), ate: hoje() });
  const { dados: linhas, recarregar } = useCarregar(() => api.get<any[]>(`${L}/entradas`, f), [JSON.stringify(f)]);
  const [nova, setNova] = useState<Record<string, any> | null>(null);
  const [itens, setItens] = useState<any[]>([]);
  const [leitura, setLeitura] = useState('');
  const ler = async () => {
    const codigo = leitura.trim();
    if (!codigo) return;
    try {
      const p = await api.get(`/api/farmacia/produto-por-codigo`, { codigo });
      setItens([...itens, { produtoId: p.id, nome: p.nome, lote: '', validade: null, quantidade: 1, valorUnitario: null }]);
      setLeitura('');
    } catch (e) {
      notificarErro(e);
    }
  };
  const salvar = async () => {
    try {
      const r = await comConfirmacao((ok) => api.post(`${L}/entradas`, { ...nova, itens, ignorarDiferencaValor: ok }), 'Valor da nota');
      if (!r) return;
      notificarOk(r.situacao === 'CONFIRMADA' ? 'Entrada confirmada: estoque atualizado.' : `Entrada gravada (${r.situacao}).`);
      setNova(null);
      setItens([]);
      void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Entradas de materiais</Title>
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setNova({ unidadeId: eu?.unidadeAtual, dataEntrada: hoje(), notaSerie: '1' })}>
          Nova entrada
        </Button>
      </Group>
      <Paper withBorder p="xs">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 6, md: 2 }}>
            <CampoData rotulo="Entrada de" valor={f.de} aoMudar={(v) => setF({ ...f, de: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <CampoData rotulo="Até" valor={f.ate} aoMudar={(v) => setF({ ...f, ate: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <TextInput size="xs" label="Nº da nota fiscal" onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, nota: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <TextInput size="xs" label="Fornecedor" onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, fornecedor: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <SelecaoRef entidade="unidade" rotulo="Unidade de saúde" valor={f.unidadeId} aoMudar={(v) => setF({ ...f, unidadeId: v })} />
          </Grid.Col>
        </Grid>
      </Paper>
      <Paper withBorder>
        <TabelaSimples
          linhas={linhas ?? []}
          vazio="Nenhuma entrada no período."
          colunas={[
            { titulo: 'Entrada', valor: (l: any) => fmtData(l.data_entrada) },
            { titulo: 'Compra', valor: (l: any) => fmtData(l.data_compra) },
            { titulo: 'Nota fiscal', valor: (l: any) => `${l.nota_numero ?? '-'}${l.nota_serie ? ` / série ${l.nota_serie}` : ''}` },
            { titulo: 'Fornecedor', valor: (l: any) => l.fornecedor },
            { titulo: 'Unidade', valor: (l: any) => l.unidade },
            { titulo: 'Itens', valor: (l: any) => l.itens },
            { titulo: 'Total', valor: (l: any) => moeda(l.total) },
            { titulo: 'Situação', valor: (l: any) => <Badge size="xs" variant="light">{l.situacao}</Badge> },
          ]}
        />
      </Paper>
      {nova && (
        <Modal opened onClose={() => setNova(null)} title="Nova entrada de materiais" size="xl">
          <Stack gap="xs">
            <Grid gutter="xs">
              <Grid.Col span={6}>
                <SelecaoRef entidade="unidade" rotulo="Unidade de entrada" valor={nova.unidadeId} aoMudar={(v) => setNova({ ...nova, unidadeId: v })} />
              </Grid.Col>
              <Grid.Col span={6}>
                <SelecaoRef entidade="fornecedor" rotulo="Fornecedor" valor={nova.fornecedorId} aoMudar={(v) => setNova({ ...nova, fornecedorId: v })} />
              </Grid.Col>
              <Grid.Col span={3}>
                <TextInput size="xs" label="Nº da nota fiscal" value={nova.notaNumero ?? ''} onChange={(e) => setNova({ ...nova, notaNumero: e.currentTarget.value })} />
              </Grid.Col>
              <Grid.Col span={2}>
                <TextInput size="xs" label="Série" value={nova.notaSerie ?? ''} onChange={(e) => setNova({ ...nova, notaSerie: e.currentTarget.value })} />
              </Grid.Col>
              <Grid.Col span={2}>
                <CampoData rotulo="Data da compra" valor={nova.dataCompra} aoMudar={(v) => setNova({ ...nova, dataCompra: v })} />
              </Grid.Col>
              <Grid.Col span={2}>
                <CampoData rotulo="Data da entrada" valor={nova.dataEntrada} aoMudar={(v) => setNova({ ...nova, dataEntrada: v })} />
              </Grid.Col>
              <Grid.Col span={3}>
                <NumberInput size="xs" label="Valor total da nota" decimalScale={2} value={nova.valorNota ?? ''} onChange={(v) => setNova({ ...nova, valorNota: v === '' ? null : Number(v) })} />
              </Grid.Col>
            </Grid>
            <Group gap="xs" align="flex-end">
              <TextInput size="xs" style={{ flex: 1 }} label="Leitura do código de barras" leftSection={<IconBarcode size={14} />} value={leitura} onChange={(e) => setLeitura(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void ler()} data-autofocus />
              <div style={{ flex: 1 }}>
                <SelecaoRef entidade="produto" rotulo="ou selecione o material" valor={null} filtro={{ tipo: 'LABORATORIO' }} aoMudar={(v, r) => v && setItens([...itens, { produtoId: v, nome: r, lote: '', validade: null, quantidade: 1, valorUnitario: null }])} />
              </div>
            </Group>
            <Table fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Material</Table.Th>
                  <Table.Th>Lote</Table.Th>
                  <Table.Th>Validade</Table.Th>
                  <Table.Th>Quantidade</Table.Th>
                  <Table.Th>Valor unitário</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {itens.map((i, k) => {
                  const m = (p: any) => setItens(itens.map((x, j) => (j === k ? { ...x, ...p } : x)));
                  return (
                    <Table.Tr key={k}>
                      <Table.Td>{i.nome}</Table.Td>
                      <Table.Td>
                        <TextInput size="xs" w={110} value={i.lote} onChange={(e) => m({ lote: e.currentTarget.value })} />
                      </Table.Td>
                      <Table.Td w={140}>
                        <CampoData rotulo="" valor={i.validade} aoMudar={(v) => m({ validade: v })} />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" w={90} min={0} value={i.quantidade} onChange={(v) => m({ quantidade: Number(v) || 0 })} />
                      </Table.Td>
                      <Table.Td>
                        <NumberInput size="xs" w={100} decimalScale={4} value={i.valorUnitario ?? ''} onChange={(v) => m({ valorUnitario: v === '' ? null : Number(v) })} />
                      </Table.Td>
                      <Table.Td>
                        <ActionIcon size="sm" variant="subtle" color="red" onClick={() => setItens(itens.filter((_, j) => j !== k))}>
                          <IconTrash size={12} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
            <Group justify="space-between">
              <Text size="xs">Total dos itens: {moeda(itens.reduce((s, i) => s + i.quantidade * (i.valorUnitario ?? 0), 0))}</Text>
              <Button size="xs" disabled={!itens.length || !nova.notaNumero || itens.some((i) => !i.lote || !i.validade)} leftSection={<IconDeviceFloppy size={14} />} onClick={() => void salvar()}>
                Gravar e confirmar entrada
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}

function TelaInutilizacoes() {
  useTituloJanela('Inutilizações de materiais');
  const { eu } = useAuth();
  const [f, setF] = useState<Record<string, any>>({ de: dayjs().subtract(90, 'day').format('YYYY-MM-DD'), ate: hoje() });
  const { dados: linhas, recarregar } = useCarregar(() => api.get<any[]>(`${L}/inutilizacoes`, f), [JSON.stringify(f)]);
  const [nova, setNova] = useState<Record<string, any> | null>(null);
  const [lotes, setLotes] = useState<any[]>([]);
  useEffect(() => {
    if (!nova?.produto_id || !nova?.unidade_id) return setLotes([]);
    api
      .get(`/api/farmacia/produtos/${nova.produto_id}/lotes`, { unidadeId: nova.unidade_id })
      .then(setLotes)
      .catch(notificarErro);
  }, [nova?.produto_id, nova?.unidade_id]);
  const salvar = async () => {
    try {
      await api.post('/api/e/inutilizacao', nova);
      notificarOk('Inutilização registrada e baixada do estoque.');
      setNova(null);
      void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Acertos e inutilizações</Title>
        <Button size="xs" color="red" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setNova({ data: hoje(), unidade_id: eu?.unidadeAtual })}>
          Nova inutilização
        </Button>
      </Group>
      <Paper withBorder p="xs">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 6, md: 2 }}>
            <CampoData rotulo="De" valor={f.de} aoMudar={(v) => setF({ ...f, de: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <CampoData rotulo="Até" valor={f.ate} aoMudar={(v) => setF({ ...f, ate: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <TextInput size="xs" label="Produto" onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, produto: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 1 }}>
            <TextInput size="xs" label="Lote" onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, lote: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 1 }}>
            <TextInput size="xs" label="Quantidade" onKeyDown={(e) => e.key === 'Enter' && setF({ ...f, quantidade: e.currentTarget.value })} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <CampoData rotulo="Vencimento" valor={f.vencimento} aoMudar={(v) => setF({ ...f, vencimento: v })} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 2 }}>
            <SelecaoRef entidade="motivo_inutilizacao" rotulo="Motivo" valor={f.motivoId} aoMudar={(v) => setF({ ...f, motivoId: v })} />
          </Grid.Col>
        </Grid>
      </Paper>
      <Paper withBorder>
        <TabelaSimples
          linhas={linhas ?? []}
          vazio="Nenhuma inutilização."
          colunas={[
            { titulo: 'Data', valor: (l: any) => fmtData(l.data) },
            { titulo: 'Produto', valor: (l: any) => l.produto },
            { titulo: 'Lote', valor: (l: any) => l.lote },
            { titulo: 'Vencimento', valor: (l: any) => fmtData(l.validade) },
            { titulo: 'Quantidade', valor: (l: any) => Number(l.quantidade).toLocaleString('pt-BR') },
            { titulo: 'Valor total', valor: (l: any) => moeda(l.valor_total) },
            { titulo: 'Unidade', valor: (l: any) => l.unidade },
            { titulo: 'Motivo', valor: (l: any) => l.motivo },
          ]}
        />
      </Paper>
      {nova && (
        <Modal opened onClose={() => setNova(null)} title="Inutilização de material" size="lg">
          <Stack gap="xs">
            <Grid gutter="xs">
              <Grid.Col span={4}>
                <CampoData rotulo="Data" valor={nova.data} aoMudar={(v) => setNova({ ...nova, data: v })} />
              </Grid.Col>
              <Grid.Col span={8}>
                <SelecaoRef entidade="unidade" rotulo="Unidade" valor={nova.unidade_id} aoMudar={(v) => setNova({ ...nova, unidade_id: v, lote_id: null })} />
              </Grid.Col>
              <Grid.Col span={12}>
                <SelecaoRef entidade="produto" rotulo="Produto" valor={nova.produto_id} aoMudar={(v) => setNova({ ...nova, produto_id: v, lote_id: null })} />
              </Grid.Col>
            </Grid>
            <Text size="xs" fw={600}>
              Lotes disponíveis e validade
            </Text>
            <TabelaSimples
              linhas={lotes}
              vazio="Selecione unidade e produto."
              colunas={[
                { titulo: '', valor: (l: any) => <Checkbox size="xs" checked={nova.lote_id === l.id} onChange={() => setNova({ ...nova, lote_id: l.id })} /> },
                { titulo: 'Lote', valor: (l: any) => l.lote },
                { titulo: 'Validade', valor: (l: any) => <Text size="xs" c={l.vencido ? 'red' : undefined}>{fmtData(l.validade)}</Text> },
                { titulo: 'Saldo', valor: (l: any) => Number(l.quantidade).toLocaleString('pt-BR') },
              ]}
            />
            <Grid gutter="xs">
              <Grid.Col span={4}>
                <NumberInput size="xs" label="Quantidade" min={0} value={nova.quantidade ?? ''} onChange={(v) => setNova({ ...nova, quantidade: Number(v) || null })} />
              </Grid.Col>
              <Grid.Col span={8}>
                <SelecaoRef entidade="motivo_inutilizacao" rotulo="Motivo" valor={nova.motivo_id} aoMudar={(v) => setNova({ ...nova, motivo_id: v })} />
              </Grid.Col>
              <Grid.Col span={12}>
                <Textarea size="xs" label="Observações" value={nova.observacao ?? ''} onChange={(e) => setNova({ ...nova, observacao: e.currentTarget.value })} />
              </Grid.Col>
            </Grid>
            <Group justify="flex-end">
              <Button size="xs" color="red" disabled={!nova.lote_id || !nova.quantidade || !nova.motivo_id} onClick={() => void salvar()}>
                Registrar inutilização
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Interfaceamento: monitor, importação, request mode e lista de trabalho (TR 1.2.48)
// ---------------------------------------------------------------------------
function TelaInterfaceamento() {
  useTituloJanela('Interfaceamento');
  const { abrir } = useJanelas();
  const { dados, recarregar } = useCarregar(() => api.get(`${I}/monitor`), []);
  const [eq, setEq] = useState<any>(null);
  const [conteudo, setConteudo] = useState('');
  const [resultado, setResultado] = useState<any>(null);
  const [amostra, setAmostra] = useState('');
  const [msg, setMsg] = useState<any>(null);
  const importar = async () => {
    try {
      const r = await api.post(`${I}/equipamentos/${eq.id}/mensagens`, { conteudo });
      setResultado(r);
      notificarOk(`${r.importados} resultado(s) importado(s) de ${r.lidos} lido(s) (${r.protocolo})${r.controles ? `; ${r.controles} controle(s) de qualidade` : ''}.`);
      void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const lerArquivo = (f: File | null) => f && f.text().then(setConteudo);
  const consulta = async () => {
    try {
      setResultado(await api.get(`${I}/equipamentos/${eq.id}/consulta`, { amostra }));
      void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const token = async (id: number) => {
    if (!(await confirmar('Token do agente', 'Gerar um novo token invalida o anterior. Continuar?'))) return;
    const r = await api.post(`${I}/equipamentos/${id}/token`).catch(notificarErro);
    if (r) await confirmar('Token gerado', `${r.token} — ${r.aviso}`, 'Ok');
  };
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Interfaceamento de equipamentos</Title>
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={() => abrir('/e/int_equipamento')}>
            Equipamentos e mapeamentos
          </Button>
          <Button size="xs" variant="light" leftSection={<IconRefresh size={14} />} onClick={() => void recarregar()}>
            Atualizar
          </Button>
        </Group>
      </Group>
      <Group gap="xs">
        {(dados?.itens ?? []).map((i: any) => (
          <Badge key={i.situacao} variant="light" color={i.situacao === 'ERRO' ? 'red' : i.situacao === 'RECEBIDO' ? 'teal' : i.situacao === 'ENVIADO' ? 'blue' : 'gray'}>
            {i.situacao.replace('_', ' ').toLowerCase()}: {i.quantidade}
          </Badge>
        ))}
      </Group>
      <SimpleGrid cols={{ base: 1, md: 4 }}>
        {(dados?.equipamentos ?? []).map((e: any) => {
          const online = e.ultima_comunicacao && dayjs().diff(dayjs(e.ultima_comunicacao), 'minute') < 30;
          return (
            <Card key={e.id} withBorder style={{ borderColor: eq?.id === e.id ? 'var(--mantine-color-blue-6)' : undefined, cursor: 'pointer' }} onClick={() => (setEq(e), setResultado(null))}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={600} lineClamp={1}>
                  {e.nome}
                </Text>
                <Badge size="xs" color={!e.automatizado ? 'gray' : online ? 'teal' : 'orange'}>
                  {!e.automatizado ? 'manual' : online ? 'comunicando' : 'sem comunicação'}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {e.fabricante} {e.modelo} · {e.protocolo} · {e.comunicacao?.toLowerCase()}
                {e.request_mode ? ' · request mode' : ''}
              </Text>
              <Text size="xs">
                {e.parametros} parâmetro(s) · {e.pendentes} pedido(s) pendente(s) · {e.erros_24h} erro(s) 24h
              </Text>
              <Text size="10px" c="dimmed">
                Última comunicação: {fmtDataHora(e.ultima_comunicacao) || '-'}
              </Text>
            </Card>
          );
        })}
      </SimpleGrid>
      {eq && (
        <Paper withBorder p="sm">
          <Group justify="space-between" mb="xs">
            <Text fw={600}>{eq.nome}</Text>
            <Group gap="xs">
              <Button size="xs" variant="light" onClick={() => abrirPdf(`${I}/equipamentos/${eq.id}/lista-trabalho`)}>
                Lista de trabalho (PDF)
              </Button>
              <Button size="xs" variant="light" onClick={() => api.arquivo(`${I}/equipamentos/${eq.id}/lista-trabalho?formato=csv`, undefined, 'baixar', 'GET').catch(notificarErro)}>
                Lista de trabalho (arquivo)
              </Button>
              <Button size="xs" variant="light" onClick={() => api.get(`${I}/equipamentos/${eq.id}/pendentes`).then((r) => (setResultado({ pendentes: r }), recarregar())).catch(notificarErro)}>
                Retirar pedidos pendentes
              </Button>
              <Button size="xs" variant="subtle" leftSection={<IconKey size={14} />} onClick={() => void token(eq.id)}>
                Token do agente
              </Button>
            </Group>
          </Group>
          <Grid gutter="sm">
            <Grid.Col span={{ base: 12, md: 7 }}>
              <Textarea
                label="Mensagem / arquivo recebido do equipamento (ASTM, HL7, Kermit ou texto delimitado)"
                autosize
                minRows={8}
                styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                value={conteudo}
                onChange={(e) => setConteudo(e.currentTarget.value)}
              />
              <Group gap="xs" mt="xs">
                <Button size="xs" component="label" variant="default" leftSection={<IconUpload size={14} />}>
                  Carregar arquivo
                  <input type="file" hidden onChange={(e) => void lerArquivo(e.currentTarget.files?.[0] ?? null)} />
                </Button>
                <Button size="xs" disabled={!conteudo.trim()} onClick={() => void importar()}>
                  Processar resultados
                </Button>
              </Group>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Group gap="xs" align="flex-end">
                <TextInput size="xs" style={{ flex: 1 }} label="Consulta pelo código de barras da amostra (request mode)" value={amostra} onChange={(e) => setAmostra(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void consulta()} />
                <Button size="xs" onClick={() => void consulta()}>
                  Consultar
                </Button>
              </Group>
              {resultado && (
                <Paper withBorder p="xs" mt="xs">
                  {resultado.conteudo && <Code block>{String(resultado.conteudo).replace(/\r/g, '\n')}</Code>}
                  {resultado.detalhes?.map((d: string, i: number) => (
                    <Text key={i} size="xs" c={d.startsWith('Delta') ? 'grape' : 'orange'}>
                      • {d}
                    </Text>
                  ))}
                  {resultado.pendentes && <Text size="xs">{resultado.pendentes.length} pedido(s) entregue(s) ao agente.</Text>}
                  {resultado.lidos !== undefined && (
                    <Text size="xs">
                      Lidos {resultado.lidos} · importados {resultado.importados} · exames atualizados {resultado.itens} · controles {resultado.controles}
                    </Text>
                  )}
                </Paper>
              )}
            </Grid.Col>
          </Grid>
        </Paper>
      )}
      <Paper withBorder>
        <ScrollArea h={300}>
          <TabelaSimples
            linhas={(dados?.mensagens ?? []).filter((m: any) => !eq || m.equipamento_id === eq.id)}
            vazio="Sem mensagens."
            colunas={[
              { titulo: 'Data', valor: (m: any) => fmtDataHora(m.data_hora) },
              { titulo: 'Equipamento', valor: (m: any) => m.equipamento },
              { titulo: 'Direção', valor: (m: any) => m.direcao },
              { titulo: 'Protocolo', valor: (m: any) => m.protocolo },
              { titulo: 'Amostra(s)', valor: (m: any) => m.amostra },
              { titulo: 'Situação', valor: (m: any) => <Badge size="xs" color={m.situacao === 'ERRO' ? 'red' : m.situacao === 'PARCIAL' ? 'orange' : m.situacao === 'PENDENTE' ? 'blue' : 'teal'}>{m.situacao}</Badge> },
              { titulo: 'Resultados', valor: (m: any) => m.resultados ?? '' },
              { titulo: '', valor: (m: any) => <Button size="compact-xs" variant="subtle" onClick={() => api.get(`${I}/mensagens/${m.id}`).then(setMsg).catch(notificarErro)}>Ver</Button> },
            ]}
          />
        </ScrollArea>
      </Paper>
      {msg && (
        <Modal opened onClose={() => setMsg(null)} title={`Mensagem ${msg.id} (${msg.direcao})`} size="lg">
          <Code block>{String(msg.conteudo ?? '').replace(/\r/g, '\n')}</Code>
          {msg.detalhes && (
            <Text size="xs" mt="xs" style={{ whiteSpace: 'pre-line' }}>
              {msg.detalhes}
            </Text>
          )}
        </Modal>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Controle de qualidade: Levey-Jennings e Westgard (TR 1.2.48.3)
// ---------------------------------------------------------------------------
function TelaControleQualidade() {
  useTituloJanela('Controle de qualidade');
  const [id, setId] = useState<number | null>(null);
  const { dados, recarregar } = useCarregar(() => (id ? api.get(`${I}/cq/${id}`) : Promise.resolve(null)), [id]);
  const [valor, setValor] = useState<number | string>('');
  const [acao, setAcao] = useState('');
  const c = dados?.controle;
  const media = Number(c?.media ?? 0);
  const dp = Number(c?.desvio_padrao ?? 1);
  const serie = useMemo(() => (dados?.resultados ?? []).map((r: any) => ({ ...r, valor: Number(r.valor), dia: dayjs(r.data_hora).format('DD/MM') })), [dados]);
  const lancar = async () => {
    try {
      const r = await api.post(`${I}/cq/${id}/resultados`, { valor: Number(valor), acaoCorretiva: acao || null });
      if (r.situacao === 'REJEITADO') notificarErro(new Error(`Corrida rejeitada: regra(s) ${r.violacoes}. Registre a ação corretiva.`));
      else notificarOk(r.situacao === 'ALERTA' ? `Alerta ${r.violacoes}.` : 'Controle aceito.');
      setValor('');
      setAcao('');
      void recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Controle interno de qualidade</Title>
      <Group align="flex-end">
        <div style={{ width: 420 }}>
          <SelecaoRef entidade="int_controle" rotulo="Material de controle" valor={id} filtro={{ ativo: true }} aoMudar={setId} />
        </div>
        {c && (
          <>
            <NumberInput size="xs" w={120} label="Valor obtido" decimalScale={4} value={valor} onChange={setValor} />
            <TextInput size="xs" w={260} label="Ação corretiva (se rejeitado)" value={acao} onChange={(e) => setAcao(e.currentTarget.value)} />
            <Button size="xs" disabled={valor === ''} onClick={() => void lancar()}>
              Lançar
            </Button>
          </>
        )}
      </Group>
      {c && (
        <>
          <Group gap="xs">
            <Badge variant="light">{c.equipamento}</Badge>
            <Badge variant="light">
              {c.exame} · {c.variavel_codigo}
            </Badge>
            <Badge variant="light">lote {c.lote}</Badge>
            <Badge variant="light">
              média {c.origem_media === 'BULA' ? 'de bula' : 'do laboratório'}: {media} ± {dp}
            </Badge>
            <Badge variant="light">validade {fmtData(c.validade)}</Badge>
          </Group>
          <Paper withBorder p="sm">
            <Text size="sm" fw={600}>
              Gráfico de Levey-Jennings
            </Text>
            <div style={{ height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dia" fontSize={10} />
                  <YAxis fontSize={10} domain={[media - 4 * dp, media + 4 * dp]} />
                  <RTooltip formatter={(v: any, _n: any, p: any) => [`${v} (z ${p.payload.desvios}) ${p.payload.violacoes ?? ''}`, 'Valor']} />
                  {[-3, -2, -1, 0, 1, 2, 3].map((k) => (
                    <ReferenceLine key={k} y={media + k * dp} stroke={k === 0 ? '#2b8a3e' : Math.abs(k) === 3 ? '#e03131' : Math.abs(k) === 2 ? '#f08c00' : '#adb5bd'} strokeDasharray={k === 0 ? undefined : '4 4'} label={{ value: k === 0 ? 'média' : `${k > 0 ? '+' : ''}${k}s`, fontSize: 9, position: 'right' }} />
                  ))}
                  <Line type="linear" dataKey="valor" stroke="#1c7ed6" dot={(p: any) => <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={p.payload.situacao === 'REJEITADO' ? '#e03131' : p.payload.situacao === 'ALERTA' ? '#f08c00' : '#1c7ed6'} />} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Paper>
          <Paper withBorder>
            <ScrollArea h={240}>
              <TabelaSimples
                linhas={[...(dados?.resultados ?? [])].reverse()}
                colunas={[
                  { titulo: 'Data', valor: (r: any) => fmtDataHora(r.data_hora) },
                  { titulo: 'Valor', valor: (r: any) => r.valor },
                  { titulo: 'z', valor: (r: any) => r.desvios },
                  { titulo: 'Regras violadas', valor: (r: any) => r.violacoes ?? '-' },
                  { titulo: 'Situação', valor: (r: any) => <Badge size="xs" color={r.situacao === 'REJEITADO' ? 'red' : r.situacao === 'ALERTA' ? 'orange' : 'teal'}>{r.situacao}</Badge> },
                  { titulo: 'Origem', valor: (r: any) => r.origem },
                  { titulo: 'Ação corretiva', valor: (r: any) => r.acao_corretiva },
                ]}
              />
            </ScrollArea>
          </Paper>
        </>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Laboratórios de apoio (TR 1.2.47.18, 1.2.48.12 a 1.2.48.15)
// ---------------------------------------------------------------------------
function TelaApoio() {
  useTituloJanela('Laboratórios de apoio');
  const { abrir } = useJanelas();
  const { dados: labs } = useCarregar(() => api.get('/api/e/lab_laboratorio', { fixos: { tipo: 'APOIO' } }), []);
  const [lab, setLab] = useState<any>(null);
  const [competencia, setCompetencia] = useState(dayjs().format('YYYYMM'));
  const { dados: pendentes } = useCarregar(() => (lab ? api.get<any[]>(`${L}/digitacao`, { laboratorioId: lab.id, situacao: 'COLETADO,EM_ANALISE,DIGITADO_PARCIAL,DIGITADO' }) : Promise.resolve([])), [lab?.id]);
  const token = async () => {
    if (!(await confirmar('Token do WebService', 'Gerar um novo token invalida o anterior. Continuar?'))) return;
    const r = await api.post(`${L}/laboratorios/${lab.id}/token`).catch(notificarErro);
    if (r) await confirmar('Token gerado', `${r.token} — ${r.aviso}`, 'Ok');
  };
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Laboratórios de apoio</Title>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        {(labs?.linhas ?? []).map((l: any) => (
          <Card key={l.id} withBorder style={{ cursor: 'pointer', borderColor: lab?.id === l.id ? 'var(--mantine-color-blue-6)' : undefined }} onClick={() => setLab(l)}>
            <Text fw={600} size="sm">
              {l.nome}
            </Text>
            <Text size="xs" c="dimmed">
              {l.unidade_id__rotulo ?? 'sem unidade CNES'} · integração {String(l.integracao ?? '').toLowerCase()}
            </Text>
            <Text size="10px" c="dimmed">
              Token gerado em {fmtDataHora(l.token_gerado_em) || '-'}
            </Text>
          </Card>
        ))}
      </SimpleGrid>
      {lab && (
        <Paper withBorder p="sm">
          <Group justify="space-between" mb="xs">
            <Text fw={600}>{lab.nome}</Text>
            <Group gap="xs" align="flex-end">
              <Button size="xs" variant="light" onClick={() => abrir(`/e/lab_laboratorio/${lab.id}`)}>
                Cadastro
              </Button>
              <Button size="xs" variant="light" leftSection={<IconKey size={14} />} onClick={() => void token()}>
                Gerar token do WebService
              </Button>
              <TextInput size="xs" w={100} label="Competência" value={competencia} onChange={(e) => setCompetencia(e.currentTarget.value)} />
              <Button size="xs" onClick={() => api.arquivo(`${L}/laboratorios/${lab.id}/bpa?competencia=${competencia}`, undefined, 'baixar', 'GET').catch(notificarErro)}>
                Arquivo BPA (consolidado e individualizado)
              </Button>
              <Button size="xs" variant="light" onClick={() => abrir('/t/relatorios/LAB?r=lab-repassados')}>
                Relatório (PDF/CSV)
              </Button>
            </Group>
          </Group>
          <Alert py={6} color="blue" mb="xs">
            <Text size="xs">
              WebService: <Code>GET /api/publico/laboratorio/apoio/pedidos</Code> e <Code>POST /api/publico/laboratorio/apoio/resultados</Code> com o cabeçalho <Code>x-token-laboratorio</Code>. O prestador também pode digitar e assinar pelo
              portal (operador vinculado à unidade do laboratório de apoio).
            </Text>
          </Alert>
          <TabelaSimples
            linhas={pendentes ?? []}
            vazio="Nenhum pedido repassado aguardando resultado."
            colunas={[
              { titulo: 'Requisição', valor: (x: any) => x.numero },
              { titulo: 'Paciente', valor: (x: any) => x.paciente },
              { titulo: 'Exame', valor: (x: any) => x.sigla },
              { titulo: 'Coleta', valor: (x: any) => fmtDataHora(x.coletada_em) },
              { titulo: 'Situação', valor: (x: any) => <SituacaoItem valor={x.situacao} /> },
              { titulo: '', valor: (x: any) => <Button size="compact-xs" variant="subtle" onClick={() => abrir(`/t/laboratorio/digitacao?requisicao=${x.requisicao_id}`)}>Digitar</Button> },
            ]}
          />
        </Paper>
      )}
    </Stack>
  );
}

// Ações nos cadastros genéricos.
registrarExtensaoFormulario('lab_exame', {
  acoes: (r) => (r?.id ? <LinkLayout id={r.id} /> : null),
});
function LinkLayout({ id }: { id: number }) {
  const { abrir } = useJanelas();
  return (
    <Group gap="xs">
      <Button variant="light" onClick={() => abrir(`/t/laboratorio/layout?exame=${id}`)}>
        Visualização prévia do layout
      </Button>
      <Button variant="light" leftSection={<IconFileTypePdf size={16} />} onClick={() => void pdfPost(`${L}/exames/${id}/previa-laudo`, {})}>
        Prévia do laudo
      </Button>
      <Button variant="subtle" onClick={() => api.get(`${L}/exames/${id}/prazo`).then((r) => notificarOk(`Se requisitado agora, a entrega prevista é ${fmtData(r.previsao)}.`)).catch(notificarErro)}>
        Simular prazo de entrega
      </Button>
    </Group>
  );
}

const M = 'Laboratório';
registrarTela({ id: 'lab-layout', titulo: 'Layout e prévia do exame', menu: `${M}/Configurações`, padrao: '/t/laboratorio/layout', permissao: 'lab_exame:consultar', modulo: 'LAB', palavras: ['variável', 'referência', 'fórmula'], ordem: 1, render: ({ query }) => <TelaLayoutExame query={query} /> });
registrarTela({ id: 'lab-modelos', titulo: 'Editor de modelos (laudo e mapa)', menu: `${M}/Configurações`, padrao: '/t/laboratorio/modelos', permissao: 'lab_modelo_laudo:alterar', modulo: 'LAB', palavras: ['laudo', 'html', 'mapa de trabalho'], ordem: 2, render: () => <TelaModelos /> });
registrarTela({ id: 'lab-etiquetas', titulo: 'Editor de etiquetas', menu: `${M}/Configurações`, padrao: '/t/laboratorio/etiquetas', permissao: 'lab_modelo_etiqueta:alterar', modulo: 'LAB', palavras: ['etiqueta', 'impressora térmica', 'código de barras'], ordem: 3, render: () => <TelaEtiquetas /> });
registrarTela({ id: 'lab-materiais', titulo: 'Materiais e estoque', menu: `${M}/Materiais`, padrao: '/t/laboratorio/materiais', permissao: 'produto:consultar', modulo: 'LAB', palavras: ['reagente', 'tubo', 'estoque', 'catmat'], ordem: 1, render: () => <TelaMateriais /> });
registrarTela({ id: 'lab-entradas', titulo: 'Entradas', menu: `${M}/Materiais`, padrao: '/t/laboratorio/entradas', permissao: 'entrada:consultar', modulo: 'LAB', palavras: ['nota fiscal', 'fornecedor'], ordem: 2, render: () => <TelaEntradas /> });
registrarTela({ id: 'lab-inutilizacoes', titulo: 'Acertos e inutilizações', menu: `${M}/Materiais`, padrao: '/t/laboratorio/inutilizacoes', permissao: 'inutilizacao:consultar', modulo: 'LAB', palavras: ['perda', 'vencido'], ordem: 3, render: () => <TelaInutilizacoes /> });
registrarTela({ id: 'lab-interfaceamento', titulo: 'Monitor do interfaceamento', menu: `${M}/Interfaceamento`, padrao: '/t/laboratorio/interfaceamento', permissao: 'int_equipamento:consultar', modulo: 'INT', palavras: ['astm', 'hl7', 'equipamento', 'analisador'], ordem: 1, render: () => <TelaInterfaceamento /> });
registrarTela({ id: 'lab-cq', titulo: 'Controle de qualidade', menu: `${M}/Controle de qualidade`, padrao: '/t/laboratorio/controle-qualidade', permissao: 'int_controle:consultar', modulo: 'INT', palavras: ['westgard', 'levey-jennings'], ordem: 1, render: () => <TelaControleQualidade /> });
registrarTela({ id: 'lab-apoio', titulo: 'Laboratórios de apoio', menu: M, padrao: '/t/laboratorio/apoio', permissao: 'lab_laboratorio:consultar', modulo: 'LAB', palavras: ['terceirizado', 'webservice', 'repassados'], ordem: 6, render: () => <TelaApoio /> });
registrarMenuRelatorios('INT', `${M}/Interfaceamento`, 'int_equipamento:exportar');
