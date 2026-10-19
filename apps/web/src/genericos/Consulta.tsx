// Tela genérica de consulta: colunas redimensionáveis, reordenáveis e ocultáveis,
// filtros por operador, ordenação, consultas salvas, impressão e exportação
// (TR 1.1.1.59 a 1.1.1.63, 1.1.2.1.42 a 1.1.2.1.45, 1.1.2.1.64).
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridApi, IDatasource } from 'ag-grid-community';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconColumns,
  IconDeviceFloppy,
  IconDownload,
  IconFilterOff,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconSearch,
  IconStar,
} from '@tabler/icons-react';
import { api, ErroApi } from '@/api';
import { useJanelas } from '@/shell/Janelas';
import { OPCOES_FORMATO, type Meta } from '@/tipos';
import { descreverFiltros, filtrosDaGrade, formatarCelula, OPCOES_NUMERO, OPCOES_TEXTO, TEXTOS_GRADE } from './grade';
import { useMeta } from './useMeta';
import { pedirJustificativaSeNecessario } from './restricoes';

interface Props {
  entidade: string;
  /** Filtros fixos (ex.: registros filhos de um cadastro). */
  fixos?: Record<string, unknown>;
  compacto?: boolean;
  altura?: number | string;
  aoSelecionar?: (linha: any) => void;
  aoAbrir?: (linha: any) => void;
  titulo?: string;
  semNovo?: boolean;
  chaveAtualizacao?: number;
}

interface EstadoSalvo {
  colunas: any[];
  filtros: Record<string, any>;
  q: string;
}

export function Consulta(props: Props) {
  const { meta, erro } = useMeta(props.entidade);
  if (erro) return <Text c="red">{erro}</Text>;
  if (!meta) return <Text c="dimmed">Carregando...</Text>;
  return <ConsultaGrade {...props} meta={meta} />;
}

function ConsultaGrade({ meta, fixos, compacto, altura, aoSelecionar, aoAbrir, titulo, semNovo, chaveAtualizacao }: Props & { meta: Meta }) {
  const { abrir } = useJanelas();
  const grade = useRef<GridApi | null>(null);
  const [q, setQ] = useState('');
  const [qDeb] = useDebouncedValue(q, 350);
  const [total, setTotal] = useState<number | null>(null);
  const [modalImpressao, setModalImpressao] = useState(false);
  const [salvas, setSalvas] = useState<{ nome: string; valor: EstadoSalvo; compartilhada: boolean; minha: boolean }[]>([]);
  const [colunasVisiveis, setColunasVisiveis] = useState<Record<string, boolean>>({});
  const chavePref = `consulta:${meta.nome}`;

  const colunas = useMemo<ColDef[]>(() => {
    const defs: ColDef[] = [
      { colId: 'id', field: 'id', headerName: 'Código', width: 95, filter: 'agNumberColumnFilter', filterParams: { filterOptions: OPCOES_NUMERO, maxNumConditions: 1 } },
    ];
    for (const c of meta.campos) {
      if (c.oculto || c.tipo === 'json' || c.tipo === 'arquivo' || (fixos && c.nome in fixos)) continue;
      const numerico = ['inteiro', 'decimal', 'moeda'].includes(c.tipo);
      const data = c.tipo === 'data' || c.tipo === 'data_hora';
      defs.push({
        colId: c.nome,
        field: c.tipo === 'ref' ? `${c.nome}__rotulo` : c.nome,
        headerName: c.rotulo,
        headerTooltip: c.ajuda ?? c.rotulo,
        hide: !c.lista,
        sortable: !(c.calculado && c.tipo === 'texto'),
        filter: c.calculado ? false : numerico ? 'agNumberColumnFilter' : data ? 'agDateColumnFilter' : 'agTextColumnFilter',
        filterParams: {
          filterOptions: numerico || data ? OPCOES_NUMERO : OPCOES_TEXTO,
          maxNumConditions: 1,
          browserDatePicker: true,
        },
        valueFormatter: (p) => (c.tipo === 'ref' ? (p.value ?? '') : formatarCelula(c, p.value)),
        cellClass: numerico ? 'ag-right-aligned-cell' : undefined,
        minWidth: c.tipo === 'texto' && (c.max ?? 0) > 40 ? 200 : 120,
        flex: c.lista ? 1 : undefined,
      });
    }
    defs.push(
      { colId: 'criado_em', field: 'criado_em', headerName: 'Incluído em', hide: true, filter: 'agDateColumnFilter', valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString('pt-BR') : '') },
      { colId: 'atualizado_em', field: 'atualizado_em', headerName: 'Alterado em', hide: true, filter: 'agDateColumnFilter', valueFormatter: (p) => (p.value ? new Date(p.value).toLocaleString('pt-BR') : '') },
    );
    return defs;
  }, [meta, fixos]);

  const fonte = useMemo<IDatasource>(
    () => ({
      getRows: async (p) => {
        const tamanho = p.endRow - p.startRow;
        const ordem = p.sortModel.map((s) => `${s.colId} ${s.sort}`).join(',') || undefined;
        try {
          const r = await api.get(`/api/e/${meta.nome}`, {
            filtros: filtrosDaGrade(p.filterModel, meta.campos),
            fixos,
            q: qDeb || undefined,
            ordem,
            pagina: Math.floor(p.startRow / tamanho) + 1,
            tamanho,
          });
          setTotal(r.total);
          p.successCallback(r.linhas, r.total);
        } catch (e) {
          notifications.show({ color: 'red', title: 'Falha na consulta', message: (e as Error).message });
          p.failCallback();
        }
      },
    }),
    [meta, fixos, qDeb],
  );

  useEffect(() => {
    grade.current?.setGridOption('datasource', fonte);
  }, [fonte, chaveAtualizacao]);

  const carregarSalvas = useCallback(async () => {
    const r = await api.get(`/api/preferencias/${encodeURIComponent(chavePref)}`).catch(() => []);
    setSalvas(r);
    return r as typeof salvas;
  }, [chavePref]);

  const aplicarEstado = useCallback((v: EstadoSalvo) => {
    const g = grade.current;
    if (!g) return;
    if (v.colunas?.length) g.applyColumnState({ state: v.colunas, applyOrder: true });
    g.setFilterModel(v.filtros ?? {});
    setQ(v.q ?? '');
    atualizarVisiveis();
  }, []);

  function atualizarVisiveis() {
    const g = grade.current;
    if (!g) return;
    setColunasVisiveis(Object.fromEntries(g.getColumnState().map((s) => [s.colId, !s.hide])));
  }

  async function salvarConsulta() {
    const nome = window.prompt('Nome da consulta (use "padrao" para abrir automaticamente):', 'padrao');
    if (!nome || !grade.current) return;
    const compartilhada = window.confirm('Compartilhar esta consulta com operadores que tenham o mesmo acesso?');
    const valor: EstadoSalvo = { colunas: grade.current.getColumnState(), filtros: grade.current.getFilterModel(), q };
    await api.put(`/api/preferencias/${encodeURIComponent(chavePref)}`, { nome, valor, compartilhada });
    notifications.show({ color: 'teal', message: `Consulta "${nome}" salva.` });
    void carregarSalvas();
  }

  function colunasExportacao() {
    const g = grade.current!;
    return g
      .getColumnState()
      .filter((s) => !s.hide)
      .map((s) => ({ campo: s.colId, titulo: g.getColumn(s.colId)?.getColDef().headerName ?? s.colId }));
  }

  async function exportar(formato: string, extra: { titulo?: string; zebrado?: boolean } = {}) {
    const g = grade.current;
    if (!g) return;
    const filtros = filtrosDaGrade(g.getFilterModel(), meta.campos);
    const corpo = {
      formato,
      colunas: colunasExportacao(),
      filtros: [...filtros, ...Object.entries(fixos ?? {}).map(([campo, valor]) => ({ campo, op: 'igual', valor }))],
      q: q || undefined,
      ordem: g.getColumnState().filter((s) => s.sort).map((s) => `${s.colId} ${s.sort}`).join(',') || undefined,
      filtrosTexto: descreverFiltros(filtros, meta.campos, q),
      ...extra,
    };
    try {
      const r = await pedirJustificativaSeNecessario((justificativa) =>
        api.arquivo(`/api/e/${meta.nome}/exportar`, { ...corpo, justificativa }, formato === 'pdf' ? 'abrir' : 'baixar'),
      );
      if (r?.codigo) notifications.show({ message: `Documento emitido com o código ${r.codigo}.` });
    } catch (e) {
      notifications.show({ color: 'red', title: 'Falha na exportação', message: (e as ErroApi).message });
    }
  }

  const abrirRegistro = (linha: any) => {
    if (aoAbrir) return aoAbrir(linha);
    abrir(`/e/${meta.nome}/${linha.id}`, `${meta.tituloSingular} ${linha.__rotulo ?? linha.id}`);
  };

  return (
    <Stack gap="xs" h={compacto ? undefined : '100%'}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          {!compacto && <Title order={4}>{titulo ?? meta.titulo}</Title>}
          {compacto && titulo && <Text fw={600}>{titulo}</Text>}
          {total !== null && (
            <Badge variant="light" title="Quantidade de registros encontrados">
              {total.toLocaleString('pt-BR')} registro(s)
            </Badge>
          )}
        </Group>
        <Group gap={6} wrap="nowrap">
          <TextInput
            size="xs"
            placeholder="Pesquisar..."
            leftSection={<IconSearch size={14} />}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            w={compacto ? 160 : 240}
          />
          <Tooltip label="Atualizar">
            <ActionIcon variant="default" onClick={() => grade.current?.refreshInfiniteCache()}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Limpar filtros">
            <ActionIcon
              variant="default"
              onClick={() => {
                grade.current?.setFilterModel(null);
                setQ('');
              }}
            >
              <IconFilterOff size={16} />
            </ActionIcon>
          </Tooltip>
          <Menu closeOnItemClick={false} position="bottom-end" onOpen={atualizarVisiveis}>
            <Menu.Target>
              <Tooltip label="Exibir/ocultar colunas">
                <ActionIcon variant="default">
                  <IconColumns size={16} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <ScrollArea.Autosize mah={360}>
                {colunas.map((c) => (
                  <Menu.Item key={c.colId}>
                    <Checkbox
                      size="xs"
                      label={c.headerName}
                      checked={colunasVisiveis[c.colId!] ?? !c.hide}
                      onChange={(e) => {
                        grade.current?.setColumnsVisible([c.colId!], e.currentTarget.checked);
                        atualizarVisiveis();
                      }}
                    />
                  </Menu.Item>
                ))}
              </ScrollArea.Autosize>
            </Menu.Dropdown>
          </Menu>
          {!compacto && (
            <Menu position="bottom-end">
              <Menu.Target>
                <Tooltip label="Consultas salvas">
                  <ActionIcon variant="default">
                    <IconStar size={16} />
                  </ActionIcon>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconDeviceFloppy size={14} />} onClick={() => void salvarConsulta()}>
                  Salvar consulta atual...
                </Menu.Item>
                {salvas.length > 0 && <Menu.Divider />}
                {salvas.map((s) => (
                  <Menu.Item key={s.nome + s.minha} onClick={() => aplicarEstado(s.valor)}>
                    {s.nome}
                    {s.compartilhada && !s.minha ? ' (compartilhada)' : ''}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
          {meta.acoes.exportar && (
            <>
              <Tooltip label="Imprimir visualização atual">
                <ActionIcon variant="default" onClick={() => setModalImpressao(true)}>
                  <IconPrinter size={16} />
                </ActionIcon>
              </Tooltip>
              <Menu position="bottom-end">
                <Menu.Target>
                  <Tooltip label="Exportar resultado">
                    <ActionIcon variant="default">
                      <IconDownload size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Menu.Target>
                <Menu.Dropdown>
                  {OPCOES_FORMATO.map((f) => (
                    <Menu.Item key={f.valor} onClick={() => void exportar(f.valor)}>
                      {f.rotulo}
                    </Menu.Item>
                  ))}
                </Menu.Dropdown>
              </Menu>
            </>
          )}
          {meta.acoes.incluir && !meta.somenteLeitura && !semNovo && (
            <Button
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => (aoAbrir ? aoAbrir({ id: null }) : abrir(`/e/${meta.nome}/novo`, `Novo(a) ${meta.tituloSingular.toLowerCase()}`))}
            >
              Novo
            </Button>
          )}
        </Group>
      </Group>
      <Paper withBorder radius="sm" style={{ flex: 1, minHeight: 0 }}>
        <Box className="ag-theme-quartz" h={altura ?? (compacto ? 300 : 'calc(100vh - 190px)')}>
          <AgGridReact
            columnDefs={colunas}
            defaultColDef={{ sortable: true, resizable: true, filter: true, suppressHeaderMenuButton: false }}
            rowModelType="infinite"
            cacheBlockSize={100}
            maxBlocksInCache={20}
            localeText={TEXTOS_GRADE}
            rowSelection="single"
            tooltipShowDelay={400}
            enableCellTextSelection
            onGridReady={(p) => {
              grade.current = p.api;
              p.api.setGridOption('datasource', fonte);
              if (!compacto)
                void carregarSalvas().then((ss) => {
                  const padrao = ss.find((s) => s.nome === 'padrao' && s.minha) ?? ss.find((s) => s.nome === 'padrao');
                  if (padrao) aplicarEstado(padrao.valor);
                });
            }}
            onRowClicked={(e) => aoSelecionar?.(e.data)}
            onRowDoubleClicked={(e) => e.data && abrirRegistro(e.data)}
            onColumnVisible={atualizarVisiveis}
          />
        </Box>
      </Paper>
      <ModalImpressao aberto={modalImpressao} aoFechar={() => setModalImpressao(false)} tituloPadrao={titulo ?? meta.titulo} aoImprimir={(t, z) => exportar('pdf', { titulo: t, zebrado: z })} />
    </Stack>
  );
}

/** Impressão da visualização atual com título personalizado e linhas zebradas (TR 1.1.2.1.44). */
function ModalImpressao({ aberto, aoFechar, tituloPadrao, aoImprimir }: { aberto: boolean; aoFechar: () => void; tituloPadrao: string; aoImprimir: (titulo: string, zebrado: boolean) => void }) {
  const [titulo, setTitulo] = useState(tituloPadrao);
  const [zebrado, setZebrado] = useState(true);
  return (
    <Modal opened={aberto} onClose={aoFechar} title="Imprimir consulta">
      <Stack>
        <TextInput label="Título do relatório" value={titulo} onChange={(e) => setTitulo(e.currentTarget.value)} />
        <Switch label="Linhas zebradas" checked={zebrado} onChange={(e) => setZebrado(e.currentTarget.checked)} />
        <Text size="xs" c="dimmed">
          A impressão respeita as colunas visíveis, a ordem, os filtros e a ordenação atuais, com totalizador de registros.
        </Text>
        <Group justify="flex-end">
          <Button
            leftSection={<IconPrinter size={16} />}
            onClick={() => {
              aoFechar();
              aoImprimir(titulo, zebrado);
            }}
          >
            Gerar PDF
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
