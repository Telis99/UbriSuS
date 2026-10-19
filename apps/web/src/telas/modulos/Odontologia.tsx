// Prontuário odontológico (TR 1.2.34): odontograma interativo em SVG (dentição permanente, decídua e
// mista; marcação por dente, face, arcada, quadrante, sextante e boca), plano de tratamento com etapas,
// Ficha de Atendimento Odontológico (e-SUS), vigilância em saúde bucal, fornecimento de material,
// anamnese odontológica, prontuário do paciente, fila odontológica e configuração da receita odontológica.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Grid,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Radio,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Timeline,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconCheck,
  IconClipboardList,
  IconDeviceFloppy,
  IconFileText,
  IconPlayerPlay,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconSpeakerphone,
  IconTrash,
  IconUserPlus,
  IconUserX,
  IconX,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api, urlArquivo } from '@/api';
import { useAuth } from '@/auth/Auth';
import { useJanelas, useTituloJanela } from '@/shell/Janelas';
import { BuscaPaciente, CabecalhoPaciente, idadeExtensa, usePaciente } from '@/componentes/Paciente';
import { abrirPdf, comConfirmacao, COR_RISCO, fmtData, fmtDataHora, notificarErro, notificarOk, RISCOS, SelecaoRef, Situacao, TabelaSimples, useCarregar, useIntervalo } from '@/componentes/comum';
import { confirmar, pedirTexto } from '@/genericos/dialogos';
import { HistoricoProntuario, registrarAbaAtendimento, type Completo } from '../Atendimento';
import { registrarMenuRelatorios } from '../Relatorios';
import { registrarTela } from '../registro';

// ---------------------------------------------------------------------------
// Tipos e geometria dos dentes (notação FDI)
// ---------------------------------------------------------------------------
interface SituacaoDente {
  id: number;
  codigo: string;
  nome: string;
  abrangencia: 'FACE' | 'DENTE';
  cor: string;
  simbolo: string | null;
  componente_cpo: string;
}
interface ProcOdonto {
  id: number;
  nome: string;
  marcacao: string;
  denticao: string;
  cor: string | null;
  itens: { codigo: string; nome: string; aplicaA: string; quantidade: number; porElemento: boolean }[];
}
interface Configuracao {
  faces: { codigo: string; nome: string }[];
  situacoes: SituacaoDente[];
  procedimentos: ProcOdonto[];
  grupos: { id: number; codigo: string; nome: string }[];
  tiposConsulta: [string, string][];
  tiposAtendimento: [string, string][];
  vigilancia: [string, string][];
  materiais: [string, string][];
  condutas: [string, string][];
  atualizacaoFilaSegundos: number;
}
interface SitEstado {
  id: number;
  codigo: string;
  nome: string;
  cor: string;
  simbolo: string | null;
  componente: string;
}
interface EstadoDente {
  dente: number;
  situacao: SitEstado | null;
  faces: Record<string, SitEstado>;
  planejados: string[];
}
interface Odontograma {
  marcacoes: any[];
  estado: EstadoDente[];
  indices: { cpod: { C: number; P: number; O: number; total: number; examinados: number }; ceod: { c: number; e: number; o: number; total: number; examinados: number } };
  planos: any[];
}

const SUP_PERM = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const INF_PERM = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const SUP_DEC = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const INF_DEC = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
const NOME_FACE: Record<string, string> = { M: 'Mesial', D: 'Distal', O: 'Oclusal/incisal', V: 'Vestibular', L: 'Lingual/palatina' };
const MARCACOES: [string, string][] = [
  ['DENTE', 'Dente'],
  ['FACE', 'Face'],
  ['ARCADA', 'Arcada'],
  ['QUADRANTE', 'Quadrante'],
  ['SEXTANTE', 'Sextante'],
  ['BOCA', 'Boca'],
];
const COR_STATUS: Record<string, string> = { EXISTENTE: 'gray', PLANEJADO: 'red', EXECUTADO: 'blue', CANCELADO: 'dark' };
const ROTULO_STATUS: Record<string, string> = { EXISTENTE: 'Situação', PLANEJADO: 'Planejado', EXECUTADO: 'Executado', CANCELADO: 'Cancelado' };

const ehDeciduo = (d: number) => Math.floor(d / 10) >= 5;
const quadranteDe = (d: number) => ((Math.floor(d / 10) - 1) % 4) + 1;
const arcadaDe = (d: number) => ([1, 2].includes(quadranteDe(d)) ? 'SUPERIOR' : 'INFERIOR');
const sextanteDe = (d: number) => {
  const q = quadranteDe(d);
  const anterior = d % 10 <= 3;
  return q === 1 ? (anterior ? 2 : 1) : q === 2 ? (anterior ? 2 : 3) : q === 3 ? (anterior ? 5 : 4) : anterior ? 5 : 6;
};

function denticaoPorIdade(anos?: number | null) {
  if (anos == null) return 'PERMANENTE';
  if (anos < 6) return 'DECIDUA';
  if (anos < 13) return 'MISTA';
  return 'PERMANENTE';
}

function descreverRegiao(m: any) {
  if (m.dente) return `${m.dente}${m.faces?.length ? ` (${m.faces.join('')})` : ''}`;
  if (m.marcacao === 'ARCADA') return `Arcada ${String(m.arcada ?? '').toLowerCase()}`;
  if (m.marcacao === 'QUADRANTE') return `Quadrante ${m.quadrante}`;
  if (m.marcacao === 'SEXTANTE') return `Sextante ${m.sextante}`;
  return 'Boca toda';
}

function noRegiao(d: number, modo: string, regiao: { arcada: string; quadrante: number; sextante: number }) {
  if (modo === 'BOCA') return true;
  if (modo === 'ARCADA') return arcadaDe(d) === regiao.arcada;
  if (modo === 'QUADRANTE') return quadranteDe(d) === regiao.quadrante;
  if (modo === 'SEXTANTE') return sextanteDe(d) === regiao.sextante;
  return false;
}

// ---------------------------------------------------------------------------
// Odontograma em SVG: dentes e faces clicáveis, cores por situação (TR 1.2.34.26, 1.2.34.27)
// ---------------------------------------------------------------------------
const T = 34; // lado do dente
const G = 6; // espaço entre dentes
const MEIO = 14; // espaço da linha média

interface PropsSvg {
  estado: Record<number, EstadoDente>;
  denticao: string;
  selecao: Record<number, string[]>;
  modo: string;
  regiao: { arcada: string; quadrante: number; sextante: number };
  aoClicar?: (dente: number, face: string | null) => void;
}

function Dente({ d, x, y, e, sel, destacado, aoClicar }: { d: number; x: number; y: number; e?: EstadoDente; sel?: string[]; destacado: boolean; aoClicar?: (dente: number, face: string | null) => void }) {
  const superior = arcadaDe(d) === 'SUPERIOR';
  const ladoDireitoPaciente = [1, 4].includes(quadranteDe(d));
  // Faces na tela: topo, base, esquerda, direita e centro conforme arcada e quadrante.
  const faceDe = { topo: superior ? 'V' : 'L', base: superior ? 'L' : 'V', esq: ladoDireitoPaciente ? 'D' : 'M', dir: ladoDireitoPaciente ? 'M' : 'D', centro: 'O' };
  const q = T / 4;
  const poligonos: [string, string][] = [
    [faceDe.topo, `0,0 ${T},0 ${T - q},${q} ${q},${q}`],
    [faceDe.base, `${q},${T - q} ${T - q},${T - q} ${T},${T} 0,${T}`],
    [faceDe.esq, `0,0 ${q},${q} ${q},${T - q} 0,${T}`],
    [faceDe.dir, `${T},0 ${T},${T} ${T - q},${T - q} ${T - q},${q}`],
  ];
  const sit = e?.situacao && e.situacao.codigo !== 'HIG' ? e.situacao : null;
  const corFace = (f: string) => e?.faces[f]?.cor ?? (sit ? sit.cor : '#ffffff');
  const opac = (f: string) => (e?.faces[f] ? 1 : sit ? 0.35 : 1);
  const selecionado = !!sel;
  const titulo = [
    `Dente ${d}${ehDeciduo(d) ? ' (decíduo)' : ''}`,
    e?.situacao ? `Situação: ${e.situacao.nome}` : '',
    ...Object.entries(e?.faces ?? {}).map(([f, s]) => `${NOME_FACE[f]}: ${s.nome}`),
    ...(e?.planejados.length ? [`Planejado: ${e.planejados.join(', ')}`] : []),
  ]
    .filter(Boolean)
    .join('\n');
  const yRotulo = superior ? -4 : T + 11;
  return (
    <g transform={`translate(${x},${y})`} style={{ cursor: aoClicar ? 'pointer' : 'default' }} data-dente={d}>
      <title>{titulo}</title>
      {destacado && <rect x={-3} y={-3} width={T + 6} height={T + 6} rx={4} fill="#d0ebff" />}
      <text
        x={T / 2}
        y={yRotulo}
        textAnchor="middle"
        fontSize={10}
        fontWeight={e?.planejados.length ? 700 : 500}
        fill={e?.planejados.length ? '#e03131' : '#495057'}
        onClick={() => aoClicar?.(d, null)}
      >
        {d}
      </text>
      {poligonos.map(([f, pts]) => (
        <polygon
          key={f}
          points={pts}
          fill={corFace(f)}
          fillOpacity={opac(f)}
          stroke={sel?.includes(f) ? '#1971c2' : '#868e96'}
          strokeWidth={sel?.includes(f) ? 2.5 : 0.8}
          onClick={() => aoClicar?.(d, f)}
          data-face={f}
        />
      ))}
      <rect
        x={q}
        y={q}
        width={T - 2 * q}
        height={T - 2 * q}
        fill={corFace('O')}
        fillOpacity={opac('O')}
        stroke={sel?.includes('O') ? '#1971c2' : '#868e96'}
        strokeWidth={sel?.includes('O') ? 2.5 : 0.8}
        onClick={() => aoClicar?.(d, 'O')}
        data-face="O"
      />
      {selecionado && <rect x={-1.5} y={-1.5} width={T + 3} height={T + 3} fill="none" stroke="#1971c2" strokeWidth={2} strokeDasharray={sel?.length ? '3 2' : undefined} pointerEvents="none" />}
      {sit?.simbolo && (
        <text x={T / 2} y={T / 2 + (sit.simbolo.length > 1 ? 5 : 8)} textAnchor="middle" fontSize={sit.simbolo.length > 1 ? 13 : 26} fontWeight={700} fill={sit.cor} pointerEvents="none">
          {sit.simbolo}
        </text>
      )}
      {!!e?.planejados.length && <circle cx={T - 3} cy={superior ? T + 4 : -4} r={3} fill="#e03131" pointerEvents="none" />}
    </g>
  );
}

export function OdontogramaSvg({ estado, denticao, selecao, modo, regiao, aoClicar }: PropsSvg) {
  const linhas: { dentes: number[]; deciduo: boolean }[] =
    denticao === 'DECIDUA'
      ? [
          { dentes: SUP_DEC, deciduo: true },
          { dentes: INF_DEC, deciduo: true },
        ]
      : denticao === 'MISTA'
        ? [
            { dentes: SUP_PERM, deciduo: false },
            { dentes: SUP_DEC, deciduo: true },
            { dentes: INF_DEC, deciduo: true },
            { dentes: INF_PERM, deciduo: false },
          ]
        : [
            { dentes: SUP_PERM, deciduo: false },
            { dentes: INF_PERM, deciduo: false },
          ];
  const larguraPerm = 16 * T + 15 * G + MEIO;
  const largura = larguraPerm + 20;
  const alturaLinha = T + 26;
  const altura = linhas.length * alturaLinha + 30;
  const posicoes = (n: number) => {
    const metade = n / 2;
    const larguraLinha = n * T + (n - 1) * G + MEIO;
    const x0 = 10 + (larguraPerm - larguraLinha) / 2;
    return Array.from({ length: n }, (_, i) => x0 + i * (T + G) + (i >= metade ? MEIO : 0));
  };
  return (
    <svg viewBox={`0 0 ${largura} ${altura}`} width="100%" style={{ maxWidth: 860, userSelect: 'none' }} role="img" aria-label="Odontograma">
      <line x1={largura / 2} y1={4} x2={largura / 2} y2={altura - 4} stroke="#ced4da" strokeDasharray="4 3" />
      <line x1={6} y1={(linhas.length / 2) * alturaLinha + 14} x2={largura - 6} y2={(linhas.length / 2) * alturaLinha + 14} stroke="#ced4da" strokeDasharray="4 3" />
      <text x={8} y={12} fontSize={9} fill="#868e96">
        Direito do paciente
      </text>
      <text x={largura - 8} y={12} fontSize={9} fill="#868e96" textAnchor="end">
        Esquerdo do paciente
      </text>
      {linhas.map((l, i) => {
        const xs = posicoes(l.dentes.length);
        const superior = i < linhas.length / 2;
        const y = 18 + i * alturaLinha + (superior ? 10 : 18);
        return (
          <g key={i}>
            {l.dentes.map((d, j) => (
              <Dente
                key={d}
                d={d}
                x={xs[j]}
                y={y}
                e={estado[d]}
                sel={selecao[d]}
                destacado={noRegiao(d, modo, regiao)}
                aoClicar={aoClicar}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Painel do odontograma: marcação, prévia SIGTAP, plano de tratamento e evolução
// ---------------------------------------------------------------------------
function useConfiguracao() {
  return useCarregar<Configuracao>(() => api.get('/api/odontologia/configuracao'), []);
}

export function PainelOdontograma({ pacienteId, atendimento, idadeAnos, encerrado }: { pacienteId: number; atendimento?: any; idadeAnos?: number | null; encerrado?: boolean }) {
  const { dados: cfg } = useConfiguracao();
  const { dados: od, recarregar } = useCarregar<Odontograma>(() => api.get(`/api/odontologia/pacientes/${pacienteId}/odontograma`), [pacienteId]);
  const { pode } = useAuth();
  const podeEditar = pode('odontologia:executar', 'ODO') && !encerrado;
  const [denticao, setDenticao] = useState(() => denticaoPorIdade(idadeAnos));
  const [modo, setModo] = useState('FACE');
  const [regiao, setRegiao] = useState({ arcada: 'SUPERIOR', quadrante: 1, sextante: 1 });
  const [selecao, setSelecao] = useState<Record<number, string[]>>({});
  const [tipo, setTipo] = useState<'SITUACAO' | 'PROCEDIMENTO'>('SITUACAO');
  const [situacaoId, setSituacaoId] = useState<string | null>(null);
  const [procId, setProcId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('PLANEJADO');
  const [etapaId, setEtapaId] = useState<string | null>(null);
  const [observacao, setObservacao] = useState('');
  const [previa, setPrevia] = useState<{ itens: any[]; criticas: string[] } | null>(null);
  const [mostrarCancelados, setMostrarCancelados] = useState(false);
  const regional = ['ARCADA', 'QUADRANTE', 'SEXTANTE', 'BOCA'].includes(modo);
  const estado = useMemo(() => Object.fromEntries((od?.estado ?? []).map((e) => [e.dente, e])) as Record<number, EstadoDente>, [od]);
  const planoAtivo = od?.planos.find((p) => p.situacao === 'EM_ANDAMENTO');
  const dentesSel = Object.keys(selecao).map(Number);
  const facesSel = [...new Set(Object.values(selecao).flat())];

  useEffect(() => {
    if (regional) setSelecao({});
    if (regional) setTipo('PROCEDIMENTO');
  }, [regional]);

  const situacoesCompat = (cfg?.situacoes ?? []).filter((s) => (modo === 'FACE' ? s.abrangencia === 'FACE' : s.abrangencia === 'DENTE'));
  const procsCompat = (cfg?.procedimentos ?? []).filter((p) => {
    if (modo === 'FACE') return p.marcacao === 'FACE';
    if (modo === 'DENTE') return ['DENTE', 'FACE'].includes(p.marcacao);
    if (modo === 'SEXTANTE') return p.marcacao === 'SEXTANTE';
    if (modo === 'ARCADA') return ['SEXTANTE', 'DENTE', 'FACE', 'ARCADA'].includes(p.marcacao);
    if (modo === 'QUADRANTE') return ['DENTE', 'FACE', 'QUADRANTE'].includes(p.marcacao);
    return true;
  });

  // Prévia dos procedimentos SIGTAP e das críticas antes de registrar (TR 1.2.34.29, 1.2.34.30).
  useEffect(() => {
    setPrevia(null);
    if (tipo !== 'PROCEDIMENTO' || !procId) return;
    const proc = cfg?.procedimentos.find((p) => String(p.id) === procId);
    const elementos = regional
      ? proc?.marcacao === 'SEXTANTE'
        ? modo === 'BOCA'
          ? 6
          : modo === 'ARCADA'
            ? 3
            : 1
        : ['DENTE', 'FACE'].includes(proc?.marcacao ?? '')
          ? [...SUP_PERM, ...INF_PERM].filter((d) => noRegiao(d, modo, regiao)).length
          : 1
      : 1;
    if (!regional && !dentesSel.length) return;
    api
      .get(`/api/odontologia/procedimentos/${procId}/sigtap`, { dentes: regional ? undefined : dentesSel.join(','), elementos, pacienteId })
      .then(setPrevia)
      .catch(() => setPrevia(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procId, tipo, modo, regiao, JSON.stringify(selecao)]);

  function clicar(d: number, face: string | null) {
    if (!podeEditar) return;
    if (regional) {
      // Clique em um dente seleciona a região que o contém.
      setRegiao({ arcada: arcadaDe(d), quadrante: quadranteDe(d), sextante: sextanteDe(d) });
      return;
    }
    setSelecao((s) => {
      const atual = s[d];
      if (modo === 'DENTE' || !face) {
        const n = { ...s };
        if (atual) delete n[d];
        else n[d] = [];
        return n;
      }
      const faces = atual ?? [];
      const novas = faces.includes(face) ? faces.filter((f) => f !== face) : [...faces, face];
      const n = { ...s };
      if (novas.length) n[d] = novas;
      else delete n[d];
      return n;
    });
  }

  async function registrar() {
    if (!regional && !dentesSel.length) return notificarErro(new Error('Selecione os dentes/faces no odontograma.'));
    const corpo = {
      pacienteId,
      atendimentoId: atendimento?.id ?? null,
      planoId: tipo === 'PROCEDIMENTO' && planoAtivo ? planoAtivo.id : null,
      etapaId: tipo === 'PROCEDIMENTO' && etapaId ? Number(etapaId) : null,
      marcacao: modo,
      dentes: regional ? undefined : dentesSel,
      faces: modo === 'FACE' ? facesSel : undefined,
      arcada: modo === 'ARCADA' ? regiao.arcada : null,
      quadrante: modo === 'QUADRANTE' ? regiao.quadrante : null,
      sextante: modo === 'SEXTANTE' ? regiao.sextante : null,
      denticao,
      situacaoId: tipo === 'SITUACAO' && situacaoId ? Number(situacaoId) : null,
      procedimentoOdontoId: tipo === 'PROCEDIMENTO' && procId ? Number(procId) : null,
      status: tipo === 'SITUACAO' ? 'EXISTENTE' : status,
      observacao: observacao || null,
    };
    // Face selecionada em modo face: uma requisição por dente com suas próprias faces.
    try {
      if (modo === 'FACE' && dentesSel.length > 1 && new Set(Object.values(selecao).map((f) => f.join())).size > 1) {
        for (const d of dentesSel) await api.post('/api/odontologia/marcacoes', { ...corpo, dentes: [d], faces: selecao[d] });
      } else await api.post('/api/odontologia/marcacoes', corpo);
      notificarOk(status === 'EXECUTADO' && tipo === 'PROCEDIMENTO' ? 'Procedimento executado e produção lançada.' : 'Registro incluído no odontograma.');
      setSelecao({});
      setObservacao('');
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }

  async function executar(m: any) {
    if (!atendimento) return notificarErro(new Error('A execução deve ser registrada em um atendimento.'));
    try {
      await api.post(`/api/odontologia/marcacoes/${m.id}/executar`, { atendimentoId: atendimento.id });
      notificarOk('Procedimento executado; produção lançada para o BPA.');
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function cancelar(m: any) {
    const motivo = await pedirTexto('Cancelar registro do odontograma', 'Motivo do cancelamento', { obrigatorio: true });
    if (!motivo) return;
    try {
      await api.post(`/api/odontologia/marcacoes/${m.id}/cancelar`, { motivo });
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }

  if (!cfg || !od) return <Text size="sm">Carregando odontograma...</Text>;
  const marcacoes = [...od.marcacoes].reverse().filter((m) => mostrarCancelados || m.status !== 'CANCELADO');
  const usadas = new Set([...od.estado.flatMap((e) => [e.situacao?.codigo, ...Object.values(e.faces).map((f) => f.codigo)])]);
  return (
    <Stack gap="xs">
      <Grid gutter="xs">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Paper withBorder p="xs">
            <Group justify="space-between" mb={4} gap="xs">
              <Group gap="xs">
                <Text size="xs" fw={600}>
                  Arcada
                </Text>
                <SegmentedControl
                  size="xs"
                  value={denticao}
                  onChange={setDenticao}
                  data={[
                    { value: 'PERMANENTE', label: 'Adulto (permanente)' },
                    { value: 'DECIDUA', label: 'Infantil (decídua)' },
                    { value: 'MISTA', label: 'Mista' },
                  ]}
                />
              </Group>
              <Group gap={6}>
                <Tooltip label="CPO-D: dentes permanentes cariados, perdidos e obturados">
                  <Badge variant="light" color="grape" data-indice="cpod">
                    CPO-D {od.indices.cpod.total} (C{od.indices.cpod.C} P{od.indices.cpod.P} O{od.indices.cpod.O})
                  </Badge>
                </Tooltip>
                <Tooltip label="ceo-d: dentes decíduos cariados, com extração indicada e obturados">
                  <Badge variant="light" color="cyan">
                    ceo-d {od.indices.ceod.total}
                  </Badge>
                </Tooltip>
              </Group>
            </Group>
            <Group gap="xs" mb={4}>
              <Text size="xs" fw={600}>
                Marcação
              </Text>
              <SegmentedControl size="xs" value={modo} onChange={setModo} data={MARCACOES.map(([value, label]) => ({ value, label }))} disabled={!podeEditar} />
              {modo === 'ARCADA' && (
                <SegmentedControl size="xs" value={regiao.arcada} onChange={(v) => setRegiao({ ...regiao, arcada: v })} data={[{ value: 'SUPERIOR', label: 'Superior' }, { value: 'INFERIOR', label: 'Inferior' }]} />
              )}
              {modo === 'QUADRANTE' && (
                <SegmentedControl size="xs" value={String(regiao.quadrante)} onChange={(v) => setRegiao({ ...regiao, quadrante: Number(v) })} data={['1', '2', '3', '4']} />
              )}
              {modo === 'SEXTANTE' && (
                <SegmentedControl size="xs" value={String(regiao.sextante)} onChange={(v) => setRegiao({ ...regiao, sextante: Number(v) })} data={['1', '2', '3', '4', '5', '6']} />
              )}
            </Group>
            <OdontogramaSvg estado={estado} denticao={denticao} selecao={selecao} modo={modo} regiao={regiao} aoClicar={podeEditar ? clicar : undefined} />
            <Group gap={6} mt={4}>
              {cfg.situacoes
                .filter((s) => usadas.has(s.codigo) || ['CAR', 'RES', 'AUS'].includes(s.codigo))
                .map((s) => (
                  <Group key={s.id} gap={3}>
                    <div style={{ width: 12, height: 12, background: s.cor, border: '1px solid #adb5bd', borderRadius: 2 }} />
                    <Text size="xs">
                      {s.simbolo ? `${s.simbolo} ` : ''}
                      {s.nome}
                    </Text>
                  </Group>
                ))}
              <Group gap={3}>
                <div style={{ width: 8, height: 8, background: '#e03131', borderRadius: 8 }} />
                <Text size="xs">Procedimento planejado</Text>
              </Group>
            </Group>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Paper withBorder p="xs">
            <Stack gap={6}>
              <Text size="sm" fw={600}>
                {regional ? `Região: ${descreverRegiao({ marcacao: modo, ...regiao })}` : dentesSel.length ? `Selecionado: ${dentesSel.map((d) => `${d}${selecao[d].length ? `(${selecao[d].join('')})` : ''}`).join(', ')}` : 'Clique nos dentes ou nas faces do odontograma'}
              </Text>
              {!podeEditar && (
                <Alert py={4} color="gray">
                  Odontograma somente para consulta.
                </Alert>
              )}
              {podeEditar && (
                <>
                  <SegmentedControl
                    size="xs"
                    value={tipo}
                    onChange={(v) => setTipo(v as 'SITUACAO' | 'PROCEDIMENTO')}
                    data={[
                      { value: 'SITUACAO', label: 'Situação do dente', disabled: regional },
                      { value: 'PROCEDIMENTO', label: 'Procedimento' },
                    ]}
                  />
                  {tipo === 'SITUACAO' ? (
                    <Select
                      size="xs"
                      label="Situação"
                      searchable
                      value={situacaoId}
                      onChange={setSituacaoId}
                      data={situacoesCompat.map((s) => ({ value: String(s.id), label: `${s.simbolo ? `[${s.simbolo}] ` : ''}${s.nome}` }))}
                      renderOption={({ option }) => {
                        const s = situacoesCompat.find((x) => String(x.id) === option.value);
                        return (
                          <Group gap={6}>
                            <div style={{ width: 12, height: 12, background: s?.cor, border: '1px solid #adb5bd' }} />
                            {option.label}
                          </Group>
                        );
                      }}
                    />
                  ) : (
                    <>
                      <Select
                        size="xs"
                        label="Procedimento odontológico"
                        searchable
                        value={procId}
                        onChange={setProcId}
                        data={procsCompat.map((p) => ({ value: String(p.id), label: p.nome }))}
                      />
                      <Radio.Group size="xs" value={status} onChange={setStatus} label="Status">
                        <Group gap="sm" mt={2}>
                          <Radio value="PLANEJADO" label="Planejado (plano de tratamento)" />
                          <Radio value="EXECUTADO" label="Executado agora" disabled={!atendimento} />
                        </Group>
                      </Radio.Group>
                      {planoAtivo && (
                        <Select
                          size="xs"
                          label="Etapa do plano de tratamento"
                          clearable
                          value={etapaId}
                          onChange={setEtapaId}
                          data={(planoAtivo.etapas ?? []).map((e: any) => ({ value: String(e.id), label: `${e.ordem}. ${e.descricao}` }))}
                        />
                      )}
                      {previa && (
                        <Paper withBorder p={6} bg="gray.0">
                          <Text size="xs" fw={600}>
                            Procedimentos SIGTAP gerados
                          </Text>
                          {previa.itens.map((i) => (
                            <Text key={i.codigo} size="xs">
                              {i.codigo} - {i.nome} × {i.quantidade}
                            </Text>
                          ))}
                          {previa.criticas.map((c) => (
                            <Text key={c} size="xs" c="red">
                              {c}
                            </Text>
                          ))}
                        </Paper>
                      )}
                    </>
                  )}
                  <TextInput size="xs" label="Observação" value={observacao} onChange={(e) => setObservacao(e.currentTarget.value)} />
                  <Group justify="space-between">
                    <Button size="xs" variant="subtle" onClick={() => setSelecao({})} disabled={!dentesSel.length}>
                      Limpar seleção
                    </Button>
                    <Button size="xs" leftSection={<IconCheck size={14} />} onClick={() => void registrar()} disabled={tipo === 'SITUACAO' ? !situacaoId : !procId || !!previa?.criticas.length}>
                      Registrar
                    </Button>
                  </Group>
                </>
              )}
            </Stack>
          </Paper>
          <PlanoTratamento pacienteId={pacienteId} atendimento={atendimento} planos={od.planos} podeEditar={podeEditar} aoMudar={() => void recarregar()} />
        </Grid.Col>
      </Grid>
      <Paper withBorder p="xs">
        <Group justify="space-between" mb={4}>
          <Text size="sm" fw={600}>
            Evolução do odontograma
          </Text>
          <Switch size="xs" label="Mostrar cancelados" checked={mostrarCancelados} onChange={(e) => setMostrarCancelados(e.currentTarget.checked)} />
        </Group>
        <Table striped fz="xs" withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Data</Table.Th>
              <Table.Th>Dente / região</Table.Th>
              <Table.Th>Situação / procedimento</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Etapa</Table.Th>
              <Table.Th>Profissional</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {marcacoes.map((m) => (
              <Table.Tr key={m.id} data-marcacao={m.id}>
                <Table.Td>{fmtData(m.executado_em ?? m.data)}</Table.Td>
                <Table.Td>{descreverRegiao(m)}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    {(m.situacao_cor || m.procedimento_cor) && <div style={{ width: 10, height: 10, background: m.situacao_cor ?? m.procedimento_cor, border: '1px solid #adb5bd' }} />}
                    {m.situacao_nome ?? m.procedimento}
                    {m.observacao ? <Text span size="xs" c="dimmed">— {m.observacao}</Text> : null}
                  </Group>
                  {m.motivo_cancelamento && (
                    <Text size="xs" c="dimmed">
                      Cancelado: {m.motivo_cancelamento}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" color={COR_STATUS[m.status]} variant="light">
                    {ROTULO_STATUS[m.status]}
                  </Badge>
                </Table.Td>
                <Table.Td>{m.etapa ?? ''}</Table.Td>
                <Table.Td>{m.profissional_execucao ?? m.profissional}</Table.Td>
                <Table.Td>
                  {podeEditar && m.status === 'PLANEJADO' && atendimento && (
                    <Button size="compact-xs" variant="light" onClick={() => void executar(m)}>
                      Executar
                    </Button>
                  )}
                  {podeEditar && m.status !== 'CANCELADO' && (
                    <Button size="compact-xs" variant="subtle" color="red" onClick={() => void cancelar(m)}>
                      Cancelar
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {!marcacoes.length && (
          <Text size="xs" c="dimmed" p="xs">
            Nenhum registro no odontograma.
          </Text>
        )}
      </Paper>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Plano de tratamento: etapas, primeira consulta programática e tratamento concluído
// ---------------------------------------------------------------------------
function PlanoTratamento({ pacienteId, atendimento, planos, podeEditar, aoMudar }: { pacienteId: number; atendimento?: any; planos: any[]; podeEditar: boolean; aoMudar: () => void }) {
  const ativo = planos.find((p) => p.situacao === 'EM_ANDAMENTO');
  const [novo, setNovo] = useState<{ primeiraConsulta: boolean; etapas: string[]; observacao: string } | null>(null);
  const [etapa, setEtapa] = useState('');
  const exec = async (f: () => Promise<unknown>, ok?: string) => {
    try {
      await f();
      if (ok) notificarOk(ok);
      aoMudar();
    } catch (e) {
      notificarErro(e);
    }
  };
  async function concluir() {
    if (!(await confirmar('Tratamento concluído', 'Registrar a conclusão do tratamento odontológico deste paciente?', 'Concluir'))) return;
    await exec(
      () => comConfirmacao((ok) => api.post(`/api/odontologia/planos/${ativo.id}/concluir`, { atendimentoId: atendimento?.id ?? null, cancelarPendentes: ok }), 'Procedimentos pendentes'),
      'Tratamento concluído registrado.',
    );
  }
  async function interromper() {
    const motivo = await pedirTexto('Interromper plano de tratamento', 'Motivo (abandono, mudança de município...)', { obrigatorio: true });
    if (motivo) await exec(() => api.post(`/api/odontologia/planos/${ativo.id}/interromper`, { motivo }), 'Plano interrompido.');
  }
  return (
    <Paper withBorder p="xs" mt="xs">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>
          Plano de tratamento
        </Text>
        {ativo && (
          <Button size="compact-xs" variant="subtle" leftSection={<IconPrinter size={12} />} onClick={() => void abrirPdf(`/api/odontologia/documentos/plano/${ativo.id}`)}>
            Imprimir
          </Button>
        )}
      </Group>
      {ativo ? (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Iniciado em {fmtData(ativo.inicio)} por {ativo.profissional ?? '-'} {ativo.primeira_consulta ? '· primeira consulta odontológica programática' : ''}
          </Text>
          {(ativo.etapas ?? []).map((e: any) => (
            <Group key={e.id} justify="space-between" wrap="nowrap" align="flex-start">
              <Text size="xs" style={{ flex: 1 }}>
                {e.situacao === 'CONCLUIDA' ? '✔' : '○'} {e.ordem}. {e.descricao}{' '}
                <Text span size="xs" c="dimmed">
                  ({e.executados} executado(s), {e.pendentes} pendente(s))
                </Text>
              </Text>
              {podeEditar && e.situacao !== 'CONCLUIDA' && (
                <Button size="compact-xs" variant="subtle" style={{ flexShrink: 0 }} onClick={() => void exec(() => api.post(`/api/odontologia/etapas/${e.id}/concluir`), 'Etapa concluída.')}>
                  Concluir
                </Button>
              )}
            </Group>
          ))}
          {podeEditar && (
            <>
              <Group gap={4} wrap="nowrap">
                <TextInput size="xs" placeholder="Nova etapa" value={etapa} onChange={(e) => setEtapa(e.currentTarget.value)} style={{ flex: 1 }} />
                <Button size="xs" variant="light" disabled={!etapa.trim()} onClick={() => void exec(() => api.post(`/api/odontologia/planos/${ativo.id}/etapas`, { descricao: etapa }), 'Etapa incluída.').then(() => setEtapa(''))}>
                  <IconPlus size={14} />
                </Button>
              </Group>
              <Group justify="space-between">
                <Button size="xs" variant="subtle" color="red" onClick={() => void interromper()}>
                  Interromper
                </Button>
                <Button size="xs" color="teal" leftSection={<IconCheck size={14} />} onClick={() => void concluir()}>
                  Tratamento concluído
                </Button>
              </Group>
            </>
          )}
        </Stack>
      ) : novo ? (
        <Stack gap={4}>
          <Checkbox size="xs" label="Primeira consulta odontológica programática" checked={novo.primeiraConsulta} onChange={(e) => setNovo({ ...novo, primeiraConsulta: e.currentTarget.checked })} />
          {novo.etapas.map((t, i) => (
            <TextInput key={i} size="xs" placeholder={`Etapa ${i + 1}`} value={t} onChange={(e) => setNovo({ ...novo, etapas: novo.etapas.map((x, j) => (j === i ? e.currentTarget.value : x)) })} />
          ))}
          <Button size="compact-xs" variant="subtle" leftSection={<IconPlus size={12} />} onClick={() => setNovo({ ...novo, etapas: [...novo.etapas, ''] })}>
            Etapa
          </Button>
          <Textarea size="xs" placeholder="Observações" value={novo.observacao} onChange={(e) => setNovo({ ...novo, observacao: e.currentTarget.value })} autosize />
          <Group justify="flex-end">
            <Button size="xs" variant="default" onClick={() => setNovo(null)}>
              Cancelar
            </Button>
            <Button
              size="xs"
              onClick={() =>
                void exec(
                  () => api.post('/api/odontologia/planos', { pacienteId, atendimentoId: atendimento?.id ?? null, primeiraConsulta: novo.primeiraConsulta, observacao: novo.observacao || null, etapas: novo.etapas.filter((x) => x.trim()) }),
                  'Plano de tratamento iniciado.',
                ).then(() => setNovo(null))
              }
            >
              Iniciar plano
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Nenhum plano de tratamento em andamento.
          </Text>
          {podeEditar && (
            <Button size="xs" variant="light" leftSection={<IconClipboardList size={14} />} onClick={() => setNovo({ primeiraConsulta: true, etapas: ['Adequação do meio bucal', 'Procedimentos restauradores', 'Manutenção e prevenção'], observacao: '' })}>
              Novo plano de tratamento
            </Button>
          )}
        </Stack>
      )}
      {planos.filter((p) => p.situacao !== 'EM_ANDAMENTO').length > 0 && (
        <Stack gap={2} mt={6}>
          <Text size="xs" fw={600}>
            Planos anteriores
          </Text>
          {planos
            .filter((p) => p.situacao !== 'EM_ANDAMENTO')
            .map((p) => (
              <Text key={p.id} size="xs" c="dimmed">
                {fmtData(p.inicio)} a {fmtData(p.conclusao)} · {p.situacao === 'CONCLUIDO' ? 'tratamento concluído' : `interrompido (${p.motivo_interrupcao ?? ''})`}
              </Text>
            ))}
        </Stack>
      )}
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Registro do atendimento odontológico: FAO e-SUS (TR 1.2.34.12, 1.2.34.31 a 1.2.34.39, 1.2.34.61, 1.2.34.65)
// ---------------------------------------------------------------------------
function Bloco({ titulo, children, acoes }: { titulo: string; children: ReactNode; acoes?: ReactNode }) {
  return (
    <Paper withBorder p="xs">
      <Group justify="space-between" mb={4}>
        <Text size="sm" fw={600}>
          {titulo}
        </Text>
        {acoes}
      </Group>
      {children}
    </Paper>
  );
}

// Dados do atendimento e do paciente exibidos ao profissional (TR 1.2.34.12, 1.2.34.12.1 a 1.2.34.12.10).
function DadosAtendimento({ dados }: { dados: Completo }) {
  const a = dados.atendimento;
  const p = dados.paciente;
  return (
    <Paper withBorder p={6} bg="blue.0">
      <Group gap="lg">
        <Text size="xs">
          <b>Data:</b> {fmtDataHora(a.inicio_em ?? a.entrada_em)}
        </Text>
        <Text size="xs">
          <b>Unidade:</b> {a.unidade}
        </Text>
        <Text size="xs">
          <b>Profissional:</b> {a.profissional ?? '-'}
        </Text>
        <Text size="xs">
          <b>Especialidade:</b> {a.especialidade ?? '-'}
        </Text>
        <Text size="xs">
          <b>Paciente:</b> {p?.nome} · {idadeExtensa(p?.idade)} · prontuário {p?.prontuario ?? '-'}
        </Text>
        <Text size="xs">
          <b>Mãe:</b> {p?.nome_mae ?? '-'} · <b>Pai:</b> {p?.nome_pai ?? '-'}
        </Text>
        <Text size="xs" c={p?.alergias?.length ? 'red' : undefined}>
          <b>Alergias:</b> {p?.alergias?.map((x: any) => x.substancia).join(', ') || 'nenhuma registrada'}
        </Text>
      </Group>
    </Paper>
  );
}

// Agendamento do retorno ao término do atendimento (TR 1.2.34.66).
function AgendarRetorno({ atendimentoId, encerrado }: { atendimentoId: number; encerrado: boolean }) {
  const [dias, setDias] = useState<number>(7);
  const { dados, recarregar } = useCarregar<{ horarios: any[]; agendados: any[] }>(() => api.get(`/api/odontologia/atendimentos/${atendimentoId}/retorno`, { dias }), [atendimentoId, dias]);
  const [horarioId, setHorarioId] = useState<string | null>(null);
  async function agendar() {
    if (!horarioId) return;
    try {
      const r = await comConfirmacao((ok) => api.post(`/api/odontologia/atendimentos/${atendimentoId}/retorno`, { horarioId: Number(horarioId), confirmarAvisos: ok }), 'Agendamento do retorno');
      if (!r) return;
      notificarOk(`Retorno agendado para ${fmtData(r.data)} às ${String(r.hora).slice(0, 5)}.`);
      setHorarioId(null);
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Bloco titulo="Agendar retorno">
      <Stack gap={4}>
        {!encerrado && (
          <>
            <Group grow gap={4} align="flex-end">
              <NumberInput size="xs" label="Retorno a partir de (dias)" min={0} max={180} value={dias} onChange={(v) => setDias(Number(v) || 0)} />
              <Select
                size="xs"
                label="Horário livre"
                value={horarioId}
                onChange={setHorarioId}
                searchable
                data={(dados?.horarios ?? []).map((h) => ({ value: String(h.id), label: `${fmtData(h.data)} ${h.hora} - ${h.profissional ?? h.agenda}` }))}
              />
            </Group>
            <Button size="xs" variant="light" disabled={!horarioId} onClick={() => void agendar()}>
              Agendar retorno
            </Button>
          </>
        )}
        {(dados?.agendados ?? []).map((g) => (
          <Text key={g.id} size="xs">
            Agendado: {fmtData(g.data)} {g.hora ?? ''} · {g.agenda} · <Situacao valor={g.situacao} />
          </Text>
        ))}
      </Stack>
    </Bloco>
  );
}

// Saldo do medicamento prescrito (sem restringir a prescrição) e reserva na rede de farmácia básica
// enquanto a receita estiver válida e não dispensada (TR 1.2.34.53, 1.2.34.54).
function SaldoMedicamentos({ atendimentoId }: { atendimentoId: number }) {
  const { dados } = useCarregar<any[]>(() => api.get(`/api/odontologia/atendimentos/${atendimentoId}/medicamentos`), [atendimentoId]);
  const [produtoId, setProdutoId] = useState<number | null>(null);
  const { dados: saldo } = useCarregar<any>(() => (produtoId ? api.get(`/api/odontologia/medicamentos/${produtoId}/saldo`) : Promise.resolve(null)), [produtoId]);
  return (
    <Bloco titulo="Medicamentos: saldo e reserva na rede">
      <Grid gutter="xs">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <SelecaoRef entidade="produto" rotulo="Consultar saldo de medicamento" valor={produtoId} aoMudar={setProdutoId} />
          {saldo && (
            <Text size="xs" mt={4}>
              Saldo na unidade: <b>{saldo.unidade}</b> · na rede: <b>{saldo.rede}</b> · reservado em receitas: {saldo.reservadoReceitas}
              <br />
              <Text span size="xs" c="dimmed">
                A falta de saldo não impede a prescrição.
              </Text>
            </Text>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 8 }}>
          <TabelaSimples
            linhas={dados ?? []}
            vazio="Nenhum medicamento prescrito neste atendimento."
            colunas={[
              { titulo: 'Receita', valor: (l: any) => `${l.numero} (${l.tipo_receita})` },
              { titulo: 'Medicamento', valor: (l: any) => l.descricao },
              { titulo: 'Qtd', valor: (l: any) => `${Number(l.quantidade ?? 0)} (dispensado ${Number(l.dispensada)})` },
              { titulo: 'Saldo unidade / rede', valor: (l: any) => (l.produto_id ? `${Number(l.saldo_unidade)} / ${Number(l.saldo_rede)}` : 'fora da REMUME') },
              {
                titulo: 'Reserva',
                valor: (l: any) =>
                  l.reserva_ativa ? (
                    <Badge size="xs" color="teal" variant="light">
                      Reservado até {fmtData(l.validade)}
                    </Badge>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {l.situacao === 'DISPENSADA' ? 'Dispensado' : '-'}
                    </Text>
                  ),
              },
            ]}
          />
        </Grid.Col>
      </Grid>
    </Bloco>
  );
}

export function PainelFao({ dados, encerrado, aoGravar }: { dados: Completo; encerrado: boolean; aoGravar: () => void }) {
  const id = dados.atendimento.id;
  const { dados: cfg } = useConfiguracao();
  const { dados: fao, recarregar } = useCarregar<any>(() => api.get(`/api/odontologia/atendimentos/${id}`), [id]);
  const [f, setF] = useState<Record<string, any> | null>(null);
  const [mat, setMat] = useState<Record<string, number>>({ ESCOVA: 0, CREME: 0, FIO: 0 });
  const [notif, setNotif] = useState<Record<string, any>>({ caso: 'SUSPEITO' });
  const [cidSec, setCidSec] = useState<{ id: number; rotulo: string }[]>([]);
  useEffect(() => {
    if (!fao) return;
    const o = fao.odonto ?? {};
    const a = fao.atendimento;
    setF({
      tipoConsulta: o.tipo_consulta ?? null,
      tipoAtendimentoSia: a.tipo_atendimento_sia ?? null,
      grupoAtendimentoId: o.grupo_atendimento_id ? String(o.grupo_atendimento_id) : null,
      denticao: o.denticao ?? denticaoPorIdade(dados.paciente?.idade?.anos),
      gestante: o.gestante ?? !!dados.paciente?.gestante,
      necessidadesEspeciais: !!o.necessidades_especiais,
      condutas: o.condutas ?? [],
      observacao: o.observacao ?? '',
      cidId: a.cid_id ?? null,
      ciapId: a.ciap_id ?? null,
      vigilancia: a.saude_bucal ?? [],
    });
    setCidSec((fao.cidsSecundarios ?? []).map((c: any) => ({ id: Number(c.id), rotulo: `${c.codigo} - ${c.nome}` })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fao]);
  if (!cfg || !fao || !f) return <Text size="sm">Carregando...</Text>;
  const salvar = async () => {
    try {
      await api.put(`/api/odontologia/atendimentos/${id}`, {
        ...f,
        grupoAtendimentoId: f.grupoAtendimentoId ? Number(f.grupoAtendimentoId) : null,
        cidsSecundarios: cidSec.map((c) => c.id),
        observacao: f.observacao || null,
      });
      notificarOk('Dados do atendimento odontológico gravados.');
      await recarregar();
      aoGravar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const fornecer = async () => {
    try {
      const r = await api.post(`/api/odontologia/atendimentos/${id}/materiais`, mat);
      notificarOk(r.baixas.length ? `Material fornecido; baixa de ${r.baixas.length} item(ns) no estoque.` : 'Material fornecido.');
      for (const a of r.avisos) notificarErro(new Error(a));
      setMat({ ESCOVA: 0, CREME: 0, FIO: 0 });
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const notificar = async () => {
    try {
      await api.post(`/api/odontologia/atendimentos/${id}/notificacao`, notif);
      notificarOk('Ficha de notificação registrada e enviada à Vigilância Epidemiológica.');
      setNotif({ caso: 'SUSPEITO' });
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const materiais: Record<string, number> = fao.atendimento.material_odonto ?? {};
  return (
    <Stack gap="xs">
      <DadosAtendimento dados={dados} />
      <Grid gutter="xs">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Bloco titulo="Atendimento (FAO / SIA)">
            <SimpleGrid cols={2} spacing={6}>
              <Select size="xs" label="Tipo de atendimento (SIA)" value={f.tipoAtendimentoSia} onChange={(v) => setF({ ...f, tipoAtendimentoSia: v })} data={cfg.tiposAtendimento.map(([value, label]) => ({ value, label }))} disabled={encerrado} />
              <Select size="xs" label="Grupo de atendimento (SIA)" value={f.grupoAtendimentoId} onChange={(v) => setF({ ...f, grupoAtendimentoId: v })} data={cfg.grupos.map((g) => ({ value: String(g.id), label: `${g.codigo} - ${g.nome}` }))} disabled={encerrado} />
              <Select size="xs" label="Tipo de consulta" value={f.tipoConsulta} onChange={(v) => setF({ ...f, tipoConsulta: v })} data={cfg.tiposConsulta.map(([value, label]) => ({ value, label }))} disabled={encerrado} />
              <Select
                size="xs"
                label="Dentição"
                value={f.denticao}
                onChange={(v) => setF({ ...f, denticao: v })}
                data={[
                  { value: 'PERMANENTE', label: 'Permanente' },
                  { value: 'DECIDUA', label: 'Decídua' },
                  { value: 'MISTA', label: 'Mista' },
                ]}
                disabled={encerrado}
              />
            </SimpleGrid>
            <Group mt={6}>
              <Checkbox size="xs" label="Gestante" checked={f.gestante} onChange={(e) => setF({ ...f, gestante: e.currentTarget.checked })} disabled={encerrado} />
              <Checkbox size="xs" label="Paciente com necessidades especiais" checked={f.necessidadesEspeciais} onChange={(e) => setF({ ...f, necessidadesEspeciais: e.currentTarget.checked })} disabled={encerrado} />
            </Group>
          </Bloco>
          <Bloco titulo="Diagnóstico">
            <SimpleGrid cols={2} spacing={6}>
              <div>
                <SelecaoRef entidade="cid" rotulo="CID-10 principal" valor={f.cidId} aoMudar={(v) => setF({ ...f, cidId: v })} desabilitado={encerrado} />
                {fao.atendimento.cid_codigo && f.cidId === fao.atendimento.cid_id && (
                  <Text size="xs" c="dimmed">
                    {fao.atendimento.cid_codigo} - {fao.atendimento.cid_nome}
                  </Text>
                )}
              </div>
              <div>
                <SelecaoRef entidade="ciap" rotulo="CIAP-2" valor={f.ciapId} aoMudar={(v) => setF({ ...f, ciapId: v })} desabilitado={encerrado} />
                {fao.atendimento.ciap_codigo && f.ciapId === fao.atendimento.ciap_id && (
                  <Text size="xs" c="dimmed">
                    {fao.atendimento.ciap_codigo} - {fao.atendimento.ciap_nome}
                  </Text>
                )}
              </div>
            </SimpleGrid>
            <SelecaoRef
              entidade="cid"
              rotulo="Incluir CID secundário"
              valor={null}
              aoMudar={(v, r) => v && !cidSec.some((c) => c.id === v) && setCidSec([...cidSec, { id: v, rotulo: r ?? `#${v}` }])}
              desabilitado={encerrado}
            />
            <Group gap={4} mt={4}>
              {cidSec.map((c) => (
                <Badge key={c.id} variant="light" rightSection={!encerrado && <IconX size={10} style={{ cursor: 'pointer' }} onClick={() => setCidSec(cidSec.filter((x) => x.id !== c.id))} />}>
                  {c.rotulo}
                </Badge>
              ))}
            </Group>
          </Bloco>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Bloco titulo="Vigilância em saúde bucal">
            <Checkbox.Group value={f.vigilancia} onChange={(v) => setF({ ...f, vigilancia: v })}>
              <SimpleGrid cols={2} spacing={4}>
                {cfg.vigilancia.map(([value, label]) => (
                  <Checkbox key={value} size="xs" value={value} label={label} disabled={encerrado} />
                ))}
              </SimpleGrid>
            </Checkbox.Group>
          </Bloco>
          <AgendarRetorno atendimentoId={id} encerrado={encerrado} />
          <Bloco titulo="Conduta / desfecho e encaminhamentos">
            <MultiSelect size="xs" value={f.condutas} onChange={(v) => setF({ ...f, condutas: v })} data={cfg.condutas.map(([value, label]) => ({ value, label }))} searchable disabled={encerrado} />
            <Textarea size="xs" mt={4} placeholder="Observação" value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.currentTarget.value })} autosize disabled={encerrado} />
          </Bloco>
        </Grid.Col>
      </Grid>
      {!encerrado && (
        <Group justify="flex-end">
          <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={() => void salvar()}>
            Gravar registro odontológico
          </Button>
        </Group>
      )}
      <Grid gutter="xs">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Bloco titulo="Fornecimento de material odontológico">
            <Text size="xs" c="dimmed" mb={4}>
              Fornecido neste atendimento: {cfg.materiais.map(([k, v]) => `${v} ${materiais[k] ?? 0}`).join(' · ')}
            </Text>
            {!encerrado && (
              <>
                <SimpleGrid cols={3} spacing={4}>
                  {cfg.materiais.map(([k, v]) => (
                    <NumberInput key={k} size="xs" label={v} min={0} max={20} value={mat[k]} onChange={(n) => setMat({ ...mat, [k]: Number(n) || 0 })} />
                  ))}
                </SimpleGrid>
                <Button size="xs" mt={6} variant="light" fullWidth onClick={() => void fornecer()} disabled={!Object.values(mat).some(Boolean)}>
                  Registrar fornecimento
                </Button>
              </>
            )}
          </Bloco>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Bloco titulo="Notificação de agravo (e-SUS / SINAN)">
            {!encerrado && (
              <Stack gap={4}>
                <SelecaoRef entidade="cid" rotulo="Agravo (CID)" valor={notif.cidId} aoMudar={(v) => setNotif({ ...notif, cidId: v })} />
                <Group grow gap={4}>
                  <TextInput size="xs" type="date" label="1ºs sintomas" value={notif.dataPrimeirosSintomas ?? ''} onChange={(e) => setNotif({ ...notif, dataPrimeirosSintomas: e.currentTarget.value || null })} />
                  <Select size="xs" label="Caso" value={notif.caso} onChange={(v) => setNotif({ ...notif, caso: v })} data={[{ value: 'SUSPEITO', label: 'Suspeito' }, { value: 'CONFIRMADO', label: 'Confirmado' }]} />
                </Group>
                <TextInput size="xs" label="Sinais e sintomas" value={notif.sinais ?? ''} onChange={(e) => setNotif({ ...notif, sinais: e.currentTarget.value })} />
                <Button size="xs" variant="light" onClick={() => void notificar()} disabled={!notif.cidId}>
                  Registrar notificação
                </Button>
              </Stack>
            )}
            {fao.notificacoes.map((n: any) => (
              <Text key={n.id} size="xs">
                {fmtDataHora(n.data_hora)} · {n.agravo} · <Situacao valor={n.situacao} />
              </Text>
            ))}
          </Bloco>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Bloco titulo="Documentos odontológicos">
            <Stack gap={4}>
              <Button size="xs" variant="light" leftSection={<IconPrinter size={14} />} onClick={() => void abrirPdf(`/api/odontologia/documentos/fao?atendimentoId=${id}`)}>
                Imprimir FAO preenchida
              </Button>
              {fao.prescricoes.map((r: any) => (
                <Button key={r.id} size="xs" variant="default" leftSection={<IconFileText size={14} />} onClick={() => void abrirPdf(`/api/odontologia/documentos/receita/${r.id}`)}>
                  Receita odontológica {r.numero} ({r.tipo_receita})
                </Button>
              ))}
              {!fao.prescricoes.length && (
                <Text size="xs" c="dimmed">
                  Prescreva na aba Prescrição para imprimir a receita odontológica com código de barras.
                </Text>
              )}
              {fao.executados.length > 0 && (
                <Text size="xs" c="dimmed">
                  Procedimentos executados: {fao.executados.map((m: any) => `${descreverRegiao(m)} ${m.procedimento}`).join('; ')}
                </Text>
              )}
            </Stack>
          </Bloco>
        </Grid.Col>
      </Grid>
      <SaldoMedicamentos atendimentoId={id} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Anamnese odontológica: nova anamnese ou histórico (TR 1.2.34.13, 1.2.34.14)
// ---------------------------------------------------------------------------
type Resposta = { opcoes: number[]; texto?: string; observacao?: string };

export function PainelAnamnese({ pacienteId, podeEditar }: { pacienteId: number; podeEditar: boolean }) {
  const { dados: modelos } = useCarregar<any[]>(() => api.get('/api/odontologia/anamneses/modelos'), []);
  const { dados: historico, recarregar } = useCarregar<any[]>(() => api.get(`/api/odontologia/pacientes/${pacienteId}/anamneses`), [pacienteId]);
  const [modeloId, setModeloId] = useState<string | null>(null);
  const [resp, setResp] = useState<Record<number, Resposta>>({});
  const [nova, setNova] = useState(false);
  const modelo = modelos?.find((m) => String(m.id) === (modeloId ?? String(modelos?.[0]?.id)));
  const marcadas = new Set(Object.values(resp).flatMap((r) => r.opcoes));
  const visivel = (p: any) => !p.dependeOpcaoId || marcadas.has(p.dependeOpcaoId);
  const mudar = (pid: number, r: Partial<Resposta>) => setResp({ ...resp, [pid]: { ...(resp[pid] ?? { opcoes: [] }), ...r } });
  async function salvar() {
    if (!modelo) return;
    const respostas = Object.fromEntries(Object.entries(resp).filter(([pid]) => visivel(modelo.perguntas.find((p: any) => p.id === Number(pid)))));
    try {
      const r = await api.post(`/api/odontologia/pacientes/${pacienteId}/anamneses`, { anamneseId: modelo.id, respostas });
      notificarOk(`Anamnese registrada.${r.condicoesAtribuidas.length ? ` Condições de saúde atualizadas: ${r.condicoesAtribuidas.join(', ')}.` : ''}`);
      setResp({});
      setNova(false);
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  const textoResposta = (m: any, pid: string, r: Resposta) => {
    const p = m?.perguntas.find((x: any) => x.id === Number(pid));
    const ops = r.opcoes.map((o) => p?.opcoes.find((x: any) => x.id === o)?.texto ?? o).join(', ');
    return { pergunta: p?.texto ?? pid, resposta: [ops, r.texto, r.observacao].filter(Boolean).join(' — ') };
  };
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="sm" fw={600}>
          Anamnese odontológica
        </Text>
        {podeEditar && !nova && (
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setNova(true)} disabled={!modelos?.length}>
            Preencher nova anamnese
          </Button>
        )}
      </Group>
      {nova && modelo && (
        <Paper withBorder p="xs">
          <Select size="xs" label="Modelo" value={String(modelo.id)} onChange={setModeloId} data={(modelos ?? []).map((m) => ({ value: String(m.id), label: m.nome }))} mb={6} />
          <Stack gap={8}>
            {modelo.perguntas.filter(visivel).map((p: any) => (
              <div key={p.id}>
                <Text size="xs" fw={600}>
                  {p.ordem}. {p.texto} {p.obrigatoria ? <Text span c="red">*</Text> : null}
                </Text>
                {p.tipo === 'TEXTO' && <TextInput size="xs" value={resp[p.id]?.texto ?? ''} onChange={(e) => mudar(p.id, { texto: e.currentTarget.value })} />}
                {['UNICA', 'UNICA_OBS'].includes(p.tipo) && (
                  <Radio.Group size="xs" value={resp[p.id]?.opcoes[0] ? String(resp[p.id].opcoes[0]) : ''} onChange={(v) => mudar(p.id, { opcoes: [Number(v)] })}>
                    <Group gap="sm">
                      {p.opcoes.map((o: any) => (
                        <Radio key={o.id} value={String(o.id)} label={o.texto} />
                      ))}
                    </Group>
                  </Radio.Group>
                )}
                {['MULTIPLA', 'MULTIPLA_OBS'].includes(p.tipo) && (
                  <Checkbox.Group value={(resp[p.id]?.opcoes ?? []).map(String)} onChange={(v) => mudar(p.id, { opcoes: v.map(Number) })}>
                    <Group gap="sm">
                      {p.opcoes.map((o: any) => (
                        <Checkbox key={o.id} size="xs" value={String(o.id)} label={o.texto} />
                      ))}
                    </Group>
                  </Checkbox.Group>
                )}
                {p.tipo === 'SELECAO' && (
                  <Select size="xs" w={240} value={resp[p.id]?.opcoes[0] ? String(resp[p.id].opcoes[0]) : null} onChange={(v) => mudar(p.id, { opcoes: v ? [Number(v)] : [] })} data={p.opcoes.map((o: any) => ({ value: String(o.id), label: o.texto }))} />
                )}
                {p.tipo.endsWith('_OBS') && <TextInput size="xs" mt={2} placeholder="Observação" value={resp[p.id]?.observacao ?? ''} onChange={(e) => mudar(p.id, { observacao: e.currentTarget.value })} />}
              </div>
            ))}
          </Stack>
          <Group justify="flex-end" mt="xs">
            <Button size="xs" variant="default" onClick={() => setNova(false)}>
              Cancelar
            </Button>
            <Button size="xs" leftSection={<IconDeviceFloppy size={14} />} onClick={() => void salvar()}>
              Gravar anamnese
            </Button>
          </Group>
        </Paper>
      )}
      <Accordion variant="contained">
        {(historico ?? []).map((h) => {
          const m = modelos?.find((x) => x.id === h.anamnese_id);
          return (
            <Accordion.Item key={h.id} value={String(h.id)}>
              <Accordion.Control>
                <Text size="xs">
                  {fmtDataHora(h.data_hora)} · {h.modelo} · {h.profissional ?? '-'} · {h.unidade ?? ''}
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                {Object.entries(h.respostas ?? {}).map(([pid, r]) => {
                  const t = textoResposta(m, pid, r as Resposta);
                  return (
                    <Text key={pid} size="xs">
                      <b>{t.pergunta}</b> {t.resposta}
                    </Text>
                  );
                })}
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
      {!historico?.length && (
        <Text size="xs" c="dimmed">
          Nenhuma anamnese odontológica registrada.
        </Text>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Prontuário odontológico do paciente (TR 1.2.34.15 a 1.2.34.25, 1.2.34.40, 1.2.34.49, 1.2.34.68, 1.2.34.73)
// ---------------------------------------------------------------------------
const CONDICOES: Record<string, string> = {
  gestante: 'Gestante',
  fumante: 'Fumante',
  alcool: 'Uso de álcool',
  drogas: 'Uso de outras drogas',
  hipertensao: 'Hipertensão arterial',
  diabetes: 'Diabetes',
  avc: 'AVC',
  infarto: 'Infarto',
  cardiaca: 'Doença cardíaca',
  rins: 'Problema nos rins',
  respiratoria: 'Doença respiratória',
  hanseniase: 'Hanseníase',
  tuberculose: 'Tuberculose',
  cancer: 'Câncer',
  saude_mental: 'Saúde mental',
  acamado: 'Acamado',
  domiciliado: 'Domiciliado',
};

function Sigilosos({ pacienteId }: { pacienteId: number }) {
  const { dados } = useCarregar<any[]>(() => api.get(`/api/pacientes/${pacienteId}/sigilosos`), [pacienteId]);
  return (
    <TabelaSimples
      linhas={dados ?? []}
      vazio="Nenhum registro sigiloso liberado para o operador."
      colunas={[
        { titulo: 'Data', valor: (l: any) => fmtDataHora(l.data_hora) },
        { titulo: 'Autor', valor: (l: any) => l.autor },
        { titulo: 'Registro', valor: (l: any) => l.texto },
      ]}
    />
  );
}

function Vacinas({ pacienteId }: { pacienteId: number }) {
  const { dados } = useCarregar<any[]>(() => api.get(`/api/pacientes/${pacienteId}/historico/vacinas`), [pacienteId]);
  return (
    <TabelaSimples
      linhas={dados ?? []}
      vazio="Nenhuma vacina registrada."
      colunas={[
        { titulo: 'Data', valor: (l: any) => fmtData(l.data) },
        { titulo: 'Imunobiológico', valor: (l: any) => l.imunobiologico },
        { titulo: 'Dose', valor: (l: any) => l.dose },
        { titulo: 'Lote', valor: (l: any) => l.lote },
        { titulo: 'Unidade', valor: (l: any) => l.unidade },
      ]}
    />
  );
}

export function PainelProntuario({ pacienteId }: { pacienteId: number }) {
  const { pode } = useAuth();
  const { dados } = useCarregar<any>(() => api.get(`/api/odontologia/pacientes/${pacienteId}/prontuario`), [pacienteId]);
  const { dados: cfg } = useConfiguracao();
  const [aba, setAba] = useState<string | null>('odonto');
  const rotulos = (lista: [string, string][] | undefined, v: string[]) => v.map((k) => lista?.find(([c]) => c === k)?.[1] ?? k).join(', ');
  if (!dados) return <Text size="sm">Carregando prontuário...</Text>;
  const cond: string[] = dados.paciente.condicoes_saude ?? [];
  return (
    <Tabs value={aba} onChange={setAba} keepMounted={false} variant="outline">
      <Tabs.List>
        <Tabs.Tab value="odonto">Atendimentos odontológicos ({dados.atendimentos.length})</Tabs.Tab>
        <Tabs.Tab value="medico">Prontuário médico</Tabs.Tab>
        <Tabs.Tab value="doencas">Doenças e agravantes</Tabs.Tab>
        <Tabs.Tab value="exames">Exames ({dados.exames.length})</Tabs.Tab>
        <Tabs.Tab value="medicamentos">Medicamentos retirados</Tabs.Tab>
        <Tabs.Tab value="continuo">Uso contínuo</Tabs.Tab>
        <Tabs.Tab value="vacinas">Vacinas</Tabs.Tab>
        <Tabs.Tab value="familia">Família</Tabs.Tab>
        <Tabs.Tab value="sigiloso">Sigilosos</Tabs.Tab>
      </Tabs.List>
      <Paper p="xs" withBorder style={{ borderTop: 0 }}>
        <Tabs.Panel value="odonto">
          <Timeline bulletSize={14} lineWidth={2}>
            {dados.atendimentos.map((a: any) => (
              <Timeline.Item key={a.id} title={`${fmtDataHora(a.entrada_em)} · ${a.unidade} · ${a.especialidade ?? 'Odontologia'}`}>
                <Text size="xs" c="dimmed">
                  {a.profissional ?? '-'} {a.registro ? `(${a.registro})` : ''} <Situacao valor={a.situacao} />
                </Text>
                {a.subjetivo && <Text size="xs">S: {a.subjetivo}</Text>}
                {a.avaliacao && <Text size="xs">A: {a.avaliacao}</Text>}
                {a.plano && <Text size="xs">P: {a.plano}</Text>}
                {a.cid && <Text size="xs">CID: {a.cid}</Text>}
                {a.procedimentos && <Text size="xs">Procedimentos: {a.procedimentos.join('; ')}</Text>}
                {a.producao && (
                  <Text size="xs" c="dimmed">
                    SIGTAP: {a.producao.join('; ')}
                  </Text>
                )}
                {a.prescricoes && <Text size="xs">Prescrições: {a.prescricoes.join('; ')}</Text>}
                {a.exames && <Text size="xs">Exames requisitados: {a.exames.join('; ')}</Text>}
                {a.documentos && <Text size="xs">Atestados/declarações: {a.documentos.join('; ')}</Text>}
                {a.saude_bucal?.length > 0 && <Text size="xs">Vigilância em saúde bucal: {rotulos(cfg?.vigilancia, a.saude_bucal)}</Text>}
                {a.condutas?.length > 0 && <Text size="xs">Conduta: {rotulos(cfg?.condutas, a.condutas)}</Text>}
                {a.tipo_consulta && <Text size="xs">Tipo de consulta: {rotulos(cfg?.tiposConsulta, [a.tipo_consulta])}</Text>}
              </Timeline.Item>
            ))}
          </Timeline>
          {!dados.atendimentos.length && (
            <Text size="xs" c="dimmed">
              Nenhum atendimento odontológico.
            </Text>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="medico">
          <HistoricoProntuario pacienteId={pacienteId} />
        </Tabs.Panel>
        <Tabs.Panel value="doencas">
          <Group gap={4} mb="xs">
            <Text size="xs" fw={600}>
              Condições de saúde (e-SUS):
            </Text>
            {cond.length ? cond.map((c) => <Badge key={c} size="sm" variant="light" color="orange">{CONDICOES[c] ?? c}</Badge>) : <Text size="xs">nenhuma registrada</Text>}
          </Group>
          <TabelaSimples
            linhas={dados.doencas}
            vazio="Nenhum diagnóstico registrado."
            colunas={[
              { titulo: 'Data', valor: (l: any) => fmtData(l.data) },
              { titulo: 'CID', valor: (l: any) => l.cid },
              { titulo: 'Notificável', valor: (l: any) => (l.notificavel ? 'Sim' : '') },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="exames">
          <TabelaSimples
            linhas={dados.exames}
            vazio="Nenhum exame requisitado."
            colunas={[
              { titulo: 'Data', valor: (l: any) => fmtData(l.data) },
              { titulo: 'Exame', valor: (l: any) => l.exame },
              { titulo: 'Situação', valor: (l: any) => <Situacao valor={l.situacao} /> },
              { titulo: 'Resultado', valor: (l: any) => (l.resultado_texto ? String(l.resultado_texto).slice(0, 80) : l.resultado_liberado_em ? 'Liberado' : '-') },
              {
                titulo: '',
                valor: (l: any) => (
                  <Group gap={4} wrap="nowrap">
                    {l.resultado_arquivo_id && (
                      <Button size="compact-xs" variant="subtle" onClick={() => window.open(urlArquivo(l.resultado_arquivo_id), '_blank')}>
                        Arquivo
                      </Button>
                    )}
                    {(l.resultado_texto || l.resultado_liberado_em) && (
                      <Button size="compact-xs" variant="subtle" leftSection={<IconPrinter size={12} />} onClick={() => void abrirPdf(`/api/odontologia/exames/${l.id}/resultado`)}>
                        Imprimir
                      </Button>
                    )}
                    <Button size="compact-xs" variant="subtle" onClick={() => void abrirPdf(`/api/documentos/requisicao/${l.solicitacao_id}`)}>
                      Requisição
                    </Button>
                  </Group>
                ),
              },
            ]}
          />
          <Text size="xs" fw={600} mt="xs">
            Histórico de cancelamentos de requisições (auditoria)
          </Text>
          <TabelaSimples
            linhas={dados.requisicoesCanceladas}
            vazio="Nenhuma requisição cancelada."
            colunas={[
              { titulo: 'Requisição', valor: (l: any) => `${l.numero} (${fmtData(l.data)})` },
              { titulo: 'Exames', valor: (l: any) => l.exames },
              { titulo: 'Justificativa', valor: (l: any) => l.motivo_cancelamento },
              { titulo: 'Cancelado em / por', valor: (l: any) => `${fmtDataHora(l.cancelado_em)} ${l.operador ?? ''}` },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="medicamentos">
          <TabelaSimples
            linhas={dados.medicamentos}
            vazio="Nenhum medicamento retirado na rede municipal."
            colunas={[
              { titulo: 'Data', valor: (l: any) => fmtDataHora(l.data_hora) },
              { titulo: 'Medicamento', valor: (l: any) => l.produto },
              { titulo: 'Qtd', valor: (l: any) => l.quantidade },
              { titulo: 'Unidade', valor: (l: any) => l.unidade },
              { titulo: 'Prescritor', valor: (l: any) => l.prescritor },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="continuo">
          <TabelaSimples
            linhas={dados.usoContinuo}
            vazio="Nenhum medicamento de uso contínuo."
            colunas={[
              { titulo: 'Medicamento', valor: (l: any) => l.descricao },
              { titulo: 'Posologia', valor: (l: any) => l.posologia },
              { titulo: 'Última receita', valor: (l: any) => fmtData(l.data_receita) },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="vacinas">
          <Group justify="flex-end" mb={4} display={pode('vacinacao:consultar', 'IMU') ? undefined : 'none'}>
            <Button size="compact-xs" variant="subtle" leftSection={<IconPrinter size={12} />} onClick={() => void abrirPdf(`/api/imunizacao/carteira/${pacienteId}/impressao`)}>
              Carteira de vacinação
            </Button>
          </Group>
          <Vacinas pacienteId={pacienteId} />
        </Tabs.Panel>
        <Tabs.Panel value="familia">
          <TabelaSimples
            linhas={dados.familia}
            vazio="Paciente sem família vinculada."
            colunas={[
              { titulo: 'Nome', valor: (l: any) => l.nome },
              { titulo: 'Parentesco', valor: (l: any) => l.parentesco },
              { titulo: 'Nascimento', valor: (l: any) => fmtData(l.nascimento) },
              { titulo: 'Situação', valor: (l: any) => l.situacao },
            ]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="sigiloso">
          <Sigilosos pacienteId={pacienteId} />
        </Tabs.Panel>
      </Paper>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Abas da tela de atendimento (atendimentos odontológicos)
// ---------------------------------------------------------------------------
// O atendimento odontológico é registrado na tela de atendimento, que acrescenta as abas abaixo às abas
// compartilhadas, também disponíveis ao cirurgião-dentista:
// - Exames: dados clínicos, justificativa acima do limite da SMS, alerta de exames já requisitados/agendados e de
//   absenteísmo, material a examinar, liberação para agendamento/regulação ao confirmar o atendimento, requisição
//   separada por grupo de procedimentos com carimbo e assinatura e exclusão com justificativa
//   (TR 1.2.34.43, 1.2.34.45 a 1.2.34.48, 1.2.34.64, 1.2.34.67, 1.2.34.69 a 1.2.34.72);
// - Prescrição: pesquisa por nome comercial ou princípio ativo, quantidade, posologia, tipo de uso, dose e uso
//   contínuo, receitas prontas para dispensação, alerta de alergia, medicamentos fora da REMUME com o tipo de
//   receita, renovação do uso contínuo e várias receitas separadas por tipo
//   (TR 1.2.34.51, 1.2.34.52, 1.2.34.52.1 a 1.2.34.52.5, 1.2.34.55, 1.2.34.57 a 1.2.34.60);
// - Atestados e documentos: atestado odontológico e declarações de comparecimento.
const ehOdontologico = (d: Completo) =>
  d.atendimento.tipo_unidade === 'ODONTOLOGIA' || /odonto/i.test(String(d.atendimento.fila ?? '')) || /odonto|dent/i.test(String(d.atendimento.especialidade ?? ''));

const encerradoDe = (d: Completo, encerrado: boolean) => encerrado || ['FINALIZADO', 'CANCELADO', 'NAO_ATENDIDO', 'EVADIDO'].includes(d.atendimento.situacao);

registrarAbaAtendimento({
  id: 'odonto-odontograma',
  titulo: 'Odontograma',
  visivel: ehOdontologico,
  render: ({ dados, encerrado }) => (
    <PainelOdontograma pacienteId={dados.atendimento.paciente_id} atendimento={encerradoDe(dados, encerrado) ? undefined : dados.atendimento} idadeAnos={dados.paciente?.idade?.anos} encerrado={encerradoDe(dados, encerrado)} />
  ),
});
registrarAbaAtendimento({
  id: 'odonto-fao',
  titulo: 'Saúde bucal (FAO)',
  visivel: ehOdontologico,
  render: ({ dados, encerrado, aoGravar }) => <PainelFao dados={dados} encerrado={encerradoDe(dados, encerrado)} aoGravar={aoGravar} />,
});
registrarAbaAtendimento({
  id: 'odonto-anamnese',
  titulo: 'Anamnese odontológica',
  visivel: ehOdontologico,
  render: ({ dados, encerrado }) => <PainelAnamnese pacienteId={dados.atendimento.paciente_id} podeEditar={!encerradoDe(dados, encerrado)} />,
});
registrarAbaAtendimento({
  id: 'odonto-prontuario',
  titulo: 'Prontuário odontológico',
  visivel: ehOdontologico,
  render: ({ dados }) => <PainelProntuario pacienteId={dados.atendimento.paciente_id} />,
});

// ---------------------------------------------------------------------------
// Fila odontológica (TR 1.2.34.2 a 1.2.34.11)
// ---------------------------------------------------------------------------
const FILTROS_FILA: [string, string][] = [
  ['aguardando', 'Aguardando'],
  ['nao_atendidos', 'Não atendidos'],
  ['atendidos', 'Atendidos'],
  ['nao_realizados', 'Não realizados'],
  ['todos', 'Todos'],
];
const LOCAL = 'odonto_local_chamada';

function TelaFilaOdonto() {
  useTituloJanela('Fila odontológica');
  const { eu } = useAuth();
  const { abrir } = useJanelas();
  const { dados: cfg } = useConfiguracao();
  const { dados: filas } = useCarregar<any[]>(() => api.get('/api/odontologia/filas'), [eu?.unidadeAtual]);
  const [filaId, setFilaId] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('aguardando');
  const [ordem, setOrdem] = useState<string>('data');
  const [nome, setNome] = useState('');
  const [linhas, setLinhas] = useState<any[]>([]);
  const [local, setLocal] = useState(() => {
    try {
      return localStorage.getItem(LOCAL) ?? '';
    } catch {
      return '';
    }
  });
  const [incluindo, setIncluindo] = useState<{ pacienteId: number | null; prioridade: string | null; queixa: string } | null>(null);
  const fila = filaId ?? (filas?.[0] ? String(filas[0].id) : null);
  const carregar = () => {
    if (!fila) return;
    api
      .get('/api/atendimentos/fila', { filaId: fila, filtro, ordem, nome })
      .then((r) => setLinhas(r.linhas))
      .catch(notificarErro);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => carregar(), [fila, filtro, ordem, nome]);
  // Atualização automática pelo intervalo parametrizado pela SMS (TR 1.2.34.8).
  useIntervalo(carregar, Math.max(5, cfg?.atualizacaoFilaSegundos ?? 30) * 1000, !!fila);
  const { paciente } = usePaciente(incluindo?.pacienteId ?? null, 'recepcao');

  async function incluir() {
    if (!incluindo?.pacienteId || !fila) return;
    try {
      await api.post('/api/odontologia/fila', { pacienteId: incluindo.pacienteId, filaId: Number(fila), prioridade: incluindo.prioridade ?? undefined, queixa: incluindo.queixa || undefined });
      notificarOk('Paciente incluído na fila odontológica.');
      setIncluindo(null);
      carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function chamar(l: any) {
    let destino = local;
    if (!destino) {
      const r = await pedirTexto('Chamar paciente', 'Consultório exibido no painel (ex.: Consultório odontológico 1)');
      if (!r) return;
      destino = r;
      setLocal(r);
      try {
        localStorage.setItem(LOCAL, r);
      } catch {
        /* armazenamento indisponível */
      }
    }
    try {
      await api.post(`/api/atendimentos/${l.id}/chamar`, { local: destino, tipo: 'CONSULTORIO', corFaixa: l.pre_classificacao ?? undefined });
      notificarOk(`${l.nome_social ?? l.nome} chamado(a) no painel.`);
      carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function atender(l: any) {
    try {
      if (!['EM_ATENDIMENTO'].includes(l.situacao)) await api.post(`/api/odontologia/fila/${l.id}/iniciar`);
      abrir(`/t/atendimento/${l.id}`, `Odontologia ${l.senha}`);
    } catch (e) {
      notificarErro(e);
    }
  }
  async function naoAtendido(l: any) {
    const motivo = await pedirTexto('Paciente não atendido', 'Justificativa do não atendimento', { obrigatorio: true });
    if (!motivo) return;
    try {
      await api.post(`/api/atendimentos/${l.id}/nao-atendido`, { motivo, evasao: /evas/i.test(motivo) });
      carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Fila odontológica</Title>
        <Group gap="xs">
          <TextInput size="xs" w={220} placeholder="Meu consultório (painel)" value={local} onChange={(e) => setLocal(e.currentTarget.value)} />
          <Button size="xs" leftSection={<IconUserPlus size={14} />} onClick={() => setIncluindo({ pacienteId: null, prioridade: null, queixa: '' })}>
            Incluir paciente
          </Button>
        </Group>
      </Group>
      {incluindo && (
        <Paper withBorder p="sm">
          <Stack gap="xs">
            {!incluindo.pacienteId ? (
              <BuscaPaciente aoSelecionar={(id) => setIncluindo({ ...incluindo, pacienteId: id })} />
            ) : (
              paciente && <CabecalhoPaciente paciente={paciente} compacto />
            )}
            <Text size="xs" fw={600}>
              Classificação da prioridade de atendimento
            </Text>
            <Group gap={6}>
              {RISCOS.map(([v, r]) => (
                <Button key={v} size="xs" color={COR_RISCO[v]} variant={incluindo.prioridade === v ? 'filled' : 'light'} onClick={() => setIncluindo({ ...incluindo, prioridade: v })}>
                  {r}
                </Button>
              ))}
            </Group>
            <TextInput size="xs" label="Queixa / motivo" value={incluindo.queixa} onChange={(e) => setIncluindo({ ...incluindo, queixa: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button size="xs" variant="default" onClick={() => setIncluindo(null)}>
                Cancelar
              </Button>
              <Button size="xs" disabled={!incluindo.pacienteId} onClick={() => void incluir()}>
                Incluir na fila
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
      <Paper withBorder p="sm">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Select size="xs" label="Fila" value={fila} onChange={setFilaId} data={(filas ?? []).map((f) => ({ value: String(f.id), label: f.nome }))} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <TextInput size="xs" label="Buscar pelo nome" value={nome} onChange={(e) => setNome(e.currentTarget.value)} />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <Select
              size="xs"
              label="Ordenar por"
              value={ordem}
              onChange={(v) => setOrdem(v ?? 'data')}
              data={[
                { value: 'data', label: 'Data/hora de chegada' },
                { value: 'hora', label: 'Horário agendado' },
                { value: 'idade', label: 'Idade' },
                { value: 'risco', label: 'Prioridade' },
              ]}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 3 }}>
            <Group justify="flex-end">
              <Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} onClick={carregar}>
                Atualizar ({cfg?.atualizacaoFilaSegundos ?? 30}s)
              </Button>
            </Group>
          </Grid.Col>
        </Grid>
        <SegmentedControl mt="xs" size="xs" value={filtro} onChange={setFiltro} data={FILTROS_FILA.map(([value, label]) => ({ value, label }))} />
      </Paper>
      <Table striped highlightOnHover fz="sm" withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Senha</Table.Th>
            <Table.Th>Paciente</Table.Th>
            <Table.Th>Idade</Table.Th>
            <Table.Th>Chegada</Table.Th>
            <Table.Th>Prioridade</Table.Th>
            <Table.Th>Situação</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {linhas.map((l) => (
            // Destaque de menores de 2 e maiores de 60 anos (TR 1.2.34.3).
            <Table.Tr key={l.id} fw={l.destaque ? 700 : undefined} bg={l.destaque ? 'yellow.0' : undefined}>
              <Table.Td>{l.senha}</Table.Td>
              <Table.Td>
                {l.nome_social ?? l.nome} {l.destaque && <Badge size="xs" color="orange">{l.idade < 2 ? '< 2 anos' : '> 60 anos'}</Badge>}
                {l.gestante && (
                  <Badge size="xs" color="pink" ml={4}>
                    Gestante
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{l.idade}</Table.Td>
              <Table.Td>
                {dayjs(l.entrada_em).format('DD/MM HH:mm')} {l.hora_agendada ? `(agendado ${l.hora_agendada.slice(0, 5)})` : ''}
              </Table.Td>
              <Table.Td>{l.pre_classificacao && <Badge color={COR_RISCO[l.pre_classificacao]}>{RISCOS.find(([v]) => v === l.pre_classificacao)?.[1]}</Badge>}</Table.Td>
              <Table.Td>
                <Situacao valor={l.situacao} />
              </Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap" justify="flex-end">
                  {['AGUARDANDO', 'CHAMADO'].includes(l.situacao) && (
                    <Tooltip label="Chamar no painel">
                      <Button size="compact-xs" variant="light" onClick={() => void chamar(l)}>
                        <IconSpeakerphone size={14} />
                      </Button>
                    </Tooltip>
                  )}
                  {['AGUARDANDO', 'CHAMADO', 'EM_ATENDIMENTO'].includes(l.situacao) && (
                    <Button size="compact-xs" leftSection={<IconPlayerPlay size={12} />} onClick={() => void atender(l)}>
                      Atender
                    </Button>
                  )}
                  {['AGUARDANDO', 'CHAMADO'].includes(l.situacao) && (
                    <Tooltip label="Registrar não atendimento">
                      <Button size="compact-xs" variant="subtle" color="red" onClick={() => void naoAtendido(l)}>
                        <IconUserX size={14} />
                      </Button>
                    </Tooltip>
                  )}
                  {l.situacao === 'FINALIZADO' && (
                    <Button size="compact-xs" variant="subtle" onClick={() => abrir(`/t/atendimento/${l.id}`, `Odontologia ${l.senha}`)}>
                      Abrir
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {!linhas.length && (
        <Text size="sm" c="dimmed">
          Nenhum paciente nesta situação.
        </Text>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Prontuário odontológico (fora do atendimento)
// ---------------------------------------------------------------------------
function TelaProntuarioOdonto({ pacienteId }: { pacienteId: number | null }) {
  useTituloJanela('Prontuário odontológico');
  const { abrir } = useJanelas();
  const { paciente, recarregar } = usePaciente(pacienteId, 'atendimento');
  const [aba, setAba] = useState<string | null>('odontograma');
  if (!pacienteId)
    return (
      <Stack p="md" gap="sm">
        <Title order={4}>Prontuário odontológico</Title>
        <BuscaPaciente permitirCadastro={false} aoSelecionar={(id) => abrir(`/t/odontologia/prontuario/${id}`, 'Prontuário odontológico')} />
      </Stack>
    );
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Prontuário odontológico</Title>
      {paciente && <CabecalhoPaciente paciente={paciente} aoAtualizar={recarregar} />}
      <Tabs value={aba} onChange={setAba} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="odontograma">Odontograma e plano de tratamento</Tabs.Tab>
          <Tabs.Tab value="anamnese">Anamnese odontológica</Tabs.Tab>
          <Tabs.Tab value="prontuario">Histórico</Tabs.Tab>
        </Tabs.List>
        <Paper p="sm" withBorder style={{ borderTop: 0 }}>
          <Tabs.Panel value="odontograma">
            <PainelOdontograma pacienteId={pacienteId} idadeAnos={paciente?.idade?.anos} />
          </Tabs.Panel>
          <Tabs.Panel value="anamnese">
            <PainelAnamnese pacienteId={pacienteId} podeEditar />
          </Tabs.Panel>
          <Tabs.Panel value="prontuario">
            <PainelProntuario pacienteId={pacienteId} />
          </Tabs.Panel>
        </Paper>
      </Tabs>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Configuração da impressão das receitas odontológicas (TR 1.2.34.1.1 a 1.2.34.1.7)
// ---------------------------------------------------------------------------
function TelaConfiguracaoReceita() {
  useTituloJanela('Impressão de receitas odontológicas');
  const { dados, recarregar } = useCarregar<Record<string, any>>(() => api.get('/api/odontologia/configuracao/receita'), []);
  const [c, setC] = useState<Record<string, any> | null>(null);
  useEffect(() => setC(dados), [dados]);
  if (!c) return null;
  const opcoes: [string, string][] = [
    ['cabecalho', 'Exibir o cabeçalho das receitas (desmarque para papel com cabeçalho pré-impresso)'],
    ['rodape', 'Exibir o rodapé das receitas (desmarque para papel com rodapé pré-impresso)'],
    ['logoSus', 'Exibir o logotipo do SUS'],
    ['duasViasMesmaPagina', 'Imprimir as duas vias da receita na mesma página'],
    ['duasViasSimples', 'Imprimir duas vias da receita simples'],
    ['duasViasOutros', 'Imprimir duas vias da receita de outros medicamentos e recomendações'],
  ];
  return (
    <Stack p="md" gap="sm" maw={720}>
      <Title order={4}>Impressão de receitas odontológicas</Title>
      <Alert color="blue" py={6}>
        Área restrita a administradores e técnicos. As receitas de controle especial são sempre impressas em duas vias.
      </Alert>
      {opcoes.map(([k, r]) => (
        <Switch key={k} label={r} checked={!!c[k]} onChange={(e) => setC({ ...c, [k]: e.currentTarget.checked })} />
      ))}
      <Textarea label="Texto do cabeçalho da receita" value={c.textoCabecalho ?? ''} onChange={(e) => setC({ ...c, textoCabecalho: e.currentTarget.value })} autosize minRows={2} />
      <Group justify="flex-end">
        <Button
          leftSection={<IconDeviceFloppy size={16} />}
          onClick={() =>
            api
              .put('/api/odontologia/configuracao/receita', c)
              .then(() => (notificarOk('Configuração gravada.'), recarregar()))
              .catch(notificarErro)
          }
        >
          Gravar
        </Button>
      </Group>
    </Stack>
  );
}

registrarTela({
  id: 'odontologia-fila',
  titulo: 'Fila odontológica',
  menu: 'Odontologia',
  padrao: '/t/odontologia/fila',
  permissao: 'odontologia:executar',
  modulo: 'ODO',
  palavras: ['dentista', 'fila', 'odontologia', 'chamar'],
  ordem: 1,
  render: () => <TelaFilaOdonto />,
});
registrarTela({
  id: 'odontologia-prontuario-busca',
  titulo: 'Prontuário odontológico',
  menu: 'Odontologia',
  padrao: '/t/odontologia/prontuario',
  permissao: 'odontologia:consultar',
  modulo: 'ODO',
  palavras: ['odontograma', 'dentista', 'plano de tratamento', 'cpo'],
  ordem: 2,
  render: () => <TelaProntuarioOdonto pacienteId={null} />,
});
registrarTela({
  id: 'odontologia-prontuario',
  titulo: 'Prontuário odontológico',
  padrao: '/t/odontologia/prontuario/:pacienteId',
  permissao: 'odontologia:consultar',
  modulo: 'ODO',
  render: ({ params }) => <TelaProntuarioOdonto pacienteId={Number(params.pacienteId)} />,
});
registrarTela({
  id: 'odontologia-configuracao-receita',
  titulo: 'Impressão de receitas odontológicas',
  menu: 'Odontologia/Configuração',
  padrao: '/t/odontologia/configuracao-receita',
  permissao: 'odontologia_receita:alterar',
  modulo: 'ODO',
  palavras: ['receita', 'impressão', 'duas vias', 'cabeçalho'],
  ordem: 50,
  render: () => <TelaConfiguracaoReceita />,
});
registrarMenuRelatorios('ODO', 'Odontologia', 'odo_marcacao:exportar');
