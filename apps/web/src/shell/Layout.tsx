import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Burger,
  Button,
  CloseButton,
  Drawer,
  Group,
  Indicator,
  Menu,
  NavLink,
  ScrollArea,
  Select,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure, useInterval } from '@mantine/hooks';
import { Spotlight, spotlight } from '@mantine/spotlight';
import '@mantine/spotlight/styles.css';
import {
  IconBell,
  IconExternalLink,
  IconHelp,
  IconHome,
  IconKey,
  IconLogout,
  IconSearch,
  IconUserCircle,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { api, urlArquivo } from '@/api';
import { useAuth } from '@/auth/Auth';
import { resolverTela } from '@/telas/registro';
import type { Meta } from '@/tipos';
import { BotaoDitado } from '@/voz/Ditado';
import { AjudaOnline } from './AjudaOnline';
import { emJanelaDestacada, JanelaAtual, useJanelas } from './Janelas';
import { achatarMenu, montarMenu, type ItemMenu } from './menu';
import { Inicio } from '@/telas/Inicio';

const CtxMetas = createContext<Meta[]>([]);
export const useMetas = () => useContext(CtxMetas);

function ConteudoJanela({ chave }: { chave: string }) {
  const r = resolverTela(chave);
  if (!r) return <Text c="dimmed">Tela não encontrada: {chave}</Text>;
  return <>{r.tela.render(r.parametros)}</>;
}

function ItensMenu({ itens, nivel = 0 }: { itens: ItemMenu[]; nivel?: number }) {
  const { abrir, ativa } = useJanelas();
  return (
    <>
      {itens.map((i) =>
        i.caminho ? (
          <NavLink
            key={i.caminho}
            label={i.rotulo}
            active={ativa === i.caminho}
            onClick={() => abrir(i.caminho!, i.rotulo)}
            pl={nivel * 12 + 12}
            py={4}
            styles={{ label: { fontSize: 13 } }}
          />
        ) : (
          <NavLink key={i.rotulo + nivel} label={i.rotulo} childrenOffset={0} pl={nivel * 12 + 12} py={6} styles={{ label: { fontWeight: nivel === 0 ? 600 : 500, fontSize: 13 } }}>
            <ItensMenu itens={i.filhos ?? []} nivel={nivel + 1} />
          </NavLink>
        ),
      )}
    </>
  );
}

function Notificacoes() {
  const [aberto, { open, close }] = useDisclosure(false);
  const [lista, setLista] = useState<any[]>([]);
  const carregar = () => api.get('/api/notificacoes').then(setLista).catch(() => {});
  const intervalo = useInterval(carregar, 60_000);
  useEffect(() => {
    void carregar();
    intervalo.start();
    return intervalo.stop;
  }, []);
  const naoLidas = lista.filter((n) => !n.lida_em).length;
  return (
    <>
      <Tooltip label="Notificações">
        <Indicator label={naoLidas} size={16} disabled={!naoLidas} color="red">
          <ActionIcon variant="subtle" color="gray" onClick={open} aria-label="Notificações">
            <IconBell size={20} />
          </ActionIcon>
        </Indicator>
      </Tooltip>
      <Drawer opened={aberto} onClose={close} position="right" title="Notificações" size="md">
        <Stack>
          {lista.length === 0 && <Text c="dimmed">Nenhuma notificação.</Text>}
          {lista.map((n) => (
            <Box key={n.id} p="sm" bg={n.lida_em ? undefined : 'blue.0'} style={{ borderRadius: 8, border: '1px solid var(--mantine-color-gray-3)' }}>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600} size="sm">
                  {n.titulo}
                </Text>
                <CloseButton size="sm" title="Excluir" onClick={() => api.delete(`/api/notificacoes/${n.id}`).then(carregar)} />
              </Group>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {n.mensagem}
              </Text>
              <Group justify="space-between" mt={4}>
                <Text size="xs" c="dimmed">
                  {n.remetente} · {new Date(n.criado_em).toLocaleString('pt-BR')}
                </Text>
                <Group gap={4}>
                  {n.anexo_id && (
                    <Button size="compact-xs" variant="light" component="a" href={urlArquivo(n.anexo_id)} target="_blank">
                      Anexo
                    </Button>
                  )}
                  {!n.lida_em && (
                    <Button size="compact-xs" variant="subtle" onClick={() => api.post(`/api/notificacoes/${n.id}/lida`).then(carregar)}>
                      Marcar como lida
                    </Button>
                  )}
                </Group>
              </Group>
            </Box>
          ))}
        </Stack>
      </Drawer>
    </>
  );
}

export function Layout() {
  const { eu, sair, pode, recarregar } = useAuth();
  const [metas, setMetas] = useState<Meta[]>([]);
  const [menuAberto, { toggle }] = useDisclosure(true);
  const [ajuda, ajudaCtl] = useDisclosure(false);
  const { janelas, ativa, abrir, fechar, destacar } = useJanelas();
  const navegar = useNavigate();
  const destacada = emJanelaDestacada();

  useEffect(() => {
    api.get<Meta[]>('/api/meta').then(setMetas).catch(() => {});
  }, []);

  const menu = useMemo(() => montarMenu(metas, pode), [metas, pode]);
  const acoesBusca = useMemo(
    () =>
      achatarMenu(menu).map((i) => ({
        id: i.caminho,
        label: i.rotulo,
        description: i.grupo,
        keywords: i.palavras,
        onClick: () => abrir(i.caminho, i.rotulo),
      })),
    [menu, abrir],
  );

  if (destacada) {
    return (
      <CtxMetas.Provider value={metas}>
        <Box p="md">
          <JanelaAtual.Provider value={ativa}>
            <ConteudoJanela chave={ativa} />
          </JanelaAtual.Provider>
        </Box>
      </CtxMetas.Provider>
    );
  }

  return (
    <CtxMetas.Provider value={metas}>
      {/* Leiaute responsivo: computadores, tablets e celulares com acesso à internet (TR 1.1.2.1.34). */}
      <AppShell header={{ height: 52 }} navbar={{ width: 270, breakpoint: 'sm', collapsed: { mobile: !menuAberto, desktop: !menuAberto } }} padding={0}>
        <AppShell.Header bg="#1c5aa8" c="white">
          <Group h="100%" px="sm" justify="space-between" wrap="nowrap">
            <Group gap="xs" wrap="nowrap">
              <Burger opened={menuAberto} onClick={toggle} size="sm" color="white" aria-label="Menu" />
              <UnstyledButton onClick={() => navegar('/')}>
                <Group gap={6} wrap="nowrap">
                  <img src="/icone.svg" width={28} height={28} alt="" />
                  <Text fw={700} c="white" visibleFrom="sm">
                    Gestão da Saúde
                  </Text>
                </Group>
              </UnstyledButton>
              <Button
                variant="white"
                color="gray"
                size="xs"
                leftSection={<IconSearch size={14} />}
                onClick={() => spotlight.open()}
                w={260}
                justify="flex-start"
                styles={{ label: { fontWeight: 400, color: '#666' } }}
                visibleFrom="md"
              >
                Buscar funcionalidade... (Ctrl+K)
              </Button>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Select
                size="xs"
                w={280}
                visibleFrom="sm"
                placeholder="Unidade de trabalho"
                data={(eu?.unidades ?? []).map((u) => ({ value: String(u.id), label: u.nome }))}
                value={eu?.unidadeAtual ? String(eu.unidadeAtual) : null}
                onChange={(v) => v && api.post('/api/auth/unidade', { unidadeId: Number(v) }).then(recarregar)}
                searchable
                title="Unidade de saúde em que o operador está trabalhando"
              />
              <Box bg="white" style={{ borderRadius: 6 }}>
                <BotaoDitado />
              </Box>
              <Box bg="white" style={{ borderRadius: 6 }}>
                <Notificacoes />
              </Box>
              <Tooltip label="Ajuda online">
                <ActionIcon variant="white" color="gray" onClick={ajudaCtl.open} aria-label="Ajuda">
                  <IconHelp size={20} />
                </ActionIcon>
              </Tooltip>
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button variant="subtle" color="gray.0" size="xs" leftSection={<IconUserCircle size={18} />} c="white">
                    <Text size="xs" maw={140} truncate c="white">
                      {eu?.nome}
                    </Text>
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>{eu?.login}</Menu.Label>
                  <Menu.Item leftSection={<IconKey size={14} />} onClick={() => abrir('/t/alterar-senha', 'Alterar senha')}>
                    Alterar senha
                  </Menu.Item>
                  <Menu.Item leftSection={<IconLogout size={14} />} color="red" onClick={() => void sair()}>
                    Sair
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Group>
        </AppShell.Header>
        <AppShell.Navbar>
          <ScrollArea h="100%" type="auto">
            <NavLink label="Início" leftSection={<IconHome size={16} />} active={ativa === '/'} onClick={() => navegar('/')} />
            <ItensMenu itens={menu} />
          </ScrollArea>
        </AppShell.Navbar>
        <AppShell.Main bg="gray.0">
          <Group gap={2} px={6} pt={6} wrap="nowrap" style={{ overflowX: 'auto', borderBottom: '1px solid var(--mantine-color-gray-3)' }} bg="white">
            {janelas.map((j) => (
              <Group
                key={j.chave}
                gap={2}
                wrap="nowrap"
                px={8}
                py={4}
                bg={j.chave === ativa ? 'white' : 'gray.1'}
                style={{
                  border: '1px solid var(--mantine-color-gray-3)',
                  borderBottom: j.chave === ativa ? '2px solid #1c5aa8' : undefined,
                  borderRadius: '6px 6px 0 0',
                  cursor: 'pointer',
                  maxWidth: 260,
                }}
                onClick={() => navegar(j.chave)}
                onAuxClick={(e) => e.button === 1 && fechar(j.chave)}
              >
                <Text size="xs" truncate fw={j.chave === ativa ? 600 : 400}>
                  {j.titulo}
                </Text>
                <Tooltip label="Abrir em janela separada (arrastável para outro monitor)">
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={(e) => {
                      e.stopPropagation();
                      destacar(j.chave);
                    }}
                  >
                    <IconExternalLink size={12} />
                  </ActionIcon>
                </Tooltip>
                <CloseButton
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    fechar(j.chave);
                  }}
                />
              </Group>
            ))}
            {janelas.length > 0 && (
              <Badge variant="transparent" size="xs" color="gray" ml="auto">
                {janelas.length} janela(s)
              </Badge>
            )}
          </Group>
          <Box p="sm" style={{ minHeight: 'calc(100vh - 92px)' }}>
            {ativa === '/' && <Inicio />}
            {janelas.map((j) => (
              <Box key={j.chave} style={{ display: j.chave === ativa ? 'block' : 'none' }}>
                <JanelaAtual.Provider value={j.chave}>
                  <ConteudoJanela chave={j.chave} />
                </JanelaAtual.Provider>
              </Box>
            ))}
          </Box>
        </AppShell.Main>
      </AppShell>
      <Spotlight
        actions={acoesBusca}
        nothingFound="Nenhuma funcionalidade encontrada"
        searchProps={{ leftSection: <IconSearch size={18} />, placeholder: 'Digite uma palavra-chave (ex.: agenda, receita, vacina)...' }}
        shortcut={['mod + K']}
        highlightQuery
        limit={12}
      />
      <AjudaOnline aberto={ajuda} aoFechar={ajudaCtl.close} />
    </CtxMetas.Provider>
  );
}
