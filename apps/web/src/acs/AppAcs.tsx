// Aplicativo do agente comunitário de saúde (TR 1.2.49): funciona no navegador do celular (Android/iOS) sem
// instalação e também instalado (PWA), com execução off-line, dados cifrados no aparelho, gerenciamento de
// cargas, Ficha A, visitas domiciliares e territoriais (e-SUS) com GPS e sincronização com o sistema web.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  Container,
  Divider,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  PasswordInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconCloudDownload,
  IconCloudUpload,
  IconHome,
  IconHomeHeart,
  IconListCheck,
  IconLock,
  IconLogout,
  IconMap,
  IconMapPin,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUserEdit,
  IconUserPlus,
  IconUsers,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { senhaAtendePolitica, somenteDigitos } from '@compartilhado/validacao';
import { api } from '@/api';
import { agoraIso, novoUuid, ProvedorAcs, useAcs, type Carga } from './estado';
import { MapaVisitas } from './MapaVisitas';

const ok = (m: string) => notifications.show({ color: 'teal', message: m });
const falha = (e: unknown) => notifications.show({ color: 'red', title: 'Atenção', message: (e as Error).message });
const fmtData = (v?: string | null) => (v ? dayjs(String(v).slice(0, 10)).format('DD/MM/YYYY') : '-');
const rotuloDe = (lista: [string, string][] | undefined, v: any) => lista?.find(([k]) => k === v)?.[1] ?? v ?? '-';
const idade = (n?: string) => (n ? dayjs().diff(dayjs(n), 'year') : null);

/** Registro do service worker: funcionamento off-line e atualização automática sem intervenção (TR 1.2.49.1, 1.2.49.4). */
function usePwaAcs() {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const anterior = link?.href;
    if (link) link.href = '/acs-manifest.json';
    document.title = 'ACS - Agente Comunitário';
    if (!('serviceWorker' in navigator)) return;
    let jaControlado = !!navigator.serviceWorker.controller;
    const aoTrocar = () => {
      // Nova versão ativada: recarrega automaticamente (os dados ficam no cofre local).
      if (jaControlado) window.location.reload();
      jaControlado = true;
    };
    navigator.serviceWorker.addEventListener('controllerchange', aoTrocar);
    void navigator.serviceWorker
      .register('/acs-sw.js', { scope: '/acs/' })
      .then(async (r) => {
        // Guarda no cache os módulos já carregados nesta abertura (uso off-line imediato).
        const pronto = await navigator.serviceWorker.ready;
        const urls = [location.origin + '/acs/', ...performance.getEntriesByType('resource').map((x) => x.name)];
        pronto.active?.postMessage({ tipo: 'precache', urls });
        const t = setInterval(() => navigator.onLine && r.update().catch(() => {}), 30 * 60_000);
        return () => clearInterval(t);
      })
      .catch(() => {});
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', aoTrocar);
      if (link && anterior) link.href = anterior;
    };
  }, []);
}

// ---------------------------------------------------------------- identificação

/** Identificação pelo CPF e senha forte (TR 1.2.49.6); bloqueio após tentativas inválidas (TR 1.2.49.7). */
function Entrada() {
  const { entrar, online } = useAcs();
  const [cpf, setCpf] = useState('');
  const [senha, setSenha] = useState('');
  const [anterior, setAnterior] = useState('');
  const [pedirAnterior, setPedirAnterior] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const enviar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await entrar(somenteDigitos(cpf), senha, anterior || undefined);
      if (r.precisaSenhaAnterior) setPedirAnterior(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };
  return (
    <Box mih="100vh" bg="teal.7" py="xl">
      <Container size={420}>
        <Stack align="center" c="white" gap={4} mb="md">
          <ThemeIcon size={60} radius="xl" color="white" variant="white">
            <IconHomeHeart size={34} color="var(--mantine-color-teal-7)" />
          </ThemeIcon>
          <Title order={2}>Agente Comunitário</Title>
          <Badge color={online ? 'teal.3' : 'orange'} leftSection={online ? <IconWifi size={12} /> : <IconWifiOff size={12} />}>
            {online ? 'conectado' : 'sem conexão (modo off-line)'}
          </Badge>
        </Stack>
        <Paper radius="lg" p="lg">
          <Stack>
            {erro && <Alert color="red">{erro}</Alert>}
            <TextInput label="CPF" inputMode="numeric" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(e.currentTarget.value)} />
            <PasswordInput label="Senha" value={senha} onChange={(e) => setSenha(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && enviar()} />
            {pedirAnterior && (
              <PasswordInput label="Senha anterior deste aparelho" description="Sua senha mudou. Informe a anterior para manter os registros ainda não enviados." value={anterior} onChange={(e) => setAnterior(e.currentTarget.value)} />
            )}
            <Button size="md" color="teal" onClick={enviar} loading={carregando} disabled={somenteDigitos(cpf).length < 11 || !senha} leftSection={<IconLock size={16} />}>
              Entrar
            </Button>
            <Text size="xs" c="dimmed">
              O acesso é liberado pelo responsável da unidade de saúde. Sem internet, entre com o mesmo CPF e senha usados no último acesso on-line.
            </Text>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}

function TrocaSenha({ aoConcluir }: { aoConcluir: () => void }) {
  const { trocarSenha } = useAcs();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const problema = senhaAtendePolitica(nova);
  return (
    <Container size={420} py="xl">
      <Stack>
        <Title order={3}>Defina uma nova senha</Title>
        <Text size="sm">A senha do aplicativo deve ter no mínimo 8 caracteres, com 1 número, 1 letra e 1 caractere especial.</Text>
        <PasswordInput label="Senha atual" value={atual} onChange={(e) => setAtual(e.currentTarget.value)} />
        <PasswordInput label="Nova senha" value={nova} onChange={(e) => setNova(e.currentTarget.value)} error={nova && problema} />
        <Button color="teal" disabled={!!problema || !atual} onClick={() => trocarSenha(atual, nova).then(() => (ok('Senha alterada.'), aoConcluir())).catch(falha)}>
          Salvar
        </Button>
      </Stack>
    </Container>
  );
}

// ---------------------------------------------------------------- telas

type Tela = { nome: 'inicio' } | { nome: 'familias' } | { nome: 'familia'; id: number } | { nome: 'mapa' } | { nome: 'pendencias' };

function Linha({ r, v }: { r: string; v: ReactNode }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start">
      <Text size="xs" c="dimmed">
        {r}
      </Text>
      <Text size="sm" ta="right">
        {v === null || v === undefined || v === '' ? '-' : v}
      </Text>
    </Group>
  );
}

/** Informações da carga atual e gerenciamento: recebimento, envio e cancelamento (TR 1.2.49.12.1, 1.2.49.12.2). */
function Inicio({ ir }: { ir: (t: Tela) => void }) {
  const { carga, fila, online, receberCarga, enviarCarga, cancelarCarga, sincronizando, ultimaSincronizacao, mensagem, perfil } = useAcs();
  const [cancelar, setCancelar] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [indicadores, setIndicadores] = useState<any>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (online) api.get('/api/acs/indicadores').then(setIndicadores).catch(() => setIndicadores(null));
  }, [online, ultimaSincronizacao]);
  const executar = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await fn();
    } catch (e) {
      falha(e);
    } finally {
      setOcupado(false);
    }
  };
  const k = carga?.carga;
  const vencida = k && k.validade < dayjs().format('YYYY-MM-DD');
  return (
    <Stack gap="md">
      {mensagem && (
        <Alert color="teal" variant="light">
          {mensagem}
        </Alert>
      )}
      <Card withBorder radius="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>Carga atual</Title>
          {k ? <Badge color={vencida ? 'red' : 'teal'}>{vencida ? 'validade vencida' : 'em campo'}</Badge> : <Badge color="gray">sem carga</Badge>}
        </Group>
        {k ? (
          <Stack gap={2}>
            <Linha r="Data do recebimento" v={dayjs(k.recebidaEm).format('DD/MM/YYYY HH:mm')} />
            <Linha r="Responsável" v={k.responsavel} />
            <Linha r="Unidade" v={k.unidade} />
            <Linha r="Área" v={k.area} />
            <Linha r="Microárea" v={k.microarea} />
            <Linha r="Número de famílias" v={carga!.familias.length} />
            <Linha r="Número de pessoas" v={carga!.pessoas.filter((p) => p.situacao !== 'FALECIDO' && p.situacao !== 'MUDOU').length} />
            <Linha r="Data para retorno (validade)" v={fmtData(k.validade)} />
            <Linha r="Última sincronização" v={ultimaSincronizacao ? dayjs(ultimaSincronizacao).format('DD/MM/YYYY HH:mm') : 'nunca'} />
          </Stack>
        ) : (
          <Text size="sm" c="dimmed">
            Receba a carga da sua microárea ({perfil?.microarea ?? '-'}) para trabalhar em campo, mesmo sem internet.
          </Text>
        )}
      </Card>
      <SimpleGrid cols={2} spacing="xs">
        <Button color="teal" leftSection={<IconCloudDownload size={16} />} disabled={!online || !!fila.length} loading={ocupado && !sincronizando} onClick={() => executar(receberCarga)}>
          {k ? 'Atualizar carga' : 'Receber carga'}
        </Button>
        <Button leftSection={<IconCloudUpload size={16} />} disabled={!online || !k} loading={sincronizando} onClick={() => executar(() => enviarCarga(false))}>
          Sincronizar ({fila.length})
        </Button>
        <Button variant="light" disabled={!online || !k} onClick={() => executar(() => enviarCarga(true))}>
          Enviar e encerrar carga
        </Button>
        <Button variant="light" color="red" disabled={!online || !k} onClick={() => setCancelar(true)}>
          Cancelar carga
        </Button>
      </SimpleGrid>
      {!online && (
        <Alert color="orange" icon={<IconWifiOff size={16} />}>
          Sem conexão: os registros ficam guardados no aparelho (cifrados) e serão enviados na próxima sincronização.
        </Alert>
      )}
      {indicadores && (
        <Card withBorder radius="md">
          <Title order={5} mb="xs">
            Indicadores do mês
          </Title>
          <SimpleGrid cols={3} spacing="xs">
            {[
              ['Visitas', indicadores.visitas_mes],
              ['Realizadas', indicadores.realizadas_mes],
              ['Ausentes', indicadores.ausentes_mes],
              ['Famílias visitadas', `${indicadores.familias_visitadas_mes}/${indicadores.familias_territorio}`],
              ['Recusadas', indicadores.recusadas_mes],
              ['Agendamentos solicitados', indicadores.solicitacoes_aguardando],
            ].map(([r, v]) => (
              <Stack key={r} gap={0} align="center">
                <Text fw={700} size="lg">
                  {v}
                </Text>
                <Text size="10px" c="dimmed" ta="center">
                  {r}
                </Text>
              </Stack>
            ))}
          </SimpleGrid>
        </Card>
      )}
      {k && (
        <Button variant="subtle" leftSection={<IconUsers size={16} />} onClick={() => ir({ nome: 'familias' })}>
          Ver famílias da carga
        </Button>
      )}
      <Modal opened={cancelar} onClose={() => setCancelar(false)} title="Cancelar carga" centered>
        <Stack>
          <Text size="sm">A carga será descartada do aparelho e as famílias liberadas no sistema. {fila.length ? `Atenção: ${fila.length} registro(s) não enviados serão perdidos.` : ''}</Text>
          <TextInput label="Motivo" value={motivo} onChange={(e) => setMotivo(e.currentTarget.value)} />
          <Button color="red" disabled={motivo.length < 3} onClick={() => executar(async () => { await cancelarCarga(motivo); setCancelar(false); ok('Carga cancelada.'); })}>
            Confirmar cancelamento
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** Lista das famílias contidas na carga (TR 1.2.49.13.1). */
function Familias({ ir }: { ir: (t: Tela) => void }) {
  const { carga } = useAcs();
  const [busca, setBusca] = useState('');
  if (!carga) return <Alert>Receba a carga para ver as famílias.</Alert>;
  const termo = busca.trim().toUpperCase();
  const lista = carga.familias.filter((f) => !termo || [f.codigo, f.responsavel, f.logradouro, f.numero, ...carga.pessoas.filter((p) => p.familia_id === f.id).map((p) => p.nome)].join(' ').toUpperCase().includes(termo));
  const visitadas = new Set((carga.visitasLocais ?? []).map((v) => v.familiaId));
  return (
    <Stack gap="xs">
      <TextInput placeholder="Buscar por nome, endereço ou código" leftSection={<IconSearch size={14} />} value={busca} onChange={(e) => setBusca(e.currentTarget.value)} />
      <Text size="xs" c="dimmed">
        {lista.length} família(s)
      </Text>
      {lista.map((f) => {
        const membros = carga.pessoas.filter((p) => p.familia_id === f.id);
        return (
          <Card key={f.id} withBorder radius="md" padding="sm" onClick={() => ir({ nome: 'familia', id: f.id })} style={{ cursor: 'pointer' }}>
            <Group justify="space-between" wrap="nowrap">
              <Text fw={600} size="sm">
                {f.responsavel ?? 'Família'} {f.alterado && <Badge size="xs" color="orange">alterada</Badge>}
              </Text>
              <Badge variant="light" color={visitadas.has(f.id) ? 'teal' : 'gray'}>
                {visitadas.has(f.id) ? 'visitada hoje' : f.codigo}
              </Badge>
            </Group>
            <Text size="xs">
              {[f.tipo_logradouro, f.logradouro].filter(Boolean).join(' ')}, {f.numero ?? 's/n'} {f.complemento ?? ''} — {f.bairro ?? ''}
            </Text>
            <Text size="xs" c="dimmed">
              {membros.length} integrante(s)
            </Text>
          </Card>
        );
      })}
    </Stack>
  );
}

const valorFicha = (campo: { tipo: string; opcoes: [string, string][] } | undefined, v: any) => {
  if (v === null || v === undefined || v === '') return '-';
  if (!campo) return String(v);
  if (campo.tipo === 'booleano') return v ? 'Sim' : 'Não';
  if (campo.tipo === 'multi_opcao') return (v as string[]).map((x) => rotuloDe(campo.opcoes, x)).join(', ');
  if (campo.tipo === 'opcao') return rotuloDe(campo.opcoes, v);
  return String(v);
};

/** Visualização da família no padrão da Ficha A (TR 1.2.49.13.2) com as ações do ACS. */
function Familia({ id, ir }: { id: number; ir: (t: Tela) => void }) {
  const { carga } = useAcs();
  const [editarDomicilio, setEditarDomicilio] = useState(false);
  const [pessoaEdicao, setPessoaEdicao] = useState<any | null>(null);
  const [visita, setVisita] = useState(false);
  const [solicitar, setSolicitar] = useState<any | null>(null);
  if (!carga) return null;
  const f = carga.familias.find((x) => x.id === id);
  if (!f) return <Alert>Família não encontrada.</Alert>;
  const ficha = carga.opcoes.ficha;
  const membros = carga.pessoas.filter((p) => p.familia_id === id);
  const op = carga.opcoes;
  const camposDomicilio = Object.entries(ficha).filter(([, c]) => c.aba === 'Domicílio');
  const camposOutros = Object.entries(ficha).filter(([, c]) => c.aba === 'Outras informações');
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Button variant="subtle" size="xs" onClick={() => ir({ nome: 'familias' })}>
          ← Famílias
        </Button>
        <Badge>{f.codigo}</Badge>
      </Group>
      <Title order={4}>{f.responsavel}</Title>
      <SimpleGrid cols={2} spacing="xs">
        <Button color="teal" leftSection={<IconListCheck size={16} />} onClick={() => setVisita(true)}>
          Registrar visita
        </Button>
        <Button variant="light" leftSection={<IconUserPlus size={16} />} onClick={() => setPessoaEdicao({ novo: true, familia_id: id, situacao: 'ATIVO' })}>
          Novo integrante
        </Button>
      </SimpleGrid>

      <Card withBorder radius="md" padding="sm">
        <Text fw={700} size="sm" mb={4}>
          Integrantes
        </Text>
        <Stack gap={6}>
          {membros.map((p) => (
            <Paper key={p.id ?? p.uuid} withBorder p="xs" radius="sm">
              <Group justify="space-between" wrap="nowrap" align="flex-start">
                <Stack gap={0}>
                  <Text size="sm" fw={600}>
                    {p.nome} {!p.id && <Badge size="xs" color="orange">novo</Badge>} {p.situacao !== 'ATIVO' && <Badge size="xs" color="gray">{p.situacao}</Badge>}
                  </Text>
                  <Text size="xs">
                    {rotuloDe(op.parentesco, p.parentesco)} · {rotuloDe(op.sexo, p.sexo)} · {idade(p.data_nascimento)} anos ({fmtData(p.data_nascimento)})
                  </Text>
                  <Text size="xs" c="dimmed">
                    Documentos: CNS {p.cns ?? '-'} · CPF {p.cpf ?? '-'} {p.rg_numero ? `· RG ${p.rg_numero}` : ''}
                  </Text>
                  {!!p.condicoes_saude?.length && (
                    <Text size="xs" c="red.8">
                      Doenças e agravantes: {p.condicoes_saude.map((c: string) => rotuloDe(op.condicoesSaude, c)).join(', ')}
                    </Text>
                  )}
                  {!!p.deficiencias?.length && <Text size="xs">Deficiências: {p.deficiencias.map((c: string) => rotuloDe(op.deficiencias, c)).join(', ')}</Text>}
                  {p.alergias && <Text size="xs">Alergias: {p.alergias}</Text>}
                  {p.ultima_visita && <Text size="xs" c="dimmed">Última visita: {fmtData(p.ultima_visita)}</Text>}
                </Stack>
                <Stack gap={4}>
                  <ActionIcon variant="light" onClick={() => setPessoaEdicao(p)} aria-label="Atualizar integrante">
                    <IconUserEdit size={16} />
                  </ActionIcon>
                  <ActionIcon variant="light" color="grape" onClick={() => setSolicitar(p)} aria-label="Solicitar agendamento">
                    <IconPlus size={16} />
                  </ActionIcon>
                </Stack>
              </Group>
            </Paper>
          ))}
        </Stack>
      </Card>

      <Card withBorder radius="md" padding="sm">
        <Text fw={700} size="sm" mb={4}>
          Informações básicas
        </Text>
        <Linha r="Código da família" v={f.codigo} />
        <Linha r="Responsável" v={f.responsavel} />
        <Linha r="Área / microárea" v={`${f.area ?? '-'} / ${f.microarea ?? '-'}`} />
        <Linha r="Renda familiar" v={valorFicha(ficha.renda_familiar, f.renda_familiar)} />
        <Linha r="Integrantes" v={membros.length} />
      </Card>

      <Card withBorder radius="md" padding="sm">
        <Text fw={700} size="sm" mb={4}>
          Endereço
        </Text>
        <Linha r="Município" v={f.municipio} />
        <Linha r="Tipo do logradouro" v={f.tipo_logradouro} />
        <Linha r="Logradouro" v={f.logradouro} />
        <Linha r="Bairro" v={f.bairro} />
        <Linha r="CEP" v={f.cep} />
        <Linha r="Número" v={f.numero} />
        <Linha r="Complemento" v={f.complemento} />
        <Linha r="Ponto de referência" v={f.ponto_referencia} />
        {f.latitude && (
          <Text size="xs" c="dimmed">
            <IconMapPin size={12} /> {Number(f.latitude).toFixed(5)}, {Number(f.longitude).toFixed(5)}
          </Text>
        )}
      </Card>

      <Card withBorder radius="md" padding="sm">
        <Group justify="space-between" mb={4}>
          <Text fw={700} size="sm">
            Informações do domicílio
          </Text>
          <Button size="compact-xs" variant="light" onClick={() => setEditarDomicilio(true)}>
            Atualizar
          </Button>
        </Group>
        {camposDomicilio.map(([nome, c]) => (
          <Linha key={nome} r={c.rotulo} v={valorFicha(c, f[nome])} />
        ))}
      </Card>

      <Card withBorder radius="md" padding="sm">
        <Text fw={700} size="sm" mb={4}>
          Outras informações
        </Text>
        {camposOutros.map(([nome, c]) => (
          <Linha key={nome} r={c.rotulo} v={valorFicha(c, f[nome])} />
        ))}
      </Card>

      {editarDomicilio && <FormDomicilio familia={f} aoFechar={() => setEditarDomicilio(false)} />}
      {pessoaEdicao && <FormPessoa pessoa={pessoaEdicao} aoFechar={() => setPessoaEdicao(null)} />}
      {visita && <FormVisita familia={f} membros={membros} aoFechar={() => setVisita(false)} />}
      {solicitar && <FormSolicitacao pessoa={solicitar} aoFechar={() => setSolicitar(null)} />}
    </Stack>
  );
}

function CampoFicha({ nome, campo, valor, aoMudar }: { nome: string; campo: { rotulo: string; tipo: string; opcoes: [string, string][] }; valor: any; aoMudar: (v: any) => void }) {
  const dados = campo.opcoes.map(([value, label]) => ({ value, label }));
  if (campo.tipo === 'booleano') return <Switch label={campo.rotulo} checked={!!valor} onChange={(e) => aoMudar(e.currentTarget.checked)} />;
  if (campo.tipo === 'opcao') return <Select label={campo.rotulo} data={dados} value={valor ?? null} onChange={aoMudar} clearable comboboxProps={{ withinPortal: true }} />;
  if (campo.tipo === 'multi_opcao') return <MultiSelect label={campo.rotulo} data={dados} value={valor ?? []} onChange={aoMudar} />;
  if (campo.tipo === 'inteiro' || campo.tipo === 'decimal') return <NumberInput label={campo.rotulo} value={valor ?? ''} onChange={(v) => aoMudar(v === '' ? null : Number(v))} />;
  return <TextInput label={campo.rotulo} value={valor ?? ''} onChange={(e) => aoMudar(e.currentTarget.value)} key={nome} />;
}

function FormDomicilio({ familia, aoFechar }: { familia: any; aoFechar: () => void }) {
  const { carga, adicionar } = useAcs();
  const [d, setD] = useState<Record<string, any>>(() => Object.fromEntries(Object.keys(carga!.opcoes.ficha).map((k) => [k, familia[k]])));
  const salvar = async () => {
    const alterados = Object.fromEntries(Object.entries(d).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(familia[k])));
    if (!Object.keys(alterados).length) return aoFechar();
    await adicionar({ tipo: 'familia', uuid: novoUuid(), criadoEm: agoraIso(), id: familia.id, versao: familia.versao, dados: alterados }, (c) => {
      const f = c.familias.find((x) => x.id === familia.id);
      Object.assign(f, alterados, { alterado: true });
    });
    ok('Domicílio atualizado no aparelho. Será enviado na sincronização.');
    aoFechar();
  };
  return (
    <Modal opened onClose={aoFechar} title="Atualizar domicílio (Ficha A)" fullScreen>
      <Stack gap="xs">
        {Object.entries(carga!.opcoes.ficha).map(([nome, c]) => (
          <CampoFicha key={nome} nome={nome} campo={c} valor={d[nome]} aoMudar={(v) => setD({ ...d, [nome]: v })} />
        ))}
        <Button color="teal" onClick={() => salvar().catch(falha)}>
          Salvar no aparelho
        </Button>
      </Stack>
    </Modal>
  );
}

/** Atualização e inclusão de integrantes (TR 1.2.49.13.3, 1.2.49.13.4). */
function FormPessoa({ pessoa, aoFechar }: { pessoa: any; aoFechar: () => void }) {
  const { carga, adicionar } = useAcs();
  const op = carga!.opcoes;
  const novo = !!pessoa.novo;
  const [d, setD] = useState<Record<string, any>>({
    nome: pessoa.nome ?? '',
    sexo: pessoa.sexo ?? null,
    data_nascimento: pessoa.data_nascimento ?? '',
    raca_cor: pessoa.raca_cor ?? null,
    nome_mae: pessoa.nome_mae ?? '',
    parentesco: pessoa.parentesco ?? null,
    cns: pessoa.cns ?? '',
    cpf: pessoa.cpf ?? '',
    celular: pessoa.celular ?? '',
    condicoes_saude: pessoa.condicoes_saude ?? [],
    deficiencias: pessoa.deficiencias ?? [],
    situacao: pessoa.situacao ?? 'ATIVO',
    data_obito: pessoa.data_obito ?? '',
  });
  const set = (k: string, v: any) => setD({ ...d, [k]: v });
  const salvar = async () => {
    const limpo = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v === '' ? null : ['cns', 'cpf', 'celular'].includes(k) && v ? somenteDigitos(v) : v]));
    if (novo) {
      if (!limpo.nome || !limpo.sexo || !limpo.data_nascimento) throw new Error('Informe nome, sexo e data de nascimento.');
      const uuid = novoUuid();
      await adicionar({ tipo: 'pessoa', uuid, criadoEm: agoraIso(), familiaId: pessoa.familia_id, dados: limpo }, (c) => {
        c.pessoas.push({ ...limpo, uuid, familia_id: pessoa.familia_id, alterado: true });
      });
    } else {
      const alterados = Object.fromEntries(Object.entries(limpo).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(pessoa[k] ?? null)));
      if (!Object.keys(alterados).length) return aoFechar();
      if (!pessoa.id) {
        // Integrante ainda não sincronizado: atualiza a inclusão pendente.
        await adicionar({ tipo: 'pessoa', uuid: pessoa.uuid, criadoEm: agoraIso(), familiaId: pessoa.familia_id, dados: { ...limpo } }, (c) => Object.assign(c.pessoas.find((x) => x.uuid === pessoa.uuid), alterados));
      } else {
        await adicionar({ tipo: 'pessoa', uuid: novoUuid(), criadoEm: agoraIso(), id: pessoa.id, familiaId: pessoa.familia_id, versao: pessoa.versao, dados: alterados }, (c) =>
          Object.assign(c.pessoas.find((x) => x.id === pessoa.id), alterados, { alterado: true }),
        );
      }
    }
    ok('Integrante salvo no aparelho.');
    aoFechar();
  };
  const sel = (l: [string, string][]) => l.map(([value, label]) => ({ value, label }));
  return (
    <Modal opened onClose={aoFechar} title={novo ? 'Novo integrante' : 'Atualizar integrante'} fullScreen>
      <Stack gap="xs">
        <TextInput label="Nome completo" required value={d.nome} onChange={(e) => set('nome', e.currentTarget.value.toUpperCase())} />
        <Group grow>
          <Select label="Sexo" required data={sel(op.sexo)} value={d.sexo} onChange={(v) => set('sexo', v)} />
          <TextInput label="Nascimento" type="date" required value={d.data_nascimento ?? ''} onChange={(e) => set('data_nascimento', e.currentTarget.value)} />
        </Group>
        <Select label="Raça/cor" data={sel(op.racaCor)} value={d.raca_cor} onChange={(v) => set('raca_cor', v)} />
        <TextInput label="Nome da mãe" value={d.nome_mae ?? ''} onChange={(e) => set('nome_mae', e.currentTarget.value.toUpperCase())} />
        <Select label="Parentesco com o responsável" data={sel(op.parentesco)} value={d.parentesco} onChange={(v) => set('parentesco', v)} />
        <Group grow>
          <TextInput label="CNS" inputMode="numeric" value={d.cns ?? ''} onChange={(e) => set('cns', e.currentTarget.value)} />
          <TextInput label="CPF" inputMode="numeric" value={d.cpf ?? ''} onChange={(e) => set('cpf', e.currentTarget.value)} />
        </Group>
        <TextInput label="Celular" inputMode="tel" value={d.celular ?? ''} onChange={(e) => set('celular', e.currentTarget.value)} />
        <MultiSelect label="Doenças e agravantes" data={sel(op.condicoesSaude)} value={d.condicoes_saude} onChange={(v) => set('condicoes_saude', v)} />
        <MultiSelect label="Deficiências" data={sel(op.deficiencias)} value={d.deficiencias} onChange={(v) => set('deficiencias', v)} />
        {!novo && (
          <Select label="Situação" data={[{ value: 'ATIVO', label: 'Reside no domicílio' }, { value: 'MUDOU', label: 'Mudou-se' }, { value: 'FALECIDO', label: 'Óbito' }]} value={d.situacao} onChange={(v) => set('situacao', v)} />
        )}
        {d.situacao === 'FALECIDO' && <TextInput label="Data do óbito" type="date" value={d.data_obito ?? ''} onChange={(e) => set('data_obito', e.currentTarget.value)} />}
        <Button color="teal" onClick={() => salvar().catch(falha)}>
          Salvar no aparelho
        </Button>
      </Stack>
    </Modal>
  );
}

/** Coordenadas do GPS no momento da conclusão da visita (TR 1.2.49.13.6). */
function lerGps(): Promise<{ latitude: number; longitude: number; precisao: number } | null> {
  return new Promise((r) => {
    if (!navigator.geolocation) return r(null);
    navigator.geolocation.getCurrentPosition(
      (p) => r({ latitude: p.coords.latitude, longitude: p.coords.longitude, precisao: p.coords.accuracy }),
      () => r(null),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

interface DadosIntegrante {
  motivos: string[];
  desfecho: string;
  parecer: string;
  peso?: number | null;
  altura?: number | null;
  paSistolica?: number | null;
  paDiastolica?: number | null;
  glicemia?: number | null;
  temperatura?: number | null;
}

/** Visita domiciliar com informações de cada integrante no padrão e-SUS APS (TR 1.2.49.13.5). */
function FormVisita({ familia, membros, aoFechar }: { familia: any; membros: any[]; aoFechar: () => void }) {
  const { carga, adicionar } = useAcs();
  const op = carga!.opcoes;
  const ativos = membros.filter((m) => m.situacao === 'ATIVO');
  const [tipoImovel, setTipoImovel] = useState('01');
  const [compartilhada, setCompartilhada] = useState(false);
  const [profissionais, setProfissionais] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>(ativos.map((m) => String(m.id ?? m.uuid)));
  const [porIntegrante, setPorIntegrante] = useState<Record<string, DadosIntegrante>>({});
  const [domicilio, setDomicilio] = useState<DadosIntegrante>({ motivos: ['VISITA_PERIODICA'], desfecho: 'REALIZADA', parecer: '' });
  const [salvando, setSalvando] = useState(false);
  const dadosDe = (k: string) => porIntegrante[k] ?? { motivos: ['VISITA_PERIODICA'], desfecho: 'REALIZADA', parecer: '' };
  const alterar = (k: string, v: Partial<DadosIntegrante>) => setPorIntegrante({ ...porIntegrante, [k]: { ...dadosDe(k), ...v } });
  const motivos = op.motivos.map(([value, label]) => ({ value, label }));
  const concluir = async () => {
    setSalvando(true);
    try {
      const gps = await lerGps();
      const grupo = novoUuid();
      const base = { grupoUuid: grupo, dataHora: agoraIso(), familiaId: familia.id, tipoImovel, compartilhada, profissionaisCompartilhados: compartilhada ? profissionais : null, latitude: gps?.latitude ?? null, longitude: gps?.longitude ?? null, precisao: gps?.precisao ?? null };
      const visitas = selecionados.length
        ? selecionados.map((k) => {
            const m = membros.find((x) => String(x.id ?? x.uuid) === k)!;
            const d = dadosDe(k);
            return { ...base, pessoaId: m.id ?? null, pessoaUuid: m.id ? null : m.uuid, nome: m.nome, ...d };
          })
        : [{ ...base, pessoaId: null, nome: 'Domicílio', ...domicilio }];
      if (visitas.some((v) => !v.motivos.length)) throw new Error('Informe o motivo da visita de cada integrante.');
      for (const v of visitas) {
        const uuid = novoUuid();
        const { nome, ...dados } = v;
        await adicionar({ tipo: 'visita', uuid, criadoEm: agoraIso(), dados: { ...dados, parecer: dados.parecer || null } }, (c) => {
          c.visitasLocais = [...(c.visitasLocais ?? []), { uuid, nome, ...dados, sincronizada: false }];
        });
      }
      ok(gps ? `Visita registrada com localização (precisão ${Math.round(gps.precisao)} m).` : 'Visita registrada sem localização (GPS indisponível ou não autorizado).');
      aoFechar();
    } catch (e) {
      falha(e);
    } finally {
      setSalvando(false);
    }
  };
  const blocoDados = (d: DadosIntegrante, mudar: (v: Partial<DadosIntegrante>) => void) => (
    <Stack gap={6}>
      <MultiSelect label="Motivo da visita" data={motivos} value={d.motivos} onChange={(v) => mudar({ motivos: v })} searchable />
      <Text size="xs" fw={500}>
        Situação da visita
      </Text>
      <SegmentedControl size="xs" fullWidth value={d.desfecho} onChange={(v) => mudar({ desfecho: v })} data={op.desfechos.map(([value, label]) => ({ value, label: label.replace('Visita ', '') }))} />
      <Textarea label="Parecer do técnico" autosize minRows={2} value={d.parecer} onChange={(e) => mudar({ parecer: e.currentTarget.value })} />
      {d.desfecho === 'REALIZADA' && (
        <SimpleGrid cols={3} spacing={6}>
          <NumberInput size="xs" label="Peso (kg)" decimalScale={3} value={d.peso ?? ''} onChange={(v) => mudar({ peso: v === '' ? null : Number(v) })} />
          <NumberInput size="xs" label="Altura (cm)" value={d.altura ?? ''} onChange={(v) => mudar({ altura: v === '' ? null : Number(v) })} />
          <NumberInput size="xs" label="Glicemia" value={d.glicemia ?? ''} onChange={(v) => mudar({ glicemia: v === '' ? null : Number(v) })} />
          <NumberInput size="xs" label="PA sistólica" value={d.paSistolica ?? ''} onChange={(v) => mudar({ paSistolica: v === '' ? null : Number(v) })} />
          <NumberInput size="xs" label="PA diastólica" value={d.paDiastolica ?? ''} onChange={(v) => mudar({ paDiastolica: v === '' ? null : Number(v) })} />
          <NumberInput size="xs" label="Temperatura" decimalScale={1} value={d.temperatura ?? ''} onChange={(v) => mudar({ temperatura: v === '' ? null : Number(v) })} />
        </SimpleGrid>
      )}
    </Stack>
  );
  return (
    <Modal opened onClose={aoFechar} title={`Visita domiciliar — ${familia.codigo}`} fullScreen>
      <Stack gap="sm">
        <Select label="Tipo de imóvel" data={op.tiposImovel.map(([value, label]) => ({ value, label }))} value={tipoImovel} onChange={(v) => setTipoImovel(v ?? '01')} />
        <Switch label="Visita compartilhada com outros profissionais" checked={compartilhada} onChange={(e) => setCompartilhada(e.currentTarget.checked)} />
        {compartilhada && <TextInput label="Profissionais que participaram" value={profissionais} onChange={(e) => setProfissionais(e.currentTarget.value)} />}
        <Checkbox.Group label="Integrantes visitados" value={selecionados} onChange={setSelecionados}>
          <Stack gap={4} mt={4}>
            {ativos.map((m) => (
              <Checkbox key={m.id ?? m.uuid} value={String(m.id ?? m.uuid)} label={`${m.nome} (${idade(m.data_nascimento)} anos)`} />
            ))}
          </Stack>
        </Checkbox.Group>
        {selecionados.length === 0 && (
          <Card withBorder>
            <Text fw={600} size="sm" mb={4}>
              Visita ao domicílio (sem integrante)
            </Text>
            {blocoDados(domicilio, (v) => setDomicilio({ ...domicilio, ...v }))}
          </Card>
        )}
        {selecionados.map((k) => {
          const m = membros.find((x) => String(x.id ?? x.uuid) === k);
          return (
            <Card key={k} withBorder>
              <Text fw={600} size="sm" mb={4}>
                {m?.nome}
              </Text>
              {blocoDados(dadosDe(k), (v) => alterar(k, v))}
            </Card>
          );
        })}
        <Button color="teal" size="md" onClick={concluir} loading={salvando} leftSection={<IconMapPin size={16} />}>
          Concluir visita
        </Button>
        <Text size="xs" c="dimmed">
          Ao concluir, a latitude e a longitude são registradas automaticamente quando o GPS está disponível e autorizado.
        </Text>
      </Stack>
    </Modal>
  );
}

/** Solicitação de agendamento de consulta para o integrante (TR 1.2.49.13.7). */
function FormSolicitacao({ pessoa, aoFechar }: { pessoa: any; aoFechar: () => void }) {
  const { carga, adicionar } = useAcs();
  const [especialidade, setEspecialidade] = useState<string | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const salvar = async () => {
    await adicionar({ tipo: 'solicitacao', uuid: novoUuid(), criadoEm: agoraIso(), pessoaId: pessoa.id ?? null, pessoaUuid: pessoa.id ? null : pessoa.uuid, especialidadeId: Number(especialidade), justificativa });
    ok('Solicitação guardada. Será enviada à unidade na sincronização.');
    aoFechar();
  };
  return (
    <Modal opened onClose={aoFechar} title={`Solicitar consulta — ${pessoa.nome}`} centered>
      <Stack>
        <Select label="Especialidade" searchable data={carga!.especialidades.map((e) => ({ value: String(e.id), label: e.nome }))} value={especialidade} onChange={setEspecialidade} />
        <Textarea label="Justificativa / observação" value={justificativa} onChange={(e) => setJustificativa(e.currentTarget.value)} minRows={3} />
        <Button color="grape" disabled={!especialidade || justificativa.trim().length < 3} onClick={() => salvar().catch(falha)}>
          Solicitar
        </Button>
      </Stack>
    </Modal>
  );
}

function Pendencias() {
  const { fila, carga } = useAcs();
  const nomes = useMemo(() => new Map((carga?.pessoas ?? []).map((p) => [p.id ?? p.uuid, p.nome])), [carga]);
  const descricao = (p: any) =>
    p.tipo === 'visita'
      ? `Visita — ${nomes.get(p.dados.pessoaId ?? p.dados.pessoaUuid) ?? 'domicílio'} (${rotuloDe(carga?.opcoes.desfechos, p.dados.desfecho)})${p.dados.latitude ? ' · com GPS' : ''}`
      : p.tipo === 'pessoa'
        ? `${p.id ? 'Atualização' : 'Inclusão'} de integrante — ${p.dados.nome ?? nomes.get(p.id) ?? ''}`
        : p.tipo === 'familia'
          ? `Atualização do domicílio ${carga?.familias.find((f) => f.id === p.id)?.codigo ?? ''}`
          : `Solicitação de consulta — ${nomes.get(p.pessoaId ?? p.pessoaUuid) ?? ''}`;
  return (
    <Stack gap="xs">
      <Title order={4}>Registros a enviar ({fila.length})</Title>
      {!fila.length && <Text c="dimmed" size="sm">Nenhum registro pendente. Tudo sincronizado.</Text>}
      {fila.map((p) => (
        <Paper key={p.uuid + p.criadoEm} withBorder p="xs">
          <Text size="sm">{descricao(p)}</Text>
          <Text size="xs" c="dimmed">
            {dayjs(p.criadoEm).format('DD/MM/YYYY HH:mm')}
          </Text>
        </Paper>
      ))}
      {(carga?.visitasLocais ?? []).some((v) => v.sincronizada) && (
        <>
          <Divider label="Enviadas nesta carga" />
          {(carga?.visitasLocais ?? [])
            .filter((v) => v.sincronizada)
            .map((v) => (
              <Text key={v.uuid} size="xs">
                ✓ {v.nome} — {dayjs(v.dataHora).format('DD/MM HH:mm')}
              </Text>
            ))}
        </>
      )}
    </Stack>
  );
}

function Mapa() {
  const { online, carga } = useAcs();
  const [pontos, setPontos] = useState<any[]>([]);
  useEffect(() => {
    if (online) api.get<any>('/api/acs/mapa').then((r) => setPontos(r.visitas)).catch(() => {});
  }, [online]);
  const locais = (carga?.visitasLocais ?? []).filter((v) => !v.sincronizada && v.latitude != null).map((v) => ({ id: v.uuid, latitude: v.latitude, longitude: v.longitude, data_hora: v.dataHora, desfecho: v.desfecho, pessoa: v.nome }));
  return (
    <Stack gap="xs">
      <Title order={4}>Mapa das visitas</Title>
      {!online && <Alert color="orange">Sem conexão: as imagens do mapa podem não carregar; as visitas do aparelho continuam registradas.</Alert>}
      <MapaVisitas pontos={[...pontos, ...locais]} altura="60vh" />
    </Stack>
  );
}

function Navegacao({ tela, ir }: { tela: Tela; ir: (t: Tela) => void }) {
  const { fila } = useAcs();
  const itens: [Tela['nome'], string, typeof IconHome][] = [
    ['inicio', 'Início', IconHome],
    ['familias', 'Famílias', IconUsers],
    ['mapa', 'Mapa', IconMap],
    ['pendencias', `Envio${fila.length ? ` (${fila.length})` : ''}`, IconCloudUpload],
  ];
  return (
    <Paper shadow="md" radius={0} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100 }}>
      <Container size={560} px={0}>
        <Group grow gap={0}>
          {itens.map(([nome, rotulo, Icone]) => {
            const ativo = tela.nome === nome || (nome === 'familias' && tela.nome === 'familia');
            return (
              <UnstyledButton key={nome} py={8} onClick={() => ir({ nome } as Tela)}>
                <Stack gap={0} align="center">
                  <Icone size={22} color={ativo ? 'var(--mantine-color-teal-7)' : 'var(--mantine-color-gray-6)'} />
                  <Text size="10px" c={ativo ? 'teal.7' : 'dimmed'} fw={ativo ? 700 : 400}>
                    {rotulo}
                  </Text>
                </Stack>
              </UnstyledButton>
            );
          })}
        </Group>
      </Container>
    </Paper>
  );
}

function Aplicativo() {
  const { perfil, online, sair, fila } = useAcs();
  const [tela, setTela] = useState<Tela>({ nome: 'inicio' });
  const [trocar, setTrocar] = useState(false);
  if (!perfil) return <Entrada />;
  if (trocar) return <TrocaSenha aoConcluir={() => setTrocar(false)} />;
  return (
    <Box pb={80} mih="100vh" bg="var(--mantine-color-gray-0)">
      <Box bg="teal.7" py="xs" style={{ position: 'sticky', top: 0, zIndex: 90 }}>
        <Container size={560}>
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={0} c="white" style={{ minWidth: 0 }}>
              <Text fw={700} size="sm" truncate>
                {perfil.nome}
              </Text>
              <Text size="xs">
                {perfil.unidade} · microárea {perfil.microarea}
              </Text>
            </Stack>
            <Group gap={6} wrap="nowrap">
              <Badge color={online ? 'teal.3' : 'orange'} variant="filled" leftSection={online ? <IconWifi size={12} /> : <IconWifiOff size={12} />}>
                {online ? 'on-line' : 'off-line'}
              </Badge>
              {fila.length > 0 && <Badge color="yellow">{fila.length}</Badge>}
              <ActionIcon variant="transparent" color="white" onClick={() => setTrocar(true)} aria-label="Trocar senha">
                <IconLock size={18} />
              </ActionIcon>
              <ActionIcon variant="transparent" color="white" onClick={sair} aria-label="Sair">
                <IconLogout size={18} />
              </ActionIcon>
            </Group>
          </Group>
        </Container>
      </Box>
      <Container size={560} py="md">
        {tela.nome === 'inicio' && <Inicio ir={setTela} />}
        {tela.nome === 'familias' && <Familias ir={setTela} />}
        {tela.nome === 'familia' && <Familia id={tela.id} ir={setTela} />}
        {tela.nome === 'mapa' && <Mapa />}
        {tela.nome === 'pendencias' && <Pendencias />}
      </Container>
      <Navegacao tela={tela} ir={setTela} />
    </Box>
  );
}

export default function AppAcs() {
  usePwaAcs();
  const [pronto, setPronto] = useState(false);
  useEffect(() => setPronto(true), []);
  if (!pronto)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  return (
    <ProvedorAcs>
      <Aplicativo />
    </ProvedorAcs>
  );
}

export type { Carga };
export { IconTrash };
