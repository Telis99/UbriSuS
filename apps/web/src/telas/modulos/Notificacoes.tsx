// Gerenciador de notificações aos pacientes e envio em bloco agendado
// (TR 1.2.2.11, 1.1.2.1.58, 1.1.2.1.60, 1.1.2.1.67).
import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Grid,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { DateInput, DateTimePicker } from "@mantine/dates";
import { IconRefresh, IconSend, IconUsers, IconX } from "@tabler/icons-react";
import dayjs from "dayjs";
import { api } from "@/api";
import { useTituloJanela } from "@/shell/Janelas";
import {
  fmtDataHora,
  notificarErro,
  notificarOk,
  SelecaoRef,
  useCarregar,
} from "@/componentes/comum";
import {
  MEIOS_MENSAGEM,
  useModelosMensagem,
} from "@/componentes/MensagemPaciente";
import { confirmar } from "@/genericos/dialogos";
import { registrarMenuRelatorios } from "../Relatorios";
import { registrarTela } from "../registro";

const SITUACOES: Record<string, [string, string]> = {
  agendada: ["Agendada", "violet"],
  aguardando: ["Aguardando envio", "gray"],
  enviando: ["Enviando", "blue"],
  enviada: ["Enviada", "blue"],
  recebida: ["Recebida", "green"],
  falha: ["Falha de envio", "red"],
  cancelada: ["Cancelada", "dark"],
};
const MEIO: Record<string, string> = {
  sms: "SMS",
  email: "E-mail",
  push: "Aplicativo",
};
const EVENTOS = [
  ["agendamento", "Agendamento"],
  ["lista_espera", "Lista de espera"],
  ["transferencia", "Transferência"],
  ["cancelamento", "Cancelamento"],
  ["lembrete", "Lembrete"],
  ["avulsa", "Avulsa"],
  ["campanha", "Envio em bloco"],
].map(([value, label]) => ({ value, label }));
const dt = (d: Date | null) => (d ? dayjs(d).format("YYYY-MM-DD") : null);

function SituacaoMsg({ valor }: { valor: string }) {
  const [rotulo, cor] = SITUACOES[valor] ?? [valor, "gray"];
  return (
    <Badge color={cor} variant="light">
      {rotulo}
    </Badge>
  );
}

function TelaGerenciador() {
  useTituloJanela("Gerenciador de notificações");
  const [filtros, setFiltros] = useState<Record<string, any>>({
    de: dayjs().subtract(7, "day").toDate(),
    ate: new Date(),
  });
  const [detalhe, setDetalhe] = useState<any>(null);
  const f = (k: string) => (v: any) => setFiltros((x) => ({ ...x, [k]: v }));
  const parametros = {
    ...filtros,
    de: dt(filtros.de),
    ate: dt(filtros.ate),
    comResposta: filtros.comResposta ? "true" : undefined,
  };
  const { dados, carregando, recarregar } = useCarregar(
    () => api.get<any[]>("/api/mensagens-pacientes", parametros),
    [JSON.stringify(parametros)],
  );
  const resumo = useCarregar(
    () =>
      api.get<{ situacao: string; total: number }[]>(
        "/api/mensagens-pacientes/resumo",
      ),
    [dados],
  );
  const acao = (id: number, a: "reenviar" | "cancelar") =>
    api
      .post(`/api/mensagens-pacientes/${id}/${a}`)
      .then(
        () => (
          notificarOk(
            a === "reenviar"
              ? "Mensagem devolvida à fila de envio."
              : "Envio cancelado.",
          ),
          recarregar()
        ),
      )
      .catch(notificarErro);
  return (
    <Stack p="md" gap="sm">
      <Group justify="space-between">
        <Title order={4}>Gerenciador de notificações aos pacientes</Title>
        <Group gap={6}>
          {(resumo.dados ?? []).map((r) => (
            <Badge
              key={r.situacao}
              color={SITUACOES[r.situacao]?.[1] ?? "gray"}
              variant="outline"
            >
              {SITUACOES[r.situacao]?.[0] ?? r.situacao}: {r.total}
            </Badge>
          ))}
          <Text size="xs" c="dimmed">
            (últimos 30 dias)
          </Text>
        </Group>
      </Group>
      <Paper withBorder p="sm">
        <Grid gutter="xs" align="flex-end">
          <Grid.Col span={{ base: 6, md: 2 }}>
            <DateInput
              label="De"
              value={filtros.de}
              onChange={f("de")}
              valueFormat="DD/MM/YYYY"
              clearable
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <DateInput
              label="Até"
              value={filtros.ate}
              onChange={f("ate")}
              valueFormat="DD/MM/YYYY"
              clearable
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Select
              label="Situação"
              clearable
              value={filtros.situacao ?? null}
              onChange={f("situacao")}
              data={Object.entries(SITUACOES).map(([value, [label]]) => ({
                value,
                label,
              }))}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Select
              label="Meio"
              clearable
              value={filtros.meio ?? null}
              onChange={f("meio")}
              data={Object.entries(MEIO).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <Select
              label="Evento"
              clearable
              value={filtros.evento ?? null}
              onChange={f("evento")}
              data={EVENTOS}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 6, md: 2 }}>
            <TextInput
              label="Busca"
              placeholder="Paciente, destinatário ou texto"
              value={filtros.busca ?? ""}
              onChange={(e) => f("busca")(e.currentTarget.value || undefined)}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <SelecaoRef
              entidade="paciente"
              rotulo="Paciente"
              valor={filtros.pacienteId}
              aoMudar={f("pacienteId")}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Switch
              label="Somente com resposta do paciente"
              checked={!!filtros.comResposta}
              onChange={(e) => f("comResposta")(e.currentTarget.checked)}
              mb={8}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: "content" }}>
            <Button
              leftSection={<IconRefresh size={16} />}
              variant="light"
              onClick={recarregar}
              loading={carregando}
            >
              Atualizar
            </Button>
          </Grid.Col>
        </Grid>
      </Paper>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={1250}>
          <Table striped highlightOnHover fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Gerada em</Table.Th>
                <Table.Th>Processada em</Table.Th>
                <Table.Th>Paciente</Table.Th>
                <Table.Th>Meio</Table.Th>
                <Table.Th>Destinatário</Table.Th>
                <Table.Th>Assunto / texto</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(dados ?? []).map((m) => (
                <Table.Tr
                  key={m.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => setDetalhe(m)}
                >
                  <Table.Td>{m.id}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {fmtDataHora(m.gerada_em)}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {m.processada_em ? (
                      fmtDataHora(m.processada_em)
                    ) : m.agendada_para ? (
                      <Text size="xs">
                        agendada p/ {fmtDataHora(m.agendada_para)}
                      </Text>
                    ) : (
                      ""
                    )}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{m.paciente}</Table.Td>
                  <Table.Td>{MEIO[m.meio]}</Table.Td>
                  <Table.Td>
                    {m.meio === "push" ? "Aplicativo" : m.destinatario}
                  </Table.Td>
                  <Table.Td maw={360}>
                    <Text size="sm" truncate>
                      {m.assunto ? <b>{m.assunto}: </b> : null}
                      {m.texto}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    <Group gap={4} wrap="nowrap">
                      <SituacaoMsg valor={m.situacao} />
                      {!!m.respostas?.length && (
                        <Badge color="teal">
                          {m.respostas.length} resposta(s)
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td onClick={(e) => e.stopPropagation()}>
                    {["falha", "cancelada"].includes(m.situacao) && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={() => acao(m.id, "reenviar")}
                      >
                        Reenviar
                      </Button>
                    )}
                    {["agendada", "aguardando"].includes(m.situacao) && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        onClick={() => acao(m.id, "cancelar")}
                      >
                        Cancelar
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        {dados && !dados.length && (
          <Text c="dimmed" ta="center" p="md">
            Nenhuma notificação no período.
          </Text>
        )}
      </Paper>
      {detalhe && (
        <Modal
          opened
          onClose={() => setDetalhe(null)}
          title={`Notificação ${detalhe.id}`}
          size="lg"
        >
          <Stack gap={6}>
            <Group gap="xs">
              <SituacaoMsg valor={detalhe.situacao} />
              <Badge variant="outline">{MEIO[detalhe.meio]}</Badge>
              <Badge variant="outline">
                {EVENTOS.find((e) => e.value === detalhe.evento)?.label ??
                  detalhe.evento}
              </Badge>
            </Group>
            <Text size="sm">
              <b>Paciente:</b> {detalhe.paciente} · <b>Destinatário:</b>{" "}
              {detalhe.destinatario}
            </Text>
            <Text size="sm">
              <b>Gerada:</b> {fmtDataHora(detalhe.gerada_em)}{" "}
              {detalhe.operador ? `por ${detalhe.operador}` : "(automática)"} ·{" "}
              <b>Processada:</b> {fmtDataHora(detalhe.processada_em) || "-"}
              {detalhe.agendada_para &&
                ` · Agendada para ${fmtDataHora(detalhe.agendada_para)}`}
            </Text>
            {detalhe.erro && <Alert color="red">{detalhe.erro}</Alert>}
            {detalhe.assunto && (
              <Text size="sm">
                <b>Assunto:</b> {detalhe.assunto}
              </Text>
            )}
            <Paper withBorder p="xs" bg="gray.0">
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {detalhe.texto}
              </Text>
            </Paper>
            <Text fw={600} size="sm" mt="xs">
              Respostas do paciente
            </Text>
            {(detalhe.respostas ?? []).map((r: any, i: number) => (
              <Paper key={i} withBorder p="xs">
                <Text size="xs" c="dimmed">
                  {fmtDataHora(r.recebida_em)}
                </Text>
                <Text size="sm">{r.texto}</Text>
              </Paper>
            ))}
            {!detalhe.respostas?.length && (
              <Text size="sm" c="dimmed">
                Nenhuma resposta recebida.
              </Text>
            )}
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}

interface Criterios {
  unidadeReferenciaId?: number | null;
  bairroId?: number | null;
  microarea?: string | null;
  sexo?: "M" | "F" | null;
  idadeMinima?: number | null;
  idadeMaxima?: number | null;
  condicoes?: string[];
  agendaDe?: string | null;
  agendaAte?: string | null;
  agendaUnidadeId?: number | null;
  agendaProfissionalId?: number | null;
  agendaEspecialidadeId?: number | null;
}

function TelaEnvioBloco() {
  useTituloJanela("Notificações em massa");
  const modelos = useModelosMensagem();
  const [titulo, setTitulo] = useState("");
  const [meios, setMeios] = useState<string[]>(["sms", "push"]);
  const [assunto, setAssunto] = useState("");
  const [texto, setTexto] = useState("");
  const [quando, setQuando] = useState<Date | null>(null);
  const [cr, setCr] = useState<Criterios>({});
  const [agenda, setAgenda] = useState(false);
  const [previa, setPrevia] = useState<any>(null);
  const [enviando, setEnviando] = useState(false);
  const [condicoes, setCondicoes] = useState<
    { value: string; label: string }[]
  >([]);
  const historico = useCarregar(
    () => api.get<any[]>("/api/mensagens-pacientes/campanhas"),
    [],
  );
  useEffect(() => {
    api
      .get("/api/meta/paciente")
      .then((m: any) =>
        setCondicoes(
          (
            m.campos.find((c: any) => c.nome === "condicoes_saude")?.opcoes ??
            []
          ).map(([value, label]: [string, string]) => ({ value, label })),
        ),
      )
      .catch(() => {});
  }, []);
  const c = (k: keyof Criterios) => (v: any) => (
    setCr((x) => ({ ...x, [k]: v ?? null })),
    setPrevia(null)
  );
  const criterios = () => {
    const x: Criterios = { ...cr };
    if (!agenda)
      for (const k of [
        "agendaDe",
        "agendaAte",
        "agendaUnidadeId",
        "agendaProfissionalId",
        "agendaEspecialidadeId",
      ] as const)
        delete x[k];
    return Object.fromEntries(
      Object.entries(x).filter(
        ([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length),
      ),
    );
  };
  const verDestinatarios = () =>
    api
      .post("/api/mensagens-pacientes/destinatarios", {
        criterios: criterios(),
        meios,
      })
      .then(setPrevia)
      .catch(notificarErro);
  const enviar = async () => {
    if (!previa)
      return notificarErro(
        new Error("Confira os destinatários antes de enviar."),
      );
    const ok = await confirmar(
      "Envio em bloco",
      quando
        ? `Agendar o envio para ${previa.total} paciente(s) em ${dayjs(quando).format("DD/MM/YYYY HH:mm")}?`
        : `Enviar agora a mensagem para ${previa.total} paciente(s)?`,
    );
    if (!ok) return;
    setEnviando(true);
    try {
      const r = await api.post<{ destinatarios: number; mensagens: number }>(
        "/api/mensagens-pacientes/campanhas",
        {
          titulo,
          meios,
          assunto: assunto || null,
          texto,
          criterios: criterios(),
          agendadaPara: quando?.toISOString() ?? null,
        },
      );
      notificarOk(
        `${r.mensagens} mensagem(ns) ${quando ? "agendada(s)" : "enviada(s) para a fila"} para ${r.destinatarios} paciente(s).`,
      );
      setPrevia(null);
      historico.recarregar();
    } catch (e) {
      notificarErro(e);
    } finally {
      setEnviando(false);
    }
  };
  const cancelar = async (id: number) => {
    if (
      !(await confirmar(
        "Cancelar envio",
        "Cancelar as mensagens ainda não enviadas deste lote?",
        "Cancelar envio",
        true,
      ))
    )
      return;
    api
      .post(`/api/mensagens-pacientes/campanhas/${id}/cancelar`)
      .then(
        (r: any) => (
          notificarOk(`${r.canceladas} mensagem(ns) cancelada(s).`),
          historico.recarregar()
        ),
      )
      .catch(notificarErro);
  };
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Notificações em massa aos pacientes</Title>
      <Grid gutter="sm">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper withBorder p="sm">
            <Stack gap="xs">
              <Text fw={600}>Mensagem</Text>
              <TextInput
                label="Título do envio"
                required
                value={titulo}
                onChange={(e) => setTitulo(e.currentTarget.value)}
                maxLength={120}
                placeholder="Ex.: Campanha de vacinação contra a gripe"
              />
              <Select
                label="Modelo"
                placeholder="Opcional"
                clearable
                data={modelos.map((m) => ({
                  value: String(m.id),
                  label: m.nome,
                }))}
                onChange={(v) => {
                  const m = modelos.find((x) => String(x.id) === v);
                  if (m) (setAssunto(m.assunto ?? ""), setTexto(m.texto));
                }}
              />
              <Checkbox.Group
                label="Meios de envio"
                value={meios}
                onChange={(v) => (setMeios(v), setPrevia(null))}
              >
                <Group mt={4}>
                  {MEIOS_MENSAGEM.map((m) => (
                    <Checkbox key={m.value} value={m.value} label={m.label} />
                  ))}
                </Group>
              </Checkbox.Group>
              <TextInput
                label="Assunto (e-mail e aplicativo)"
                value={assunto}
                onChange={(e) => setAssunto(e.currentTarget.value)}
                maxLength={150}
              />
              <Textarea
                label="Texto"
                required
                autosize
                minRows={5}
                value={texto}
                onChange={(e) => setTexto(e.currentTarget.value)}
                maxLength={meios.includes("sms") ? 640 : 4000}
                description={`${texto.length} caracteres${meios.includes("sms") ? ` · ${Math.max(1, Math.ceil(texto.length / 160))} SMS por paciente` : ""} · variáveis: {nome}, {primeiro_nome}, {unidade}, {data_agendamento}, {hora}, {profissional}`}
              />
              <DateTimePicker
                label="Agendar envio para"
                placeholder="Enviar imediatamente"
                value={quando}
                onChange={setQuando}
                clearable
                valueFormat="DD/MM/YYYY HH:mm"
                minDate={new Date()}
              />
            </Stack>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Paper withBorder p="sm">
            <Stack gap="xs">
              <Text fw={600}>Destinatários (pacientes ativos)</Text>
              <SimpleGrid cols={2} spacing="xs">
                <SelecaoRef
                  entidade="unidade"
                  rotulo="Unidade de referência"
                  valor={cr.unidadeReferenciaId}
                  aoMudar={c("unidadeReferenciaId")}
                />
                <SelecaoRef
                  entidade="bairro"
                  rotulo="Bairro"
                  valor={cr.bairroId}
                  aoMudar={c("bairroId")}
                />
                <TextInput
                  label="Microárea"
                  value={cr.microarea ?? ""}
                  onChange={(e) =>
                    c("microarea")(e.currentTarget.value || null)
                  }
                />
                <Select
                  label="Sexo"
                  clearable
                  value={cr.sexo ?? null}
                  onChange={c("sexo")}
                  data={[
                    { value: "F", label: "Feminino" },
                    { value: "M", label: "Masculino" },
                  ]}
                />
                <NumberInput
                  label="Idade mínima"
                  min={0}
                  max={150}
                  value={cr.idadeMinima ?? ""}
                  onChange={(v) =>
                    c("idadeMinima")(v === "" ? null : Number(v))
                  }
                />
                <NumberInput
                  label="Idade máxima"
                  min={0}
                  max={150}
                  value={cr.idadeMaxima ?? ""}
                  onChange={(v) =>
                    c("idadeMaxima")(v === "" ? null : Number(v))
                  }
                />
              </SimpleGrid>
              <MultiSelect
                label="Doenças e agravantes (qualquer uma)"
                data={condicoes}
                value={cr.condicoes ?? []}
                onChange={c("condicoes")}
                searchable
                clearable
              />
              <Switch
                label="Somente pacientes com consulta agendada"
                checked={agenda}
                onChange={(e) => (
                  setAgenda(e.currentTarget.checked),
                  setPrevia(null)
                )}
              />
              {agenda && (
                <SimpleGrid cols={2} spacing="xs">
                  <DateInput
                    label="Agendados de"
                    value={cr.agendaDe ? dayjs(cr.agendaDe).toDate() : null}
                    onChange={(d) => c("agendaDe")(dt(d))}
                    valueFormat="DD/MM/YYYY"
                    clearable
                  />
                  <DateInput
                    label="Até"
                    value={cr.agendaAte ? dayjs(cr.agendaAte).toDate() : null}
                    onChange={(d) => c("agendaAte")(dt(d))}
                    valueFormat="DD/MM/YYYY"
                    clearable
                  />
                  <SelecaoRef
                    entidade="unidade"
                    rotulo="Unidade da agenda"
                    valor={cr.agendaUnidadeId}
                    aoMudar={c("agendaUnidadeId")}
                  />
                  <SelecaoRef
                    entidade="profissional"
                    rotulo="Profissional"
                    valor={cr.agendaProfissionalId}
                    aoMudar={c("agendaProfissionalId")}
                  />
                  <SelecaoRef
                    entidade="especialidade"
                    rotulo="Especialidade"
                    valor={cr.agendaEspecialidadeId}
                    aoMudar={c("agendaEspecialidadeId")}
                  />
                </SimpleGrid>
              )}
              <Group>
                <Button
                  leftSection={<IconUsers size={16} />}
                  variant="light"
                  onClick={verDestinatarios}
                  disabled={!meios.length}
                >
                  Ver destinatários
                </Button>
                <Button
                  leftSection={<IconSend size={16} />}
                  onClick={enviar}
                  loading={enviando}
                  disabled={!previa || !titulo.trim() || !texto.trim()}
                >
                  {quando ? "Agendar envio" : "Enviar agora"}
                </Button>
              </Group>
              {previa && (
                <Stack gap={4}>
                  <Group gap="xs">
                    <Badge size="lg">{previa.total} paciente(s)</Badge>
                    {meios.includes("sms") && (
                      <Badge variant="light">SMS: {previa.alcance.sms}</Badge>
                    )}
                    {meios.includes("email") && (
                      <Badge variant="light">
                        E-mail: {previa.alcance.email}
                      </Badge>
                    )}
                    {meios.includes("push") && (
                      <Badge variant="light">
                        Aplicativo: {previa.alcance.push}
                      </Badge>
                    )}
                    {previa.alcance.semContato > 0 && (
                      <Badge color="orange" variant="light">
                        Sem meio disponível: {previa.alcance.semContato}
                      </Badge>
                    )}
                  </Group>
                  <Table fz="xs" striped>
                    <Table.Tbody>
                      {previa.amostra.slice(0, 10).map((d: any) => (
                        <Table.Tr key={d.id}>
                          <Table.Td>{d.nome}</Table.Td>
                          <Table.Td>{d.celular ?? "-"}</Table.Td>
                          <Table.Td>{d.unidade ?? ""}</Table.Td>
                          <Table.Td>
                            {d.data_agendamento
                              ? `${d.data_agendamento} ${d.hora ?? ""}`
                              : ""}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  {previa.total > 10 && (
                    <Text size="xs" c="dimmed">
                      ... e mais {previa.total - 10} paciente(s).
                    </Text>
                  )}
                </Stack>
              )}
            </Stack>
          </Paper>
        </Grid.Col>
      </Grid>
      <Paper withBorder p="sm">
        <Text fw={600} mb="xs">
          Envios realizados e agendados
        </Text>
        <Table fz="sm" striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Título</Table.Th>
              <Table.Th>Meios</Table.Th>
              <Table.Th>Criado</Table.Th>
              <Table.Th>Envio</Table.Th>
              <Table.Th>Pacientes</Table.Th>
              <Table.Th>Mensagens</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(historico.dados ?? []).map((k) => (
              <Table.Tr key={k.id}>
                <Table.Td>{k.titulo}</Table.Td>
                <Table.Td>
                  {(k.meios ?? []).map((m: string) => MEIO[m]).join(", ")}
                </Table.Td>
                <Table.Td>
                  {fmtDataHora(k.criado_em)} · {k.operador}
                </Table.Td>
                <Table.Td>
                  {k.agendada_para ? fmtDataHora(k.agendada_para) : "Imediato"}
                </Table.Td>
                <Table.Td>{k.destinatarios}</Table.Td>
                <Table.Td>{k.mensagens}</Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {Object.entries(k.por_situacao ?? {}).map(([s, n]) => (
                      <Badge
                        key={s}
                        size="xs"
                        color={SITUACOES[s]?.[1] ?? "gray"}
                        variant="light"
                      >
                        {SITUACOES[s]?.[0] ?? s}: {String(n)}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>
                  {k.situacao === "AGENDADA" && (
                    <Button
                      size="compact-xs"
                      color="red"
                      variant="subtle"
                      leftSection={<IconX size={12} />}
                      onClick={() => cancelar(k.id)}
                    >
                      Cancelar
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

registrarTela({
  id: "mensagens-gerenciador",
  titulo: "Gerenciador de notificações",
  menu: "Agendamento/Notificações",
  padrao: "/t/notificacoes/gerenciador",
  permissao: "mensagem_paciente:consultar",
  modulo: "AGE",
  palavras: ["sms", "e-mail", "mensagens", "notificação", "respostas"],
  ordem: 1,
  render: () => <TelaGerenciador />,
});
registrarTela({
  id: "mensagens-bloco",
  titulo: "Notificações em massa",
  menu: "Agendamento/Notificações",
  padrao: "/t/notificacoes/envio",
  permissao: "mensagem_paciente:incluir",
  modulo: "AGE",
  palavras: ["sms", "campanha", "mensagem em massa", "aviso", "agendar envio"],
  ordem: 2,
  render: () => <TelaEnvioBloco />,
});
registrarMenuRelatorios("AGE", "Agendamento", "mensagem_paciente:consultar");
