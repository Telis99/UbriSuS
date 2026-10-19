// Telas comuns aos módulos de diagnóstico por imagem (Radiologia - TR 1.2.45 e Ecografia - TR 1.2.50):
// recepção/lista de trabalho, execução, editor de laudo com modelos, imagens, assinatura, impressão,
// entrega de resultados e laudos do paciente para o profissional solicitante.
import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Card,
  Checkbox,
  FileButton,
  Grid,
  Group,
  Image,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import {
  IconCheck,
  IconDots,
  IconEye,
  IconFileUpload,
  IconMail,
  IconPhoto,
  IconPlus,
  IconPrinter,
  IconRefresh,
  IconSearch,
  IconSignature,
  IconTrash,
  IconWritingSign,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { api, urlArquivo } from "@/api";
import { useAuth } from "@/auth/Auth";
import {
  abrirPdf,
  comConfirmacao,
  fmtData,
  fmtDataHora,
  notificarErro,
  notificarOk,
  SelecaoRef,
  useCarregar,
} from "@/componentes/comum";
import {
  BuscaPaciente,
  CabecalhoPaciente,
  usePaciente,
} from "@/componentes/Paciente";
import { confirmar, pedirSenha, pedirTexto } from "@/genericos/dialogos";
import { registrarExtensaoFormulario } from "@/genericos/Formulario";
import { useJanelas, useTituloJanela } from "@/shell/Janelas";
import { registrarMenuRelatorios } from "../Relatorios";
import { registrarTela } from "../registro";

export interface ConfigTelaImagem {
  sigla: "RAD" | "ECO";
  esquema: "rad" | "eco";
  rota: "radiologia" | "ecografia";
  titulo: string;
  /** Nome do exame no plural, para títulos ("radiografias", "ultrassonografias"). */
  exames: string;
  radiologica: boolean;
  palavras: string[];
}

const SITUACAO: Record<string, [string, string]> = {
  AGENDADO: ["Agendado", "blue"],
  PRESENTE: ["Presente", "teal"],
  REALIZADO: ["Realizado", "green"],
  FALTOSO: ["Faltoso", "red"],
  CANCELADO: ["Cancelado", "gray"],
};
const LAUDO: Record<string, [string, string]> = {
  NAO_DIGITADO: ["Não digitado", "gray"],
  DIGITADO: ["Digitado", "yellow"],
  ASSINADO: ["Assinado", "green"],
  ANEXADO: ["Anexado", "teal"],
  IMPRESSO: ["Impresso", "blue"],
};
const ENTREGA: Record<string, [string, string]> = {
  PENDENTE: ["Aguardando retirada", "orange"],
  RETIRADO: ["Retirado", "green"],
  NAO_RETIRADO: ["Não retirado", "red"],
};
const LATERALIDADE = [
  { value: "NA", label: "Não se aplica" },
  { value: "DIREITO", label: "Direito" },
  { value: "ESQUERDO", label: "Esquerdo" },
  { value: "BILATERAL", label: "Bilateral" },
];
const FILMES = [
  { value: "18X24", label: "18 x 24 cm" },
  { value: "24X30", label: "24 x 30 cm" },
  { value: "30X40", label: "30 x 40 cm" },
  { value: "35X35", label: "35 x 35 cm" },
  { value: "35X43", label: "35 x 43 cm" },
  { value: "DIGITAL", label: "Digital (sem filme)" },
];

const Selo = ({
  mapa,
  valor,
}: {
  mapa: Record<string, [string, string]>;
  valor?: string | null;
}) =>
  valor ? (
    <Badge
      size="sm"
      variant="light"
      color={mapa[valor]?.[1] ?? "gray"}
      style={{ flexShrink: 0, overflow: "visible" }}
      styles={{ label: { overflow: "visible" } }}
    >
      {mapa[valor]?.[0] ?? valor}
    </Badge>
  ) : null;

const iso = (d: Date | null) => (d ? dayjs(d).format("YYYY-MM-DD") : undefined);
const liberado = (l?: string) =>
  ["ASSINADO", "ANEXADO", "IMPRESSO"].includes(l ?? "");

function useEstruturas(cfg: ConfigTelaImagem) {
  const [lista, setLista] = useState<string[]>([]);
  useEffect(() => {
    api
      .get(`/api/e/${cfg.esquema}_estrutura/opcoes`, { limite: 300 })
      .then((r: any[]) =>
        setLista([...new Set(r.map((o) => String(o.rotulo)))]),
      )
      .catch(() => {});
  }, [cfg.esquema]);
  return lista;
}

/** Imprime o resultado escolhendo o cabeçalho do prestador ou do solicitante (TR 1.2.45.7, 1.2.50.7). */
function BotoesImpressao({
  cfg,
  exame,
  aoImprimir,
}: {
  cfg: ConfigTelaImagem;
  exame: any;
  aoImprimir?: () => void;
}) {
  const base = `/api/${cfg.rota}/atendimentos/${exame.id}`;
  const pode = liberado(exame.situacao_laudo);
  const imprimir = (cab?: string) =>
    abrirPdf(`${base}/laudo.pdf${cab ? `?cabecalho=${cab}` : ""}`).then(() =>
      aoImprimir?.(),
    );
  return (
    <Group gap={4}>
      <Menu shadow="md" disabled={!pode}>
        <Menu.Target>
          <Tooltip
            label={
              pode
                ? "Imprimir resultado"
                : "A impressão é liberada somente após a assinatura"
            }
          >
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPrinter size={14} />}
              disabled={!pode}
            >
              Imprimir resultado
            </Button>
          </Tooltip>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => void imprimir()}>
            Cabeçalho padrão
          </Menu.Item>
          <Menu.Item onClick={() => void imprimir("PRESTADOR")}>
            Cabeçalho do prestador
          </Menu.Item>
          <Menu.Item onClick={() => void imprimir("SOLICITANTE")}>
            Cabeçalho do solicitante
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <Tooltip
        label={
          pode
            ? "Imprimir envelope"
            : "O envelope é liberado somente após a assinatura"
        }
      >
        <Button
          size="xs"
          variant="light"
          color="grape"
          leftSection={<IconMail size={14} />}
          disabled={!pode}
          onClick={() =>
            void abrirPdf(`${base}/envelope.pdf`).then(() => aoImprimir?.())
          }
        >
          Envelope
        </Button>
      </Tooltip>
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Execução do exame
// ---------------------------------------------------------------------------

function ModalExecucao({
  cfg,
  exame,
  aoFechar,
}: {
  cfg: ConfigTelaImagem;
  exame: any;
  aoFechar: (ok: boolean) => void;
}) {
  const { eu } = useAuth();
  const estruturas = useEstruturas(cfg);
  const [f, setF] = useState<Record<string, any>>({
    tecnicoId: exame.tecnico_id ?? eu?.profissionalId ?? null,
    equipamentoId: exame.equipamento_id ?? null,
    estrutura: exame.estrutura ?? "",
    lateralidade: exame.lateralidade ?? "NA",
    incidencias: exame.incidencias ?? exame.exame?.incidencias_padrao ?? "",
    filmesQuantidade:
      exame.filmes_quantidade ?? exame.exame?.filmes_padrao ?? null,
    filmeTamanho:
      exame.filme_tamanho ?? exame.exame?.filme_tamanho_padrao ?? null,
    filmesPerdidos: exame.filmes_perdidos ?? 0,
    contraste: exame.contraste ?? exame.exame?.contraste ?? false,
    contrasteDescricao: exame.contraste_descricao ?? "",
    observacao: exame.observacao_execucao ?? "",
  });
  const set = (k: string) => (v: any) => setF((x) => ({ ...x, [k]: v }));
  async function salvar() {
    try {
      const corpo = Object.fromEntries(
        Object.entries(f).filter(([, v]) => v !== "" && v !== undefined),
      );
      await api.post(
        `/api/${cfg.rota}/atendimentos/${exame.id}/execucao`,
        corpo,
      );
      notificarOk("Execução registrada e produção lançada para o faturamento.");
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal
      opened
      onClose={() => aoFechar(false)}
      title={`Execução - ${exame.procedimento} - ${exame.paciente}`}
      size="lg"
    >
      <Stack gap="xs">
        <Grid>
          <Grid.Col span={6}>
            <SelecaoRef
              entidade="profissional"
              rotulo="Profissional executante"
              valor={f.tecnicoId}
              aoMudar={set("tecnicoId")}
            />
          </Grid.Col>
          <Grid.Col span={6}>
            <SelecaoRef
              entidade={`${cfg.esquema}_equipamento`}
              rotulo="Sala / equipamento"
              valor={f.equipamentoId}
              aoMudar={set("equipamentoId")}
            />
          </Grid.Col>
          <Grid.Col span={8}>
            <Autocomplete
              label="Estrutura / órgão examinado"
              data={estruturas}
              value={f.estrutura}
              onChange={set("estrutura")}
            />
          </Grid.Col>
          <Grid.Col span={4}>
            <Select
              label="Lateralidade"
              data={LATERALIDADE}
              value={f.lateralidade}
              onChange={set("lateralidade")}
            />
          </Grid.Col>
          {cfg.radiologica && (
            <>
              <Grid.Col span={6}>
                <TextInput
                  label="Incidências realizadas"
                  value={f.incidencias}
                  onChange={(e) => set("incidencias")(e.currentTarget.value)}
                />
              </Grid.Col>
              <Grid.Col span={3}>
                <NumberInput
                  label="Filmes"
                  min={0}
                  value={f.filmesQuantidade ?? ""}
                  onChange={(v) =>
                    set("filmesQuantidade")(v === "" ? null : Number(v))
                  }
                />
              </Grid.Col>
              <Grid.Col span={3}>
                <NumberInput
                  label="Perdidos/repetições"
                  min={0}
                  value={f.filmesPerdidos ?? 0}
                  onChange={(v) => set("filmesPerdidos")(Number(v) || 0)}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <Select
                  label="Tamanho do filme"
                  data={FILMES}
                  value={f.filmeTamanho}
                  onChange={set("filmeTamanho")}
                  clearable
                />
              </Grid.Col>
              <Grid.Col span={3} pt={32}>
                <Switch
                  label="Contraste"
                  checked={!!f.contraste}
                  onChange={(e) => set("contraste")(e.currentTarget.checked)}
                />
              </Grid.Col>
              <Grid.Col span={5}>
                <TextInput
                  label="Contraste (produto/volume)"
                  disabled={!f.contraste}
                  value={f.contrasteDescricao}
                  onChange={(e) =>
                    set("contrasteDescricao")(e.currentTarget.value)
                  }
                />
              </Grid.Col>
            </>
          )}
          <Grid.Col span={12}>
            <Textarea
              label="Observações da execução"
              autosize
              minRows={2}
              value={f.observacao}
              onChange={(e) => set("observacao")(e.currentTarget.value)}
            />
          </Grid.Col>
        </Grid>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => aoFechar(false)}>
            Cancelar
          </Button>
          <Button
            leftSection={<IconCheck size={16} />}
            onClick={() => void salvar()}
          >
            Registrar execução
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Inclusão de exame sem agendamento
// ---------------------------------------------------------------------------

function ModalAvulso({
  cfg,
  aoFechar,
}: {
  cfg: ConfigTelaImagem;
  aoFechar: (id?: number) => void;
}) {
  const { eu } = useAuth();
  const estruturas = useEstruturas(cfg);
  const [pacienteId, setPacienteId] = useState<number | null>(null);
  const { paciente } = usePaciente(pacienteId);
  const [pendentes, setPendentes] = useState<any[]>([]);
  const [f, setF] = useState<Record<string, any>>({
    urgente: false,
    lateralidade: "NA",
    unidadeId: eu?.unidadeAtual ?? null,
  });
  const set = (k: string) => (v: any) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => {
    if (!pacienteId) return setPendentes([]);
    api
      .get(`/api/${cfg.rota}/requisicoes-pendentes`, { pacienteId })
      .then(setPendentes)
      .catch(notificarErro);
  }, [pacienteId, cfg.rota]);
  function usarRequisicao(r: any) {
    setF((x) => ({
      ...x,
      solicitacaoItemId: r.solicitacao_item_id,
      exameId: r.exame_id,
      estrutura: r.estrutura ?? x.estrutura,
      requisicao: r.numero,
      unidadeSolicitanteId: r.unidade_solicitante_id,
      profissionalSolicitanteId: r.profissional_solicitante_id,
    }));
  }
  async function salvar() {
    if (!pacienteId || !f.exameId)
      return notificarErro(new Error("Informe o paciente e o exame."));
    try {
      const dados: Record<string, any> = { ...f, pacienteId };
      const corpo = Object.fromEntries(
        Object.entries(dados).filter(
          ([, v]) => v !== "" && v !== null && v !== undefined,
        ),
      );
      const r = await comConfirmacao((confirmarAvisos) =>
        api.post(`/api/${cfg.rota}/atendimentos`, {
          ...corpo,
          confirmarAvisos,
        }),
      );
      if (r) {
        notificarOk(
          "Exame incluído na lista de trabalho com o paciente presente.",
        );
        aoFechar(r.id);
      }
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal
      opened
      onClose={() => aoFechar()}
      title="Incluir exame sem agendamento (urgência, demanda espontânea, requisição externa)"
      size="xl"
    >
      <Stack gap="xs">
        {!paciente ? (
          <BuscaPaciente aoSelecionar={setPacienteId} />
        ) : (
          <>
            <Group justify="space-between">
              <CabecalhoPaciente paciente={paciente} compacto />
              <Button
                size="xs"
                variant="subtle"
                onClick={() => setPacienteId(null)}
              >
                Trocar paciente
              </Button>
            </Group>
            {!!pendentes.length && (
              <Paper withBorder p="xs">
                <Text size="sm" fw={600}>
                  Requisições eletrônicas pendentes
                </Text>
                {pendentes.map((r) => (
                  <Group key={r.solicitacao_item_id} justify="space-between">
                    <Text size="sm">
                      {r.numero} · {fmtData(r.data)} · {r.exame}{" "}
                      {r.estrutura ? `(${r.estrutura})` : ""} ·{" "}
                      {r.solicitante ?? "-"} / {r.unidade_solicitante ?? "-"}
                    </Text>
                    <Button
                      size="compact-xs"
                      variant={
                        f.solicitacaoItemId === r.solicitacao_item_id
                          ? "filled"
                          : "light"
                      }
                      onClick={() => usarRequisicao(r)}
                    >
                      Usar
                    </Button>
                  </Group>
                ))}
              </Paper>
            )}
            <Grid>
              <Grid.Col span={8}>
                <SelecaoRef
                  entidade={`${cfg.esquema}_exame`}
                  rotulo="Exame"
                  obrigatorio
                  valor={f.exameId}
                  aoMudar={set("exameId")}
                  filtro={{ ativo: true }}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <SelecaoRef
                  entidade="unidade"
                  rotulo="Unidade prestadora"
                  valor={f.unidadeId}
                  aoMudar={set("unidadeId")}
                />
              </Grid.Col>
              <Grid.Col span={8}>
                <Autocomplete
                  label="Estrutura / órgão a examinar"
                  data={estruturas}
                  value={f.estrutura ?? ""}
                  onChange={set("estrutura")}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <Select
                  label="Lateralidade"
                  data={LATERALIDADE}
                  value={f.lateralidade}
                  onChange={set("lateralidade")}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <SelecaoRef
                  entidade="unidade"
                  rotulo="Unidade solicitante"
                  valor={f.unidadeSolicitanteId}
                  aoMudar={set("unidadeSolicitanteId")}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <SelecaoRef
                  entidade="profissional"
                  rotulo="Profissional solicitante"
                  valor={f.profissionalSolicitanteId}
                  aoMudar={set("profissionalSolicitanteId")}
                />
              </Grid.Col>
              <Grid.Col span={4}>
                <TextInput
                  label="Nº da requisição (papel)"
                  maxLength={20}
                  value={f.requisicao ?? ""}
                  onChange={(e) => set("requisicao")(e.currentTarget.value)}
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <SelecaoRef
                  entidade="convenio"
                  rotulo="Convênio"
                  valor={f.convenioId}
                  aoMudar={set("convenioId")}
                />
              </Grid.Col>
              <Grid.Col span={6} pt={32}>
                <Checkbox
                  label="Urgência"
                  checked={!!f.urgente}
                  onChange={(e) => set("urgente")(e.currentTarget.checked)}
                />
              </Grid.Col>
            </Grid>
            <Group justify="flex-end">
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => void salvar()}
              >
                Incluir na lista de trabalho
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Recepção e lista de trabalho
// ---------------------------------------------------------------------------

/**
 * Primeira tela: pacientes com exames agendados na data com unidade/profissional solicitante, requisição,
 * procedimento e estrutura; pesquisa por paciente, convênio e status do laudo; faltosos
 * (TR 1.2.45.8.1 a 1.2.45.8.4, 1.2.45.8.14, 1.2.50.8.1 a 1.2.50.8.4).
 */
function TelaRecepcao({ cfg }: { cfg: ConfigTelaImagem }) {
  useTituloJanela(`${cfg.titulo} - recepção`);
  const { abrir } = useJanelas();
  const { pode } = useAuth();
  const [f, setF] = useState<Record<string, any>>({
    de: new Date(),
    ate: new Date(),
    todasDatas: false,
    situacaoLaudo: [] as string[],
    situacao: [] as string[],
  });
  const [linhas, setLinhas] = useState<any[]>([]);
  const [painel, setPainel] = useState<any>(null);
  const [carregando, setCarregando] = useState(false);
  const [execucao, setExecucao] = useState<any>(null);
  const [avulso, setAvulso] = useState(false);
  const set = (k: string) => (v: any) => setF((x) => ({ ...x, [k]: v }));
  const recepcao = pode(`${cfg.esquema}_recepcao:executar`, cfg.sigla);

  async function pesquisar() {
    setCarregando(true);
    try {
      const q: Record<string, unknown> = {
        de: f.todasDatas ? undefined : iso(f.de),
        ate: f.todasDatas ? undefined : iso(f.ate ?? f.de),
        todasDatas: f.todasDatas ? "true" : undefined,
        pacienteId: f.pacienteId,
        nome: f.nome,
        prontuario: f.prontuario,
        cpf: f.cpf,
        cns: f.cns,
        requisicao: f.requisicao,
        procedimento: f.procedimento,
        unidadeSolicitanteId: f.unidadeSolicitanteId,
        convenioId: f.convenioId,
        situacaoLaudo: f.situacaoLaudo?.join(","),
        situacao: f.situacao?.join(","),
      };
      setLinhas(await api.get(`/api/${cfg.rota}/lista`, q));
      setPainel(await api.get(`/api/${cfg.rota}/painel`, { data: iso(f.de) }));
    } catch (e) {
      notificarErro(e);
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => {
    void pesquisar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acao = (fn: () => Promise<unknown>, msg: string) => async () => {
    try {
      await fn();
      notificarOk(msg);
      await pesquisar();
    } catch (e) {
      notificarErro(e);
    }
  };
  const base = `/api/${cfg.rota}/atendimentos`;
  const abrirLaudo = (l: any) =>
    abrir(`/t/${cfg.rota}/laudo/${l.id}`, `Laudo - ${l.paciente}`);
  async function abrirExecucao(l: any) {
    try {
      setExecucao(await api.get(`${base}/${l.id}`));
    } catch (e) {
      notificarErro(e);
    }
  }
  async function falta(l: any) {
    const motivo = await pedirTexto("Registrar falta", "Motivo / observação");
    if (motivo === null) return;
    await acao(
      () => api.post(`${base}/${l.id}/falta`, { motivo: motivo || undefined }),
      "Falta registrada.",
    )();
  }

  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>
          {cfg.titulo} - recepção e lista de trabalho de {cfg.exames}
        </Title>
        <Group gap="xs">
          {recepcao && (
            <Button
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() => setAvulso(true)}
            >
              Exame sem agendamento
            </Button>
          )}
          <Button
            size="xs"
            variant="light"
            onClick={() =>
              abrir(`/t/${cfg.rota}/entrega`, "Entrega de resultados")
            }
          >
            Entrega de resultados
          </Button>
        </Group>
      </Group>
      {painel && (
        <Group gap="xs">
          <Badge variant="light">Exames do dia: {painel.total}</Badge>
          <Badge variant="light" color="blue">
            Aguardando chegada: {painel.agendados}
          </Badge>
          <Badge variant="light" color="teal">
            Presentes: {painel.presentes}
          </Badge>
          <Badge variant="light" color="green">
            Realizados: {painel.realizados}
          </Badge>
          <Badge variant="light" color="red">
            Faltosos: {painel.faltosos}
          </Badge>
          <Badge variant="light" color="yellow">
            Laudos pendentes: {painel.laudos_pendentes}
          </Badge>
          <Badge variant="light" color="orange">
            Aguardando retirada: {painel.aguardando_retirada}
          </Badge>
        </Group>
      )}
      <Paper withBorder p="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void pesquisar();
          }}
        >
          <Grid gutter="xs">
            <Grid.Col span={{ base: 6, md: 2 }}>
              <DateInput
                label="Data inicial"
                valueFormat="DD/MM/YYYY"
                value={f.de}
                onChange={set("de")}
                disabled={f.todasDatas}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 2 }}>
              <DateInput
                label="Data final"
                valueFormat="DD/MM/YYYY"
                value={f.ate}
                onChange={set("ate")}
                disabled={f.todasDatas}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 1 }}>
              <NumberInput
                label="Código"
                min={1}
                hideControls
                value={f.pacienteId ?? ""}
                onChange={(v) =>
                  set("pacienteId")(v === "" ? undefined : Number(v))
                }
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <TextInput
                label="Nome do paciente"
                value={f.nome ?? ""}
                onChange={(e) => set("nome")(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 2 }}>
              <TextInput
                label="Prontuário"
                value={f.prontuario ?? ""}
                onChange={(e) => set("prontuario")(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 2 }}>
              <TextInput
                label="Nº da requisição"
                value={f.requisicao ?? ""}
                onChange={(e) => set("requisicao")(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 2 }}>
              <TextInput
                label="CPF"
                value={f.cpf ?? ""}
                onChange={(e) => set("cpf")(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, md: 2 }}>
              <TextInput
                label="Cartão Nacional de Saúde"
                value={f.cns ?? ""}
                onChange={(e) => set("cns")(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <TextInput
                label="Procedimento (nome ou código)"
                value={f.procedimento ?? ""}
                onChange={(e) => set("procedimento")(e.currentTarget.value)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <SelecaoRef
                entidade="unidade"
                rotulo="Unidade solicitante"
                valor={f.unidadeSolicitanteId}
                aoMudar={set("unidadeSolicitanteId")}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 2 }}>
              <SelecaoRef
                entidade="convenio"
                rotulo="Convênio"
                valor={f.convenioId}
                aoMudar={set("convenioId")}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <MultiSelect
                label="Status do laudo"
                data={Object.entries(LAUDO).map(([value, [label]]) => ({
                  value,
                  label,
                }))}
                value={f.situacaoLaudo}
                onChange={set("situacaoLaudo")}
                clearable
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }}>
              <MultiSelect
                label="Situação do exame"
                data={Object.entries(SITUACAO).map(([value, [label]]) => ({
                  value,
                  label,
                }))}
                value={f.situacao}
                onChange={set("situacao")}
                clearable
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }} pt={30}>
              <Checkbox
                label="Pesquisar em todas as datas"
                checked={f.todasDatas}
                onChange={(e) => set("todasDatas")(e.currentTarget.checked)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 3 }} pt={24}>
              <Group gap="xs" justify="flex-end">
                <Button
                  type="submit"
                  leftSection={<IconSearch size={16} />}
                  loading={carregando}
                >
                  Pesquisar
                </Button>
              </Group>
            </Grid.Col>
          </Grid>
        </form>
      </Paper>
      <Paper withBorder>
        <ScrollArea type="auto">
          <Table striped highlightOnHover fz="xs" miw={1300}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Data</Table.Th>
                <Table.Th>Paciente (código)</Table.Th>
                <Table.Th>Prontuário</Table.Th>
                <Table.Th>Unidade solicitante</Table.Th>
                <Table.Th>Profissional solicitante</Table.Th>
                <Table.Th>Requisição</Table.Th>
                <Table.Th>Procedimento</Table.Th>
                <Table.Th>Estrutura / órgão</Table.Th>
                <Table.Th>Convênio</Table.Th>
                <Table.Th>Situação / laudo / entrega</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {linhas.map((l) => (
                <Table.Tr
                  key={l.id}
                  style={{ cursor: "pointer" }}
                  onDoubleClick={() => abrirLaudo(l)}
                >
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {fmtData(l.data)} {l.hora ?? ""}
                    {l.urgente && (
                      <Badge ml={4} size="xs" color="red">
                        Urgente
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" fw={600}>
                      {l.nome_social
                        ? `${l.nome_social} (${l.paciente})`
                        : l.paciente}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Cód. {l.paciente_id}
                    </Text>
                  </Table.Td>
                  <Table.Td>{l.prontuario ?? "-"}</Table.Td>
                  <Table.Td>{l.unidade_solicitante ?? "-"}</Table.Td>
                  <Table.Td>{l.profissional_solicitante ?? "-"}</Table.Td>
                  <Table.Td>{l.requisicao ?? "-"}</Table.Td>
                  <Table.Td>
                    {l.procedimento_codigo} {l.procedimento}
                  </Table.Td>
                  <Table.Td>
                    {l.estrutura ?? "-"}
                    {l.lateralidade && l.lateralidade !== "NA"
                      ? ` (${l.lateralidade.toLowerCase()})`
                      : ""}
                  </Table.Td>
                  <Table.Td>{l.convenio ?? "SUS"}</Table.Td>
                  <Table.Td>
                    <Stack gap={2} align="flex-start">
                      <Selo mapa={SITUACAO} valor={l.situacao} />
                      <Selo mapa={LAUDO} valor={l.situacao_laudo} />
                      {liberado(l.situacao_laudo) && (
                        <Selo mapa={ENTREGA} valor={l.situacao_entrega} />
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Menu shadow="md" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" aria-label="Ações">
                          <IconDots size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {recepcao && l.situacao === "AGENDADO" && (
                          <Menu.Item
                            onClick={acao(
                              () => api.post(`${base}/${l.id}/chegada`),
                              "Chegada registrada.",
                            )}
                          >
                            Registrar chegada
                          </Menu.Item>
                        )}
                        {recepcao &&
                          ["AGENDADO", "PRESENTE", "REALIZADO"].includes(
                            l.situacao,
                          ) && (
                            <Menu.Item onClick={() => void abrirExecucao(l)}>
                              Registrar execução
                            </Menu.Item>
                          )}
                        <Menu.Item
                          leftSection={<IconWritingSign size={14} />}
                          onClick={() => abrirLaudo(l)}
                        >
                          Laudo / resultado
                        </Menu.Item>
                        {recepcao &&
                          ["AGENDADO", "PRESENTE"].includes(l.situacao) && (
                            <Menu.Item
                              color="red"
                              onClick={() => void falta(l)}
                            >
                              Registrar falta
                            </Menu.Item>
                          )}
                        {recepcao && l.situacao === "FALTOSO" && (
                          <Menu.Item
                            onClick={acao(
                              () => api.post(`${base}/${l.id}/desfazer-falta`),
                              "Falta desfeita.",
                            )}
                          >
                            Desfazer falta
                          </Menu.Item>
                        )}
                        <Menu.Divider />
                        <Menu.Item
                          disabled={!liberado(l.situacao_laudo)}
                          leftSection={<IconPrinter size={14} />}
                          onClick={() =>
                            void abrirPdf(`${base}/${l.id}/laudo.pdf`).then(
                              pesquisar,
                            )
                          }
                        >
                          Imprimir resultado
                        </Menu.Item>
                        <Menu.Item
                          disabled={!liberado(l.situacao_laudo)}
                          leftSection={<IconMail size={14} />}
                          onClick={() =>
                            void abrirPdf(`${base}/${l.id}/envelope.pdf`)
                          }
                        >
                          Imprimir envelope
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {!linhas.length && (
            <Text size="sm" c="dimmed" p="sm">
              Nenhum exame encontrado para os filtros informados.
            </Text>
          )}
        </ScrollArea>
      </Paper>
      <Text size="xs" c="dimmed">
        {linhas.length} exame(s). Duplo clique abre o laudo.
      </Text>
      {execucao && (
        <ModalExecucao
          cfg={cfg}
          exame={execucao}
          aoFechar={(ok) => {
            setExecucao(null);
            if (ok) void pesquisar();
          }}
        />
      )}
      {avulso && (
        <ModalAvulso
          cfg={cfg}
          aoFechar={(id) => {
            setAvulso(false);
            if (id) void pesquisar();
          }}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Laudo
// ---------------------------------------------------------------------------

/**
 * Registro do resultado com modelos personalizáveis e prévia, digitalizações de imagens, resultado anexado,
 * assinatura com assinatura gráfica, impressão do resultado e do envelope após a assinatura e retificação
 * (TR 1.2.45.3, 1.2.45.4, 1.2.45.8.5 a 1.2.45.8.11, 1.2.50.3, 1.2.50.4, 1.2.50.8.5 a 1.2.50.8.11).
 */
function TelaLaudo({ cfg, id }: { cfg: ConfigTelaImagem; id: number }) {
  const base = `/api/${cfg.rota}/atendimentos/${id}`;
  const { dados: t, recarregar } = useCarregar<any>(() => api.get(base), [id]);
  useTituloJanela(t ? `Laudo - ${t.paciente}` : "Laudo");
  const { paciente } = usePaciente(t?.paciente_id ?? null);
  const { dados: modelos } = useCarregar<any[]>(
    () => api.get(`${base}/modelos`),
    [id],
  );
  const [texto, setTexto] = useState("");
  const [conclusao, setConclusao] = useState("");
  const [modeloId, setModeloId] = useState<string | null>(null);
  const [alterado, setAlterado] = useState(false);
  const [execucao, setExecucao] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!t) return;
    setTexto(t.laudo_texto ?? "");
    setConclusao(t.conclusao ?? "");
    setModeloId(t.modelo_id ? String(t.modelo_id) : null);
    setAlterado(false);
  }, [t]);
  // Modelo padrão do exame aplicado automaticamente em laudo ainda não digitado.
  useEffect(() => {
    if (!t || !modelos?.length || t.laudo_texto || !t.pode?.editar) return;
    const padrao = modelos.find((m) => m.padrao && m.exame_id) ?? null;
    if (padrao) void aplicarModelo(String(padrao.id), true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t?.id, modelos]);

  async function aplicarModelo(mid: string | null, silencioso = false) {
    if (!mid) return;
    if (
      !silencioso &&
      texto.trim() &&
      !(await confirmar(
        "Aplicar modelo",
        "O texto atual será substituído pelo modelo. Continuar?",
      ))
    )
      return;
    try {
      const m = await api.get(`${base}/modelos/${mid}`);
      setTexto(m.texto ?? "");
      setConclusao(m.conclusao ?? "");
      setModeloId(mid);
      setAlterado(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  const previa = () =>
    api
      .arquivo(
        `/api/${cfg.rota}/modelos/previa`,
        { texto, conclusao, exameId: t?.exame_id },
        "abrir",
      )
      .catch(notificarErro);

  async function salvar() {
    try {
      await api.put(`${base}/laudo`, {
        texto,
        conclusao: conclusao || null,
        modeloId: modeloId ? Number(modeloId) : null,
      });
      notificarOk("Resultado gravado.");
      await recarregar();
      return true;
    } catch (e) {
      notificarErro(e);
      return false;
    }
  }
  async function assinar() {
    if (alterado && !(await salvar())) return;
    let senha: string | null = null;
    if (t.exigeSenha) {
      senha = await pedirSenha(
        "Confirme sua senha para assinar e liberar o laudo",
      );
      if (senha === null) return;
    } else if (
      !(await confirmar(
        "Assinar laudo",
        "Após a assinatura o resultado será liberado no prontuário e não poderá mais ser alterado. Confirmar?",
      ))
    )
      return;
    try {
      const r = await api.post(`${base}/assinar`, { senha });
      notificarOk(
        `Laudo assinado e liberado no prontuário (código de validação ${r.codigo}).`,
      );
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function retificar() {
    const motivo = await pedirTexto(
      "Retificar laudo",
      "Justificativa da retificação",
      { obrigatorio: true, longo: true },
    );
    if (!motivo) return;
    try {
      await api.post(`${base}/retificar`, { motivo });
      notificarOk(
        "Laudo reaberto para retificação; a versão anterior foi preservada.",
      );
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  async function enviarImagem(arquivo: File | null) {
    if (!arquivo) return;
    setEnviando(true);
    try {
      const a = await api.enviarArquivo(arquivo);
      await api.post(`${base}/imagens`, {
        arquivoId: a.id,
        descricao: arquivo.name.replace(/\.[^.]+$/, "").slice(0, 120),
        incluirLaudo: true,
      });
      notificarOk("Imagem digitalizada anexada ao resultado.");
      await recarregar();
    } catch (e) {
      notificarErro(e);
    } finally {
      setEnviando(false);
    }
  }
  async function removerImagem(imagemId: number) {
    if (
      !(await confirmar(
        "Remover imagem",
        "Remover a imagem do resultado?",
        "Remover",
        true,
      ))
    )
      return;
    await api
      .delete(`${base}/imagens/${imagemId}`)
      .then(recarregar)
      .catch(notificarErro);
  }
  async function anexarResultado(arquivo: File | null) {
    if (!arquivo) return;
    if (
      !(await confirmar(
        "Anexar resultado",
        "O arquivo será o resultado oficial do exame, liberado no prontuário, e o resultado não poderá mais ser alterado. Continuar?",
      ))
    )
      return;
    setEnviando(true);
    try {
      const a = await api.enviarArquivo(arquivo);
      await api.post(`${base}/resultado-anexo`, { arquivoId: a.id });
      notificarOk("Resultado anexado e liberado no prontuário.");
      await recarregar();
    } catch (e) {
      notificarErro(e);
    } finally {
      setEnviando(false);
    }
  }

  if (!t) return <Text p="md">Carregando...</Text>;
  const editavel = !!t.pode?.editar;
  return (
    <Stack p="md" gap="sm">
      {paciente && <CabecalhoPaciente paciente={paciente} compacto />}
      <Paper withBorder p="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={700}>
              {t.procedimento_codigo} {t.procedimento}
            </Text>
            <Text size="sm">
              {fmtData(t.data)} {t.hora ?? ""} · Estrutura/órgão:{" "}
              <b>{t.estrutura ?? "-"}</b>
              {t.lateralidade && t.lateralidade !== "NA"
                ? ` (${t.lateralidade.toLowerCase()})`
                : ""}{" "}
              · Requisição: {t.requisicao ?? "-"}
            </Text>
            <Text size="xs" c="dimmed">
              Solicitante: {t.profissional_solicitante ?? "-"} /{" "}
              {t.unidade_solicitante ?? "-"} · Prestador: {t.unidade ?? "-"} ·
              Executante: {t.executante ?? "-"}
              {t.equipamento ? ` · ${t.equipamento}` : ""}
              {cfg.radiologica && t.incidencias
                ? ` · Incidências: ${t.incidencias}`
                : ""}
              {cfg.radiologica && t.filmes_quantidade != null
                ? ` · Filmes: ${t.filmes_quantidade}`
                : ""}
              {cfg.radiologica && t.contraste ? " · Com contraste" : ""}
            </Text>
          </Stack>
          <Stack gap={4} align="flex-end">
            <Group gap={4}>
              <Selo mapa={SITUACAO} valor={t.situacao} />
              <Selo mapa={LAUDO} valor={t.situacao_laudo} />
              {liberado(t.situacao_laudo) && (
                <Selo mapa={ENTREGA} valor={t.situacao_entrega} />
              )}
            </Group>
            {t.assinado_em && (
              <Text size="xs" c="dimmed">
                Assinado por {t.assinante} em {fmtDataHora(t.assinado_em)}
                {t.codigo_validacao ? ` · código ${t.codigo_validacao}` : ""}
              </Text>
            )}
            {["AGENDADO", "PRESENTE", "REALIZADO"].includes(t.situacao) && (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => setExecucao(true)}
              >
                Dados da execução
              </Button>
            )}
          </Stack>
        </Group>
        {!!t.avisos?.length && (
          <Alert color="yellow" mt="xs" py={4}>
            {t.avisos.join(" ")}
          </Alert>
        )}
      </Paper>
      <Grid>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Paper withBorder p="sm">
            <Stack gap="xs">
              <Group align="flex-end" gap="xs">
                <Select
                  label="Modelo de resultado"
                  style={{ flex: 1 }}
                  searchable
                  disabled={!editavel}
                  data={(modelos ?? []).map((m) => ({
                    value: String(m.id),
                    label: `${m.nome}${m.exame_id ? "" : " (geral)"}${m.profissional_id ? " (pessoal)" : ""}`,
                  }))}
                  value={modeloId}
                  onChange={(v) => void aplicarModelo(v)}
                />
                <Button
                  variant="light"
                  leftSection={<IconEye size={16} />}
                  onClick={() => void previa()}
                >
                  Prévia
                </Button>
              </Group>
              <Textarea
                label="Resultado"
                autosize
                minRows={14}
                maxRows={30}
                readOnly={!editavel}
                value={texto}
                onChange={(e) => {
                  setTexto(e.currentTarget.value);
                  setAlterado(true);
                }}
                styles={{ input: { fontSize: 14, lineHeight: 1.5 } }}
              />
              <Textarea
                label="Conclusão / impressão diagnóstica"
                autosize
                minRows={2}
                readOnly={!editavel}
                value={conclusao}
                onChange={(e) => {
                  setConclusao(e.currentTarget.value);
                  setAlterado(true);
                }}
              />
              <Group justify="space-between">
                <Group gap="xs">
                  {editavel && (
                    <Button
                      onClick={() => void salvar()}
                      disabled={!alterado && t.situacao_laudo === "DIGITADO"}
                    >
                      Gravar resultado
                    </Button>
                  )}
                  {editavel && (
                    <Tooltip
                      label={
                        t.assinanteHabilitado
                          ? "Assinar com a assinatura gráfica e liberar no prontuário"
                          : "Seu usuário não está definido como assinante deste exame"
                      }
                    >
                      <Button
                        color="green"
                        leftSection={<IconSignature size={16} />}
                        disabled={!t.assinanteHabilitado || !texto.trim()}
                        onClick={() => void assinar()}
                      >
                        Assinar e liberar
                      </Button>
                    </Tooltip>
                  )}
                  {t.pode?.retificar && (
                    <Button
                      variant="light"
                      color="orange"
                      onClick={() => void retificar()}
                    >
                      Retificar
                    </Button>
                  )}
                </Group>
                <BotoesImpressao
                  cfg={cfg}
                  exame={t}
                  aoImprimir={() => void recarregar()}
                />
              </Group>
              {!editavel &&
                !liberado(t.situacao_laudo) &&
                t.situacao !== "REALIZADO" && (
                  <Text size="xs" c="dimmed">
                    O resultado pode ser registrado após a chegada do paciente.
                  </Text>
                )}
            </Stack>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="sm">
            <Card withBorder>
              <Group justify="space-between" mb="xs">
                <Text fw={600} size="sm">
                  Imagens digitalizadas
                </Text>
                {editavel && (
                  <FileButton
                    onChange={(f) => void enviarImagem(f)}
                    accept="image/png,image/jpeg"
                  >
                    {(props) => (
                      <Button
                        {...props}
                        size="compact-xs"
                        variant="light"
                        loading={enviando}
                        leftSection={<IconPhoto size={14} />}
                      >
                        Anexar imagem
                      </Button>
                    )}
                  </FileButton>
                )}
              </Group>
              {!t.imagens?.length ? (
                <Text size="xs" c="dimmed">
                  Nenhuma imagem anexada.
                </Text>
              ) : (
                <SimpleGrid cols={2} spacing="xs">
                  {t.imagens.map((i: any) => (
                    <Stack key={i.id} gap={2}>
                      <Image
                        src={urlArquivo(i.arquivo_id)}
                        radius="sm"
                        h={110}
                        fit="contain"
                        bg="dark"
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          window.open(urlArquivo(i.arquivo_id), "_blank")
                        }
                      />
                      <Group gap={2} justify="space-between" wrap="nowrap">
                        <Text size="xs" truncate>
                          {i.descricao ?? i.nome}
                        </Text>
                        {editavel && (
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            color="red"
                            onClick={() => void removerImagem(i.id)}
                            aria-label="Remover imagem"
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Stack>
                  ))}
                </SimpleGrid>
              )}
            </Card>
            <Card withBorder>
              <Text fw={600} size="sm" mb="xs">
                Resultado anexado
              </Text>
              {t.resultado_arquivo_id ? (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconEye size={14} />}
                  onClick={() => void abrirPdf(`${base}/resultado`)}
                >
                  Abrir resultado anexado ({fmtDataHora(t.anexado_em)})
                </Button>
              ) : editavel ? (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed">
                    Para resultados emitidos pelo equipamento ou por prestador
                    externo. O resultado anexado é liberado no prontuário e não
                    pode mais ser alterado.
                  </Text>
                  <FileButton
                    onChange={(f) => void anexarResultado(f)}
                    accept="application/pdf,image/png,image/jpeg"
                  >
                    {(props) => (
                      <Button
                        {...props}
                        size="xs"
                        variant="light"
                        loading={enviando}
                        leftSection={<IconFileUpload size={14} />}
                      >
                        Anexar arquivo do resultado
                      </Button>
                    )}
                  </FileButton>
                </Stack>
              ) : (
                <Text size="xs" c="dimmed">
                  Sem arquivo anexado.
                </Text>
              )}
            </Card>
            {!!t.retificacoes?.length && (
              <Card withBorder>
                <Text fw={600} size="sm" mb="xs">
                  Retificações
                </Text>
                {t.retificacoes.map((r: any, i: number) => (
                  <Text key={i} size="xs">
                    {fmtDataHora(r.em)} - {r.operador}: {r.motivo}
                  </Text>
                ))}
              </Card>
            )}
          </Stack>
        </Grid.Col>
      </Grid>
      {execucao && (
        <ModalExecucao
          cfg={cfg}
          exame={t}
          aoFechar={(ok) => {
            setExecucao(false);
            if (ok) void recarregar();
          }}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Entrega de resultados
// ---------------------------------------------------------------------------

function ModalRetirada({
  cfg,
  exame,
  aoFechar,
}: {
  cfg: ConfigTelaImagem;
  exame: any;
  aoFechar: (ok: boolean) => void;
}) {
  const [retiradoPor, setRetiradoPor] = useState(exame.paciente ?? "");
  const [documento, setDocumento] = useState("");
  async function salvar() {
    try {
      await api.post(`/api/${cfg.rota}/atendimentos/${exame.id}/entrega`, {
        retiradoPor,
        documento: documento || undefined,
      });
      notificarOk("Retirada do resultado registrada.");
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Modal
      opened
      onClose={() => aoFechar(false)}
      title={`Retirada do resultado - ${exame.procedimento}`}
    >
      <Stack gap="xs">
        <TextInput
          label="Retirado por"
          required
          value={retiradoPor}
          onChange={(e) => setRetiradoPor(e.currentTarget.value)}
        />
        <TextInput
          label="Documento de quem retirou"
          value={documento}
          onChange={(e) => setDocumento(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button
            onClick={() => void salvar()}
            disabled={retiradoPor.trim().length < 3}
          >
            Registrar retirada
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Controle de entrega: exames retirados e não retirados (TR 1.2.45.8.15, 1.2.50.8.14). */
function TelaEntrega({ cfg }: { cfg: ConfigTelaImagem }) {
  useTituloJanela(`${cfg.titulo} - entrega de resultados`);
  const [situacao, setSituacao] = useState<string[]>(["PENDENTE"]);
  const [nome, setNome] = useState("");
  const [dias, setDias] = useState<number | "">("");
  const [retirada, setRetirada] = useState<any>(null);
  const { dados, recarregar, carregando } = useCarregar<any[]>(
    () =>
      api.get(`/api/${cfg.rota}/entregas`, {
        situacao: situacao.join(",") || "PENDENTE",
        nome: nome || undefined,
        diasMinimos: dias === "" ? undefined : dias,
      }),
    [situacao.join(",")],
  );
  async function naoRetirado(l: any) {
    const motivo = await pedirTexto(
      "Exame não retirado",
      "Observação (contato realizado, motivo)",
    );
    if (motivo === null) return;
    try {
      await api.post(`/api/${cfg.rota}/atendimentos/${l.id}/nao-retirado`, {
        motivo: motivo || undefined,
      });
      notificarOk("Exame registrado como não retirado.");
      await recarregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  const linhas = dados ?? [];
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>{cfg.titulo} - entrega de resultados</Title>
      <Paper withBorder p="sm">
        <Group align="flex-end">
          <MultiSelect
            label="Situação"
            w={360}
            data={Object.entries(ENTREGA).map(([value, [label]]) => ({
              value,
              label,
            }))}
            value={situacao}
            onChange={setSituacao}
          />
          <TextInput
            label="Paciente"
            value={nome}
            onChange={(e) => setNome(e.currentTarget.value)}
          />
          <NumberInput
            label="Liberados há pelo menos (dias)"
            min={0}
            w={200}
            value={dias}
            onChange={(v) => setDias(v === "" ? "" : Number(v))}
          />
          <Button
            leftSection={<IconRefresh size={16} />}
            loading={carregando}
            onClick={() => void recarregar()}
          >
            Pesquisar
          </Button>
        </Group>
      </Paper>
      <Paper withBorder>
        <ScrollArea type="auto">
          <Table striped highlightOnHover fz="xs" miw={1100}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Data do exame</Table.Th>
                <Table.Th>Paciente</Table.Th>
                <Table.Th>Exame</Table.Th>
                <Table.Th>Unidade solicitante</Table.Th>
                <Table.Th>Liberado em</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th>Retirado por</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {linhas.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>{fmtData(l.data)}</Table.Td>
                  <Table.Td>{l.paciente}</Table.Td>
                  <Table.Td>{l.procedimento}</Table.Td>
                  <Table.Td>{l.unidade_solicitante ?? "-"}</Table.Td>
                  <Table.Td>{fmtDataHora(l.assinado_em)}</Table.Td>
                  <Table.Td>
                    <Selo mapa={ENTREGA} valor={l.situacao_entrega} />
                  </Table.Td>
                  <Table.Td>
                    {l.retirado_por
                      ? `${l.retirado_por} (${fmtDataHora(l.retirado_em)})`
                      : "-"}
                  </Table.Td>
                  <Table.Td style={{ minWidth: 300 }}>
                    <Stack gap={4}>
                      <Group gap={4} wrap="nowrap">
                        {l.situacao_entrega !== "RETIRADO" && (
                          <Button
                            size="compact-xs"
                            onClick={() => setRetirada(l)}
                          >
                            Retirado
                          </Button>
                        )}
                        {l.situacao_entrega === "PENDENTE" && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="red"
                            onClick={() => void naoRetirado(l)}
                          >
                            Não retirado
                          </Button>
                        )}
                      </Group>
                      <BotoesImpressao cfg={cfg} exame={l} />
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {!linhas.length && (
            <Text size="sm" c="dimmed" p="sm">
              Nenhum resultado nesta situação.
            </Text>
          )}
        </ScrollArea>
      </Paper>
      {retirada && (
        <ModalRetirada
          cfg={cfg}
          exame={retirada}
          aoFechar={(ok) => {
            setRetirada(null);
            if (ok) void recarregar();
          }}
        />
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Laudos do paciente (prontuário)
// ---------------------------------------------------------------------------

/** Laudos liberados no prontuário para o profissional solicitante (TR 1.2.45.8.12, 1.2.45.8.13, 1.2.50.8.12, 1.2.50.8.13). */
export function LaudosPaciente({
  cfg,
  pacienteId,
}: {
  cfg: ConfigTelaImagem;
  pacienteId: number;
}) {
  const { dados } = useCarregar<any[]>(
    () => api.get(`/api/${cfg.rota}/pacientes/${pacienteId}/laudos`),
    [pacienteId, cfg.rota],
  );
  const [aberto, setAberto] = useState<number | null>(null);
  if (!dados) return null;
  if (!dados.length)
    return (
      <Text size="sm" c="dimmed">
        Nenhum laudo de {cfg.titulo.toLowerCase()} liberado para o paciente.
      </Text>
    );
  return (
    <Stack gap="xs">
      {dados.map((l) => (
        <Paper key={l.id} withBorder p="xs">
          <Group justify="space-between">
            <Stack gap={0}>
              <Text size="sm" fw={600}>
                {fmtData(l.data)} · {l.exame}{" "}
                {l.estrutura ? `(${l.estrutura})` : ""}
              </Text>
              <Text size="xs" c="dimmed">
                {l.anexado
                  ? "Resultado anexado"
                  : `Assinado por ${l.assinante ?? "-"} ${l.conselho ?? ""} ${l.registro_conselho ?? ""}`}{" "}
                · {l.unidade ?? ""} · Requisição {l.requisicao ?? "-"} ·
                Solicitante {l.solicitante ?? "-"}
              </Text>
            </Stack>
            <Group gap={4}>
              {!l.anexado && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setAberto(aberto === l.id ? null : l.id)}
                >
                  {aberto === l.id ? "Ocultar texto" : "Ver texto"}
                </Button>
              )}
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<IconEye size={12} />}
                onClick={() =>
                  void abrirPdf(
                    `/api/${cfg.rota}/atendimentos/${l.id}/resultado`,
                  )
                }
              >
                Abrir laudo
              </Button>
            </Group>
          </Group>
          {aberto === l.id && (
            <Paper bg="gray.0" p="xs" mt={4}>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {l.laudo_texto}
              </Text>
              {l.conclusao && (
                <Text size="sm" fw={600} mt={4}>
                  Conclusão: {l.conclusao}
                </Text>
              )}
            </Paper>
          )}
        </Paper>
      ))}
    </Stack>
  );
}

function TelaLaudosPaciente({
  cfg,
  inicial,
}: {
  cfg: ConfigTelaImagem;
  inicial: number | null;
}) {
  useTituloJanela(`Laudos de ${cfg.titulo.toLowerCase()} do paciente`);
  const [pacienteId, setPacienteId] = useState<number | null>(inicial);
  const { paciente } = usePaciente(pacienteId, "prontuario");
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>
          Laudos de {cfg.titulo.toLowerCase()} do paciente
        </Title>
        {pacienteId && (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setPacienteId(null)}
          >
            Outro paciente
          </Button>
        )}
      </Group>
      {!pacienteId ? (
        <Paper withBorder p="sm">
          <BuscaPaciente
            aoSelecionar={setPacienteId}
            permitirCadastro={false}
          />
        </Paper>
      ) : (
        <>
          {paciente && <CabecalhoPaciente paciente={paciente} compacto />}
          <LaudosPaciente cfg={cfg} pacienteId={pacienteId} />
        </>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Registro das telas e extensões dos cadastros
// ---------------------------------------------------------------------------

function AcaoImportarSigtap({ cfg }: { cfg: ConfigTelaImagem }) {
  const [carregando, setCarregando] = useState(false);
  return (
    <Button
      variant="light"
      size="xs"
      loading={carregando}
      onClick={async () => {
        setCarregando(true);
        try {
          const r = await api.post(`/api/${cfg.rota}/exames/importar-sigtap`);
          notificarOk(`${r.importados} exame(s) importado(s) do SIGTAP.`);
        } catch (e) {
          notificarErro(e);
        } finally {
          setCarregando(false);
        }
      }}
    >
      Importar exames do SIGTAP
    </Button>
  );
}

function AbrirLaudo({ cfg, id }: { cfg: ConfigTelaImagem; id: number }) {
  const { abrir } = useJanelas();
  return (
    <Button
      size="xs"
      variant="light"
      leftSection={<IconWritingSign size={14} />}
      onClick={() => abrir(`/t/${cfg.rota}/laudo/${id}`, "Laudo")}
    >
      Abrir laudo
    </Button>
  );
}

export function registrarTelasImagem(cfg: ConfigTelaImagem) {
  const consultar = `${cfg.esquema}_atendimento:consultar`;
  registrarTela({
    id: `${cfg.rota}-recepcao`,
    titulo: "Recepção e lista de trabalho",
    menu: cfg.titulo,
    padrao: `/t/${cfg.rota}/recepcao`,
    permissao: consultar,
    modulo: cfg.sigla,
    palavras: [
      ...cfg.palavras,
      "agenda de exames",
      "worklist",
      "recepção",
      "faltosos",
    ],
    ordem: 1,
    render: () => <TelaRecepcao cfg={cfg} />,
  });
  registrarTela({
    id: `${cfg.rota}-laudo`,
    titulo: "Laudo",
    padrao: `/t/${cfg.rota}/laudo/:id`,
    permissao: consultar,
    modulo: cfg.sigla,
    render: ({ params }) => <TelaLaudo cfg={cfg} id={Number(params.id)} />,
  });
  registrarTela({
    id: `${cfg.rota}-entrega`,
    titulo: "Entrega de resultados",
    menu: cfg.titulo,
    padrao: `/t/${cfg.rota}/entrega`,
    permissao: consultar,
    modulo: cfg.sigla,
    palavras: [
      ...cfg.palavras,
      "retirada",
      "não retirados",
      "entrega de laudo",
    ],
    ordem: 2,
    render: () => <TelaEntrega cfg={cfg} />,
  });
  registrarTela({
    id: `${cfg.rota}-laudos-paciente`,
    titulo: "Laudos do paciente",
    menu: cfg.titulo,
    padrao: `/t/${cfg.rota}/laudos-paciente`,
    permissao: consultar,
    modulo: cfg.sigla,
    palavras: [...cfg.palavras, "prontuário", "resultado de exame", "laudo"],
    ordem: 3,
    render: ({ query }) => (
      <TelaLaudosPaciente
        cfg={cfg}
        inicial={query.get("paciente") ? Number(query.get("paciente")) : null}
      />
    ),
  });
  registrarMenuRelatorios(
    cfg.sigla,
    cfg.titulo,
    `${cfg.esquema}_atendimento:exportar`,
  );
  // Prévia do modelo de resultado no cadastro (TR 1.2.45.4, 1.2.50.4).
  registrarExtensaoFormulario(`${cfg.esquema}_modelo_laudo`, {
    acoes: (r) =>
      r?.id ? (
        <Button
          size="xs"
          variant="light"
          leftSection={<IconEye size={14} />}
          onClick={() =>
            void abrirPdf(`/api/${cfg.rota}/modelos/${r.id}/previa`)
          }
        >
          Visualizar prévia
        </Button>
      ) : null,
  });
  registrarExtensaoFormulario(`${cfg.esquema}_exame`, {
    acoes: () => <AcaoImportarSigtap cfg={cfg} />,
  });
  registrarExtensaoFormulario(`${cfg.esquema}_atendimento`, {
    acoes: (r) => (r?.id ? <AbrirLaudo cfg={cfg} id={r.id} /> : null),
  });
}
