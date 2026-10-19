// Formulário genérico gerado a partir dos metadados da entidade.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Code,
  Grid,
  Group,
  LoadingOverlay,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCopy, IconDeviceFloppy, IconHistory, IconTrash } from '@tabler/icons-react';
import { api, ErroApi } from '@/api';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import type { Campo, Meta } from '@/tipos';
import { EntradaCampo, validarCampo } from './campos';
import { Consulta } from './Consulta';
import { confirmar } from './dialogos';
import { useMeta } from './useMeta';
import { formatarCelula } from './grade';

interface Props {
  entidade: string;
  id?: number | null;
  /** Valores iniciais (ex.: chave do registro pai). */
  iniciais?: Record<string, any>;
  /** Campos não exibidos (ex.: chave do pai em formulários filhos). */
  ocultar?: string[];
  emModal?: boolean;
  aoSalvar?: (registro: any) => void;
  aoCancelar?: () => void;
  /** Ganchos de tela: campos extras, ações e reações a mudanças. */
  extensao?: ExtensaoFormulario;
}

export interface ExtensaoFormulario {
  aoMudarCampo?: (campo: string, valor: any, dados: Record<string, any>, definir: (parcial: Record<string, any>) => void) => void | Promise<void>;
  acoes?: (registro: Record<string, any> | null, recarregar: () => void) => React.ReactNode;
  cabecalho?: (registro: Record<string, any> | null) => React.ReactNode;
  abasExtras?: (registro: Record<string, any> | null) => { titulo: string; conteudo: React.ReactNode }[];
}

const extensoes = new Map<string, ExtensaoFormulario>();
/** Telas especializadas registram comportamentos adicionais para o formulário de uma entidade. */
export function registrarExtensaoFormulario(entidade: string, e: ExtensaoFormulario) {
  extensoes.set(entidade, e);
}

export function Formulario(props: Props) {
  const { meta, erro } = useMeta(props.entidade);
  if (erro) return <Alert color="red">{erro}</Alert>;
  if (!meta) return <Text c="dimmed">Carregando...</Text>;
  return <FormularioMeta {...props} meta={meta} extensao={props.extensao ?? extensoes.get(meta.nome)} />;
}

function valoresPadrao(meta: Meta) {
  const v: Record<string, any> = {};
  for (const c of meta.campos) if (c.padrao !== undefined) v[c.nome] = c.padrao;
  return v;
}

function FormularioMeta({ meta, id, iniciais, ocultar, emModal, aoSalvar, aoCancelar, extensao }: Props & { meta: Meta }) {
  const { abrir, fechar, ativa } = useJanelas();
  const [registroId, setRegistroId] = useState<number | null>(id ?? null);
  const [registro, setRegistro] = useState<Record<string, any> | null>(null);
  const [dados, setDados] = useState<Record<string, any>>(() => ({ ...valoresPadrao(meta), ...iniciais }));
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(!!id);
  const [historico, setHistorico] = useState<any[] | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, any> | null>(null);
  const [alterado, setAlterado] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const chaveRascunho = `rascunho:${meta.nome}:${registroId ?? 'novo'}`;

  useTituloJanela(emModal ? undefined : registroId ? `${meta.tituloSingular}: ${registro?.__rotulo ?? registroId}` : `Novo(a) ${meta.tituloSingular.toLowerCase()}`);

  const carregar = useCallback(async () => {
    if (!registroId) return;
    setCarregando(true);
    try {
      const r = await api.get(`/api/e/${meta.nome}/${registroId}`);
      setRegistro(r);
      setDados(r);
      setAlterado(false);
    } finally {
      setCarregando(false);
    }
  }, [meta.nome, registroId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Recuperação do preenchimento em caso de queda de energia/navegador (TR 1.1.1.18).
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(chaveRascunho);
      if (salvo) setRascunho(JSON.parse(salvo));
    } catch {
      /* armazenamento indisponível */
    }
  }, [chaveRascunho]);

  useEffect(() => {
    if (!alterado) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(chaveRascunho, JSON.stringify(dados));
      } catch {
        /* armazenamento indisponível */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [dados, alterado, chaveRascunho]);

  const definir = useCallback(
    (parcial: Record<string, any>) => {
      setDados((d) => ({ ...d, ...parcial }));
      setAlterado(true);
    },
    [],
  );

  const mudar = (c: Campo, v: any, rotulo?: string) => {
    const novo = { ...dados, [c.nome]: v, ...(c.tipo === 'ref' ? { [`${c.nome}__rotulo`]: rotulo ?? null } : {}) };
    setDados(novo);
    setAlterado(true);
    if (erros[c.nome]) setErros((e) => ({ ...e, [c.nome]: '' }));
    void extensao?.aoMudarCampo?.(c.nome, v, novo, definir);
    if (c.tipo === 'cep' && v && String(v).length === 8) void preencherCep(String(v), definir);
  };

  const visiveis = useMemo(() => meta.campos.filter((c) => !c.oculto && c.tipo !== 'json' && c.tipo !== 'segredo' && !ocultar?.includes(c.nome)), [meta, ocultar]);
  const abas = useMemo(() => {
    const nomes = meta.abas?.length ? [...meta.abas] : [];
    for (const c of visiveis) if (c.aba && !nomes.includes(c.aba)) nomes.push(c.aba);
    if (visiveis.some((c) => !c.aba)) nomes.unshift('Geral');
    return nomes.length ? nomes : ['Geral'];
  }, [meta, visiveis]);
  const [abaAtiva, setAbaAtiva] = useState<string | null>(abas[0]);

  async function salvar(continuar = false) {
    const novosErros: Record<string, string> = {};
    for (const c of visiveis) {
      const e = validarCampo(c, dados[c.nome]);
      if (e) novosErros[c.nome] = e;
    }
    setErros(novosErros);
    if (Object.keys(novosErros).length) {
      const primeiro = visiveis.find((c) => novosErros[c.nome]);
      if (primeiro?.aba) setAbaAtiva(primeiro.aba);
      notifications.show({ color: 'red', title: 'Verifique os campos destacados', message: Object.values(novosErros).slice(0, 3).join(' ') });
      return;
    }
    const corpo: Record<string, any> = {};
    for (const c of meta.campos) {
      if (c.somenteLeitura || c.calculado || c.tipo === 'segredo') continue;
      if (c.nome in dados && (!registro || JSON.stringify(dados[c.nome]) !== JSON.stringify(registro[c.nome]))) corpo[c.nome] = dados[c.nome];
    }
    setSalvando(true);
    try {
      const r = registroId ? await api.put(`/api/e/${meta.nome}/${registroId}`, corpo) : await api.post(`/api/e/${meta.nome}`, corpo);
      localStorage.removeItem(chaveRascunho);
      setAlterado(false);
      // O operador é sempre informado do resultado da transação (TR 1.1.1.19.1).
      notifications.show({ color: 'teal', title: 'Gravado com sucesso', message: `${meta.tituloSingular} ${r.__rotulo ?? ''} salvo(a).` });
      aoSalvar?.(r);
      if (continuar) {
        setRegistroId(null);
        setRegistro(null);
        setDados({ ...valoresPadrao(meta), ...iniciais });
      } else if (!registroId && !emModal) {
        fechar(ativa);
        abrir(`/e/${meta.nome}/${r.id}`, `${meta.tituloSingular}: ${r.__rotulo ?? r.id}`);
      } else {
        setRegistroId(r.id);
        setRegistro(r);
        setDados(r);
      }
    } catch (e) {
      const err = e as ErroApi;
      const det = err.detalhes?.campos ?? err.detalhes;
      if (det && typeof det === 'object') setErros(Object.fromEntries(Object.entries(det).filter(([, v]) => typeof v === 'string')) as any);
      notifications.show({ color: 'red', title: 'Não foi possível gravar', message: err.message, autoClose: 8000 });
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!registroId) return;
    if (!(await confirmar('Excluir registro', `Confirma a exclusão de ${meta.tituloSingular.toLowerCase()} "${registro?.__rotulo ?? registroId}"? Esta operação não pode ser desfeita.`, 'Excluir', true))) return;
    try {
      await api.delete(`/api/e/${meta.nome}/${registroId}`);
      notifications.show({ color: 'teal', message: 'Registro excluído.' });
      if (emModal) aoCancelar?.();
      else fechar(ativa);
    } catch (e) {
      notifications.show({ color: 'red', title: 'Exclusão não permitida', message: (e as Error).message });
    }
  }

  async function clonar() {
    const r = await api.post(`/api/e/${meta.nome}/${registroId}/clonar`);
    setRegistroId(null);
    setRegistro(null);
    setDados({ ...r.rascunho });
    setAlterado(true);
    notifications.show({ message: 'Cópia preparada: ajuste os dados e grave o novo registro.' });
  }

  // Navegação entre campos com Enter ou Tab (TR 1.1.2.1.46).
  function teclaEnter(e: React.KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    const alvo = e.target as HTMLElement;
    if (alvo.getAttribute('aria-expanded') === 'true' || alvo.tagName === 'BUTTON') return;
    e.preventDefault();
    const focaveis = Array.from(formRef.current?.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])') ?? []).filter(
      (el) => el.offsetParent !== null,
    );
    const i = focaveis.indexOf(alvo);
    focaveis[i + 1]?.focus();
  }

  const podeEditar = registroId ? meta.acoes.alterar : meta.acoes.incluir;

  const campoEl = (c: Campo) => (
    <Grid.Col key={c.nome} span={{ base: 12, sm: Math.max(c.largura ?? (c.tipo === 'texto_longo' || c.tipo === 'multi_opcao' ? 12 : 4), 3), md: c.largura ?? (c.tipo === 'texto_longo' || c.tipo === 'multi_opcao' ? 12 : 4) }}>
      <EntradaCampo
        campo={c}
        valor={dados[c.nome]}
        rotuloRef={dados[`${c.nome}__rotulo`]}
        aoMudar={(v: any, rot?: string) => mudar(c, v, rot)}
        erro={erros[c.nome]}
        desabilitado={!podeEditar}
        registro={dados}
      />
    </Grid.Col>
  );

  const conteudoAba = (aba: string) => <Grid gutter="sm">{visiveis.filter((c) => (c.aba ?? 'Geral') === aba).map(campoEl)}</Grid>;
  const filhos = registroId ? (meta.filhos ?? []) : [];
  const extras = extensao?.abasExtras?.(registro) ?? [];

  return (
    <Box pos="relative">
      <LoadingOverlay visible={salvando || carregando} zIndex={50} overlayProps={{ blur: 1 }} />
      <form ref={formRef} onKeyDown={teclaEnter} onSubmit={(e) => (e.preventDefault(), void salvar())}>
        <Stack gap="sm">
          {!emModal && (
            <Group justify="space-between">
              <Group gap="xs">
                <Title order={4}>{registroId ? meta.tituloSingular : `Novo(a) ${meta.tituloSingular.toLowerCase()}`}</Title>
                {registroId && <Badge variant="light">Código {registroId}</Badge>}
                {alterado && <Badge color="yellow">Não salvo</Badge>}
              </Group>
            </Group>
          )}
          {rascunho && (
            <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title="Preenchimento não salvo encontrado">
              <Group justify="space-between">
                <Text size="sm">Há dados digitados anteriormente e não gravados neste formulário.</Text>
                <Group gap="xs">
                  <Button size="xs" onClick={() => (setDados((d) => ({ ...d, ...rascunho })), setRascunho(null), setAlterado(true))}>
                    Recuperar
                  </Button>
                  <Button size="xs" variant="default" onClick={() => (localStorage.removeItem(chaveRascunho), setRascunho(null))}>
                    Descartar
                  </Button>
                </Group>
              </Group>
            </Alert>
          )}
          {extensao?.cabecalho?.(registro)}
          {abas.length > 1 || filhos.length || extras.length ? (
            <Tabs value={abaAtiva} onChange={setAbaAtiva} keepMounted>
              <Tabs.List>
                {abas.map((a) => (
                  <Tabs.Tab key={a} value={a} c={visiveis.some((c) => (c.aba ?? 'Geral') === a && erros[c.nome]) ? 'red' : undefined}>
                    {a}
                  </Tabs.Tab>
                ))}
                {filhos.map((f) => (
                  <Tabs.Tab key={f.entidade} value={`filho:${f.entidade}`}>
                    {f.titulo ?? f.entidade}
                  </Tabs.Tab>
                ))}
                {extras.map((x) => (
                  <Tabs.Tab key={x.titulo} value={`extra:${x.titulo}`}>
                    {x.titulo}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
              {abas.map((a) => (
                <Tabs.Panel key={a} value={a} pt="sm">
                  {conteudoAba(a)}
                </Tabs.Panel>
              ))}
              {filhos.map((f) => (
                <Tabs.Panel key={f.entidade} value={`filho:${f.entidade}`} pt="sm">
                  <Filhos entidade={f.entidade} campo={f.campo} paiId={registroId!} />
                </Tabs.Panel>
              ))}
              {extras.map((x) => (
                <Tabs.Panel key={x.titulo} value={`extra:${x.titulo}`} pt="sm">
                  {x.conteudo}
                </Tabs.Panel>
              ))}
            </Tabs>
          ) : (
            conteudoAba(abas[0])
          )}
          <Group justify="space-between" mt="xs">
            <Text size="xs" c="dimmed">
              {registro &&
                `Incluído em ${new Date(registro.criado_em).toLocaleString('pt-BR')}${registro.criado_por__rotulo ? ' por ' + registro.criado_por__rotulo : ''}${
                  registro.atualizado_em ? ` · Última alteração em ${new Date(registro.atualizado_em).toLocaleString('pt-BR')}${registro.atualizado_por__rotulo ? ' por ' + registro.atualizado_por__rotulo : ''}` : ''
                }`}
            </Text>
            <Group gap="xs">
              {extensao?.acoes?.(registro, () => void carregar())}
              {registroId && (
                <Tooltip label="Histórico de alterações (auditoria)">
                  <Button variant="default" size="sm" leftSection={<IconHistory size={16} />} onClick={() => api.get(`/api/e/${meta.nome}/${registroId}/historico`).then(setHistorico).catch((e) => notifications.show({ color: 'red', message: e.message }))}>
                    Histórico
                  </Button>
                </Tooltip>
              )}
              {registroId && meta.clonavel && meta.acoes.incluir && (
                <Button variant="default" size="sm" leftSection={<IconCopy size={16} />} onClick={() => void clonar()}>
                  Duplicar
                </Button>
              )}
              {registroId && meta.acoes.excluir && !meta.somenteLeitura && (
                <Button variant="light" color="red" size="sm" leftSection={<IconTrash size={16} />} onClick={() => void excluir()}>
                  Excluir
                </Button>
              )}
              {emModal && (
                <Button variant="default" size="sm" onClick={aoCancelar}>
                  Cancelar
                </Button>
              )}
              {podeEditar && !registroId && !emModal && (
                <Button variant="default" size="sm" onClick={() => void salvar(true)}>
                  Salvar e incluir outro
                </Button>
              )}
              {podeEditar && (
                <Button type="submit" size="sm" leftSection={<IconDeviceFloppy size={16} />}>
                  Salvar
                </Button>
              )}
            </Group>
          </Group>
        </Stack>
      </form>
      <Modal opened={!!historico} onClose={() => setHistorico(null)} title="Histórico de alterações" size="xl">
        <HistoricoAuditoria linhas={historico ?? []} campos={meta.campos} />
      </Modal>
    </Box>
  );
}

async function preencherCep(cep: string, definir: (p: Record<string, any>) => void) {
  try {
    const r = await api.get(`/api/cep/${cep}`);
    const p: Record<string, any> = {};
    if (r.municipio) Object.assign(p, { municipio_id: r.municipio.id, municipio_id__rotulo: `${r.municipio.nome} - ${r.municipio.uf_sigla}` });
    if (r.logradouro) {
      Object.assign(p, { logradouro_id: r.logradouro.id, logradouro_id__rotulo: `${r.logradouro.tipo_abreviatura ?? ''} - ${r.logradouro.nome}` });
      if (r.logradouro.bairro_id) Object.assign(p, { bairro_id: r.logradouro.bairro_id, bairro_id__rotulo: r.logradouro.bairro });
    }
    definir(p);
    if (!r.logradouro && r.dne) notifications.show({ message: `CEP localizado: ${r.dne.tipo_logradouro ?? ''} ${r.dne.logradouro ?? ''} - ${r.dne.bairro ?? ''}. Cadastre o logradouro se necessário.` });
  } catch {
    /* CEP não encontrado: preenchimento manual */
  }
}

/** Visualização dos registros de auditoria: dados novos, alterados e excluídos (TR 1.1.1.38). */
export function HistoricoAuditoria({ linhas, campos }: { linhas: any[]; campos: Campo[] }) {
  const rotulo = (n: string) => campos.find((c) => c.nome === n)?.rotulo ?? n;
  const fmt = (n: string, v: any) => {
    const c = campos.find((x) => x.nome === n);
    if (v === null || v === undefined) return '—';
    return c ? formatarCelula(c, v) || String(v) : typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  const ignorar = new Set(['atualizado_em', 'atualizado_por', 'criado_em', 'criado_por', 'nome_busca', 'nome_mae_busca']);
  return (
    <ScrollArea.Autosize mah="70vh">
      <Stack>
        {linhas.length === 0 && <Text c="dimmed">Sem registros de auditoria.</Text>}
        {linhas.map((l) => {
          const chaves = [...new Set([...Object.keys(l.antes ?? {}), ...Object.keys(l.depois ?? {})])].filter(
            (k) => !ignorar.has(k) && JSON.stringify(l.antes?.[k]) !== JSON.stringify(l.depois?.[k]),
          );
          return (
            <Paper key={l.id} withBorder p="xs">
              <Group gap="xs" mb={4}>
                <Badge color={l.operacao === 'I' ? 'teal' : l.operacao === 'E' ? 'red' : 'blue'}>{l.operacao === 'I' ? 'Inclusão' : l.operacao === 'E' ? 'Exclusão' : 'Alteração'}</Badge>
                <Text size="sm">{new Date(l.data_hora).toLocaleString('pt-BR')}</Text>
                <Text size="sm" fw={500}>
                  {l.operador ?? `usuário do banco: ${l.usuario_banco}`}
                </Text>
                <Code>{l.ip ?? '-'}</Code>
                {l.rotina && <Text size="xs" c="dimmed">rotina: {l.rotina}</Text>}
              </Group>
              <Table fz="xs" withTableBorder striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Campo</Table.Th>
                    <Table.Th>Antes</Table.Th>
                    <Table.Th>Depois</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {chaves.map((k) => (
                    <Table.Tr key={k}>
                      <Table.Td>{rotulo(k)}</Table.Td>
                      <Table.Td c="red.8">{fmt(k, l.antes?.[k])}</Table.Td>
                      <Table.Td c="teal.8">{fmt(k, l.depois?.[k])}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          );
        })}
      </Stack>
    </ScrollArea.Autosize>
  );
}

/** Cadastros filhos (ex.: vínculos do profissional) com inclusão e edição em modal. */
function Filhos({ entidade, campo, paiId }: { entidade: string; campo: string; paiId: number }) {
  const [editando, setEditando] = useState<number | null | undefined>(undefined);
  const [versao, setVersao] = useState(0);
  return (
    <>
      <Consulta
        entidade={entidade}
        fixos={{ [campo]: paiId }}
        compacto
        chaveAtualizacao={versao}
        aoAbrir={(l) => setEditando(l.id ?? null)}
      />
      <Modal opened={editando !== undefined} onClose={() => setEditando(undefined)} size="xl" title={editando ? 'Alterar registro' : 'Incluir registro'}>
        {editando !== undefined && (
          <Formulario
            entidade={entidade}
            id={editando}
            iniciais={{ [campo]: paiId }}
            ocultar={[campo]}
            emModal
            aoSalvar={() => {
              setEditando(undefined);
              setVersao((v) => v + 1);
            }}
            aoCancelar={() => {
              setEditando(undefined);
              setVersao((v) => v + 1);
            }}
          />
        )}
      </Modal>
    </>
  );
}
