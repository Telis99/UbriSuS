// Portal e aplicativo do cidadão (TR 1.2.41): autoatendimento pelo navegador em qualquer dispositivo,
// sem instalação (TR 1.2.41.2), e instalável na tela inicial de Android e iOS como aplicativo (PWA) (TR 1.2.41.1).
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ActionIcon, Alert, Avatar, Badge, Box, Button, Center, Container, Group, Indicator, Loader, Menu, Paper, SimpleGrid, Stack, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import {
  IconBell,
  IconBuildingHospital,
  IconCalendar,
  IconCalendarPlus,
  IconChevronDown,
  IconDeviceMobile,
  IconFlask,
  IconHeartbeat,
  IconHome,
  IconListNumbers,
  IconLogout,
  IconMessageCircle,
  IconPill,
  IconStethoscope,
  IconUser,
  IconUsers,
  IconVaccine,
  IconVideo,
} from '@tabler/icons-react';
import { CaixaEntrada, Entrar, RecuperarSenha, SolicitarAcesso } from './Acesso';
import { FilaPublica, MeusAgendamentos, NovoAgendamento } from './Agendamentos';
import { Cartao, Estado, fmtData, nomeParentesco, primeiroNome, ProvedorCidadao, useCidadao, useDados } from './comum';
import { Familia, ListaTeleatendimentos, Mensagens as MensagensLista, MeusDados, Ouvidoria, Teleatendimento, Unidades } from './Outros';
import { DetalheAtendimento, Disponibilidade, Exames, Historico, Medicamentos, Vacinas } from './Saude';

/** Manifesto e service worker próprios do aplicativo do cidadão (instalação e atualização automática). */
function usePwa() {
  const [instalar, setInstalar] = useState<any>(null);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const anterior = link?.href;
    if (link) link.href = '/cidadao-manifest.json';
    document.title = 'Saúde Cidadão';
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/cidadao-sw.js', { scope: '/cidadao/' }).catch(() => {});
    const aoOferecer = (e: Event) => {
      e.preventDefault();
      setInstalar(e);
    };
    window.addEventListener('beforeinstallprompt', aoOferecer);
    return () => {
      window.removeEventListener('beforeinstallprompt', aoOferecer);
      if (link && anterior) link.href = anterior;
    };
  }, []);
  return instalar;
}

const FUNCOES: { chave: string; rota: string; rotulo: string; icone: ReactNode; cor: string }[] = [
  { chave: 'agendamento', rota: '/cidadao/agendar', rotulo: 'Agendar consulta', icone: <IconCalendarPlus />, cor: 'blue' },
  { chave: 'agendamento', rota: '/cidadao/agendamentos', rotulo: 'Minhas consultas', icone: <IconCalendar />, cor: 'indigo' },
  { chave: 'exames', rota: '/cidadao/exames', rotulo: 'Exames e resultados', icone: <IconFlask />, cor: 'teal' },
  { chave: 'vacinas', rota: '/cidadao/vacinas', rotulo: 'Vacinas', icone: <IconVaccine />, cor: 'grape' },
  { chave: 'medicamentos', rota: '/cidadao/medicamentos', rotulo: 'Medicamentos', icone: <IconPill />, cor: 'green' },
  { chave: 'historico', rota: '/cidadao/historico', rotulo: 'Atendimentos', icone: <IconStethoscope />, cor: 'cyan' },
  { chave: 'fila', rota: '/cidadao/fila', rotulo: 'Fila de espera', icone: <IconListNumbers />, cor: 'orange' },
  { chave: 'teleatendimento', rota: '/cidadao/teleatendimentos', rotulo: 'Teleconsulta', icone: <IconVideo />, cor: 'teal' },
  { chave: 'unidades', rota: '/cidadao/unidades', rotulo: 'Unidades e mapa', icone: <IconBuildingHospital />, cor: 'red' },
  { chave: 'dependentes', rota: '/cidadao/familia', rotulo: 'Minha família', icone: <IconUsers />, cor: 'pink' },
  { chave: 'manifestacoes', rota: '/cidadao/ouvidoria', rotulo: 'Avaliação e ouvidoria', icone: <IconMessageCircle />, cor: 'yellow' },
];

function Inicio() {
  const { sessao, pessoa } = useCidadao();
  const navegar = useNavigate();
  const { dados } = useDados<any>(pessoa && pessoa.situacao !== 'PRE_CADASTRO' && sessao?.funcionalidades.agendamento ? `/api/cidadao/agendamentos?pessoaId=${pessoa.id}` : null, [pessoa?.id]);
  const proxima = dados?.agendadas?.[0];
  return (
    <Stack gap="md">
      <Stack gap={0}>
        <Text c="dimmed" size="sm">
          Olá,
        </Text>
        <Title order={3}>{primeiroNome(sessao?.conta?.nome_social ?? sessao?.conta?.nome)}</Title>
      </Stack>
      {pessoa?.situacao === 'PRE_CADASTRO' && (
        <Alert color="orange" title="Cadastro aguardando validação">
          {pessoa.nome} está em pré-cadastro. Compareça a uma unidade de saúde com um documento do integrante para liberar as funcionalidades.
        </Alert>
      )}
      {proxima && (
        <Cartao cor="blue" onClick={() => navegar('/cidadao/agendamentos')}>
          <Text size="xs" c="dimmed">
            Próxima consulta de {primeiroNome(pessoa?.nome)}
          </Text>
          <Text fw={700}>
            {fmtData(proxima.data)} às {proxima.hora}
          </Text>
          <Text size="sm">
            {proxima.especialidade} — {proxima.unidade}
          </Text>
        </Cartao>
      )}
      <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
        {FUNCOES.filter((f) => sessao?.funcionalidades[f.chave] !== false).map((f) => (
          <UnstyledButton key={f.rota} onClick={() => navegar(f.rota)}>
            <Paper withBorder radius="md" p="xs" h="100%">
              <Stack gap={6} align="center" ta="center">
                <ThemeIcon size={40} radius="xl" variant="light" color={f.cor}>
                  {f.icone}
                </ThemeIcon>
                <Text size="xs" fw={600} lh={1.2}>
                  {f.rotulo}
                </Text>
              </Stack>
            </Paper>
          </UnstyledButton>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function SeletorPessoa() {
  const { sessao, pessoa, setPessoaId } = useCidadao();
  if (!sessao || !pessoa) return null;
  if (sessao.membros.length < 2)
    return (
      <Text size="sm" fw={600} c="white">
        {pessoa.nome}
      </Text>
    );
  // Responsável familiar age em nome dos dependentes (TR 1.2.41.7.5).
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <UnstyledButton>
          <Group gap={4} wrap="nowrap">
            <Text size="sm" fw={600} c="white" truncate maw={190}>
              {pessoa.nome}
            </Text>
            <IconChevronDown size={14} color="white" />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Agir em nome de</Menu.Label>
        {sessao.membros.map((m) => (
          <Menu.Item key={m.id} onClick={() => setPessoaId(m.id)} rightSection={m.situacao === 'PRE_CADASTRO' ? <Badge size="xs" color="orange">pré-cadastro</Badge> : null}>
            <Text size="sm">{m.nome}</Text>
            <Text size="xs" c="dimmed">
              {m.titular ? 'Titular' : nomeParentesco(m.parentesco)}
            </Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

function Navegacao() {
  const navegar = useNavigate();
  const local = useLocation();
  const { sessao } = useCidadao();
  const itens = [
    { rota: '/cidadao', rotulo: 'Início', icone: IconHome },
    { rota: '/cidadao/agendamentos', rotulo: 'Consultas', icone: IconCalendar },
    { rota: '/cidadao/saude', rotulo: 'Saúde', icone: IconHeartbeat },
    { rota: '/cidadao/mensagens', rotulo: 'Avisos', icone: IconBell, contador: sessao?.naoLidas },
    { rota: '/cidadao/perfil', rotulo: 'Perfil', icone: IconUser },
  ];
  return (
    <Paper shadow="md" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, borderTop: '1px solid var(--mantine-color-gray-3)' }} radius={0}>
      <Container size={560} px={0}>
        <Group grow gap={0}>
          {itens.map((i) => {
            const ativo = i.rota === '/cidadao' ? local.pathname === '/cidadao' || local.pathname === '/cidadao/' : local.pathname.startsWith(i.rota);
            const Icone = i.icone;
            return (
              <UnstyledButton key={i.rota} onClick={() => navegar(i.rota)} py={6} aria-label={i.rotulo}>
                <Stack gap={0} align="center">
                  <Indicator disabled={!i.contador} label={i.contador} size={14} color="red">
                    <Icone size={22} color={ativo ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-gray-6)'} />
                  </Indicator>
                  <Text size="10px" c={ativo ? 'blue' : 'dimmed'} fw={ativo ? 700 : 400}>
                    {i.rotulo}
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

function MenuSaude() {
  const navegar = useNavigate();
  return (
    <Stack gap="xs">
      <Title order={3}>Minha saúde</Title>
      {FUNCOES.slice(2).map((f) => (
        <Cartao key={f.rota} onClick={() => navegar(f.rota)}>
          <Group>
            <ThemeIcon variant="light" color={f.cor} radius="xl">
              {f.icone}
            </ThemeIcon>
            <Text fw={600} size="sm">
              {f.rotulo}
            </Text>
          </Group>
        </Cartao>
      ))}
    </Stack>
  );
}

function Perfil({ instalar }: { instalar: any }) {
  const { sair } = useCidadao();
  return (
    <Stack gap="md">
      <MeusDados />
      {instalar && (
        <Button variant="light" leftSection={<IconDeviceMobile size={16} />} onClick={() => instalar.prompt()}>
          Instalar aplicativo neste aparelho
        </Button>
      )}
      <Button color="red" variant="subtle" leftSection={<IconLogout size={16} />} onClick={sair}>
        Sair
      </Button>
    </Stack>
  );
}

function AreaLogada({ instalar }: { instalar: any }) {
  const { sessao, sair } = useCidadao();
  const navegar = useNavigate();
  return (
    <Box pb={80} mih="100vh" bg="var(--mantine-color-gray-0)">
      <Box bg="blue.7" py="xs" style={{ position: 'sticky', top: 0, zIndex: 90 }}>
        <Container size={560}>
          <Group justify="space-between" wrap="nowrap">
            <Group gap="xs" wrap="nowrap" onClick={() => navegar('/cidadao')} style={{ cursor: 'pointer', minWidth: 0 }}>
              <Avatar size="sm" color="white" variant="filled" radius="xl">
                <IconHeartbeat size={16} color="var(--mantine-color-blue-7)" />
              </Avatar>
              <SeletorPessoa />
            </Group>
            <ActionIcon variant="transparent" color="white" onClick={sair} aria-label="Sair">
              <IconLogout size={18} />
            </ActionIcon>
          </Group>
        </Container>
      </Box>
      <Container size={560} py="md">
        <Routes>
          <Route index element={<Inicio />} />
          <Route path="agendar" element={<NovoAgendamento />} />
          <Route path="agendamentos" element={<MeusAgendamentos />} />
          <Route path="fila" element={<FilaPublica />} />
          <Route path="saude" element={<MenuSaude />} />
          <Route path="vacinas" element={<Vacinas />} />
          <Route path="medicamentos" element={<Medicamentos />} />
          <Route path="exames" element={<Exames />} />
          <Route path="historico" element={<Historico />} />
          <Route path="historico/:id" element={<DetalheAtendimento />} />
          <Route path="unidades" element={<Unidades />} />
          <Route path="mensagens" element={<MensagensLista />} />
          <Route path="familia" element={<Familia />} />
          <Route path="teleatendimentos" element={<ListaTeleatendimentos />} />
          <Route path="teleatendimento/:id" element={<Teleatendimento />} />
          <Route path="ouvidoria" element={<Ouvidoria />} />
          <Route path="perfil" element={<Perfil instalar={instalar} />} />
          <Route path="*" element={<Navigate to="/cidadao" replace />} />
        </Routes>
      </Container>
      {sessao && <Navegacao />}
    </Box>
  );
}

/** Área pública: entrada, solicitação de acesso, recuperação de senha e consultas abertas (fila, unidades, medicamentos). */
function AreaPublica({ instalar }: { instalar: any }) {
  const { dados: info } = useDados<any>('/api/cidadao/publico/info');
  const navegar = useNavigate();
  return (
    <Box mih="100vh" style={{ background: 'linear-gradient(180deg, var(--mantine-color-blue-7) 0, var(--mantine-color-blue-5) 220px, var(--mantine-color-gray-0) 220px)' }}>
      <Container size={460} py="lg">
        <Stack gap="md">
          <Stack gap={2} align="center" c="white">
            <ThemeIcon size={56} radius="xl" color="white" variant="white">
              <IconHeartbeat size={32} color="var(--mantine-color-blue-7)" />
            </ThemeIcon>
            <Title order={2}>Saúde Cidadão</Title>
            <Text size="sm">{info?.secretaria ?? 'Secretaria Municipal de Saúde'}</Text>
          </Stack>
          <CaixaEntrada>
            <Routes>
              <Route index element={<Entrar />} />
              <Route path="solicitar" element={<SolicitarAcesso />} />
              <Route path="recuperar" element={<RecuperarSenha />} />
              <Route path="fila" element={<FilaPublica />} />
              <Route path="unidades" element={<Unidades />} />
              <Route path="medicamentos" element={<Disponibilidade />} />
              <Route path="*" element={<Entrar />} />
            </Routes>
          </CaixaEntrada>
          <SimpleGrid cols={3} spacing="xs">
            <Button variant="default" size="xs" onClick={() => navegar('/cidadao/fila')}>
              Fila de espera
            </Button>
            <Button variant="default" size="xs" onClick={() => navegar('/cidadao/unidades')}>
              Unidades
            </Button>
            <Button variant="default" size="xs" onClick={() => navegar('/cidadao/medicamentos')}>
              Medicamentos
            </Button>
          </SimpleGrid>
          {instalar && (
            <Button variant="light" leftSection={<IconDeviceMobile size={16} />} onClick={() => instalar.prompt()}>
              Instalar aplicativo
            </Button>
          )}
          <Text size="xs" c="dimmed" ta="center">
            Funciona em celulares Android e iPhone e em qualquer navegador (Chrome, Firefox, Edge, Safari, Opera), sem instalação.
          </Text>
        </Stack>
      </Container>
    </Box>
  );
}

function Conteudo() {
  const { sessao, carregando } = useCidadao();
  const instalar = usePwa();
  if (carregando)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  return sessao ? <AreaLogada instalar={instalar} /> : <AreaPublica instalar={instalar} />;
}

export default function Portal() {
  return (
    <ProvedorCidadao>
      <Conteudo />
    </ProvedorCidadao>
  );
}

export { Estado };
