// Ajuda online acessível em qualquer tela: chat com o suporte da contratada,
// chamados abertos e atalhos do sistema (TR 1.1.2.1.32).
import { useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Drawer, Group, Kbd, Paper, ScrollArea, Select, Stack, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconMessageCircle, IconSend } from '@tabler/icons-react';
import { api } from '@/api';
import { useJanelas } from './Janelas';

const SITUACOES: Record<string, string> = {
  ABERTO: 'Aberto',
  EM_ATENDIMENTO: 'Em atendimento',
  AGUARDANDO_SOLICITANTE: 'Aguardando você',
  RESOLVIDO: 'Resolvido',
  CANCELADO: 'Cancelado',
};

function Conversa({ chamadoId }: { chamadoId: number }) {
  const [dados, setDados] = useState<{ chamado: any; mensagens: any[] } | null>(null);
  const [texto, setTexto] = useState('');
  const fim = useRef<HTMLDivElement>(null);
  const carregar = () => api.get(`/api/suporte/chamados/${chamadoId}/mensagens`).then(setDados);
  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 15_000);
    return () => clearInterval(t);
  }, [chamadoId]);
  useEffect(() => fim.current?.scrollIntoView({ behavior: 'smooth' }), [dados?.mensagens.length]);
  if (!dados) return null;
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text fw={600} size="sm">
          #{dados.chamado.protocolo} · {dados.chamado.titulo}
        </Text>
        <Badge>{SITUACOES[dados.chamado.situacao]}</Badge>
      </Group>
      <ScrollArea h="55vh" type="auto">
        <Stack gap={6} p={4}>
          {dados.mensagens.map((m) => (
            <Paper key={m.id} p="xs" maw="85%" ml={m.suporte ? 0 : 'auto'} bg={m.suporte ? 'gray.1' : 'blue.0'} radius="md">
              <Text size="xs" c="dimmed">
                {m.suporte ? 'Suporte' : m.autor} · {new Date(m.criado_em).toLocaleString('pt-BR')}
              </Text>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {m.texto}
              </Text>
            </Paper>
          ))}
          <div ref={fim} />
        </Stack>
      </ScrollArea>
      {dados.chamado.situacao !== 'RESOLVIDO' && (
        <Group align="flex-end" wrap="nowrap">
          <Textarea style={{ flex: 1 }} autosize minRows={2} value={texto} onChange={(e) => setTexto(e.currentTarget.value)} placeholder="Digite sua mensagem..." />
          <Button
            leftSection={<IconSend size={14} />}
            disabled={!texto.trim()}
            onClick={() => api.post(`/api/suporte/chamados/${chamadoId}/mensagens`, { texto }).then(() => (setTexto(''), carregar()))}
          >
            Enviar
          </Button>
        </Group>
      )}
    </Stack>
  );
}

export function AjudaOnline({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { janelas, ativa } = useJanelas();
  const [chamados, setChamados] = useState<any[]>([]);
  const [atual, setAtual] = useState<number | null>(null);
  const [novo, setNovo] = useState({ titulo: '', texto: '', classificacao: 'CHAMADO_PLATAFORMA' });
  const carregar = () => api.get('/api/suporte/meus-chamados').then(setChamados).catch(() => {});
  useEffect(() => {
    if (aberto) void carregar();
  }, [aberto]);

  async function abrirChamado() {
    const tela = janelas.find((j) => j.chave === ativa)?.titulo ?? ativa;
    const ch = await api.post('/api/suporte/chamados', { ...novo, modulo: tela.slice(0, 60) });
    notifications.show({ color: 'teal', message: `Chamado ${ch.protocolo} aberto. A equipe de suporte responderá por aqui.` });
    setNovo({ titulo: '', texto: '', classificacao: 'CHAMADO_PLATAFORMA' });
    setAtual(ch.id);
    void carregar();
  }

  return (
    <Drawer opened={aberto} onClose={aoFechar} position="right" size="lg" title={<Group gap={6}><IconMessageCircle size={18} />Ajuda online</Group>}>
      <Tabs defaultValue="chat" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="chat">Falar com o suporte</Tabs.Tab>
          <Tabs.Tab value="chamados">Meus chamados ({chamados.length})</Tabs.Tab>
          <Tabs.Tab value="atalhos">Atalhos</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="chat" pt="sm">
          {atual ? (
            <Stack>
              <Conversa chamadoId={atual} />
              <Button variant="subtle" size="xs" onClick={() => setAtual(null)}>
                Nova conversa
              </Button>
            </Stack>
          ) : (
            <Stack>
              <Text size="sm" c="dimmed">
                Descreva sua dúvida ou problema. A tela atual é anexada automaticamente ao atendimento.
              </Text>
              <TextInput label="Assunto" value={novo.titulo} onChange={(e) => setNovo({ ...novo, titulo: e.currentTarget.value })} />
              <Select
                label="Tipo de atendimento"
                value={novo.classificacao}
                onChange={(v) => setNovo({ ...novo, classificacao: v ?? 'CHAMADO_PLATAFORMA' })}
                data={[
                  { value: 'CHAMADO_PLATAFORMA', label: 'Dúvida ou solicitação' },
                  { value: 'FUNCIONALIDADE_ISOLADA', label: 'Uma funcionalidade não está funcionando' },
                  { value: 'INCONSISTENCIA_MODULO', label: 'Dados inconsistentes / módulo inoperante' },
                ]}
              />
              <Textarea label="Mensagem" autosize minRows={4} value={novo.texto} onChange={(e) => setNovo({ ...novo, texto: e.currentTarget.value })} />
              <Button onClick={() => void abrirChamado()} disabled={novo.titulo.length < 3 || !novo.texto.trim()}>
                Iniciar atendimento
              </Button>
            </Stack>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="chamados" pt="sm">
          <Stack gap="xs">
            {chamados.map((c) => (
              <Paper key={c.id} withBorder p="xs" style={{ cursor: 'pointer' }} onClick={() => setAtual(c.id)}>
                <Group justify="space-between">
                  <Text size="sm" fw={500}>
                    #{c.protocolo} · {c.titulo}
                  </Text>
                  <Badge size="sm">{SITUACOES[c.situacao]}</Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  Aberto em {new Date(c.aberto_em).toLocaleString('pt-BR')}
                </Text>
              </Paper>
            ))}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="atalhos" pt="sm">
          <Box>
            <Stack gap="xs">
              <Text size="sm"><Kbd>Ctrl</Kbd> + <Kbd>K</Kbd> Buscar funcionalidade por palavra-chave</Text>
              <Text size="sm"><Kbd>Ctrl</Kbd> + <Kbd>Shift</Kbd> + <Kbd>Espaço</Kbd> Ditar texto por voz no campo em foco</Text>
              <Text size="sm"><Kbd>Enter</Kbd> ou <Kbd>Tab</Kbd> Avançar para o próximo campo do formulário</Text>
              <Text size="sm">Botão do meio do mouse sobre uma aba: fechar a janela</Text>
              <Text size="sm">Ícone ↗ na aba: abrir a janela separadamente (pode ser arrastada para outro monitor)</Text>
            </Stack>
          </Box>
        </Tabs.Panel>
      </Tabs>
    </Drawer>
  );
}
