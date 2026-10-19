import { Card, Group, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconCalendarEvent, IconFirstAidKit, IconPill, IconStethoscope, IconUsers, IconVaccine } from '@tabler/icons-react';
import { useAuth } from '@/auth/Auth';
import { useJanelas } from '@/shell/Janelas';
import { listarTelas } from './registro';

const ATALHOS: { caminho: string; titulo: string; icone: React.ReactNode; cor: string }[] = [
  { caminho: '/t/pacientes', titulo: 'Pacientes', icone: <IconUsers />, cor: 'blue' },
  { caminho: '/t/agendamento', titulo: 'Agendamento', icone: <IconCalendarEvent />, cor: 'grape' },
  { caminho: '/t/recepcao', titulo: 'Recepção e filas', icone: <IconFirstAidKit />, cor: 'teal' },
  { caminho: '/t/atendimentos', titulo: 'Atendimento clínico', icone: <IconStethoscope />, cor: 'cyan' },
  { caminho: '/t/dispensacao', titulo: 'Dispensação', icone: <IconPill />, cor: 'orange' },
  { caminho: '/t/vacinacao', titulo: 'Vacinação', icone: <IconVaccine />, cor: 'green' },
];

export function Inicio() {
  const { eu } = useAuth();
  const { abrir } = useJanelas();
  const disponiveis = new Set(listarTelas().map((t) => t.padrao));
  const unidade = eu?.unidades.find((u) => u.id === eu.unidadeAtual)?.nome;
  return (
    <Stack>
      <div>
        <Title order={3}>Olá, {eu?.nome?.split(' ')[0]?.toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Title>
        <Text c="dimmed">{unidade ? `Unidade de trabalho: ${unidade}` : 'Selecione a unidade de trabalho no topo da tela.'}</Text>
      </div>
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
        {ATALHOS.filter((a) => disponiveis.has(a.caminho)).map((a) => (
          <Card key={a.caminho} withBorder shadow="xs" style={{ cursor: 'pointer' }} onClick={() => abrir(a.caminho, a.titulo)}>
            <Group>
              <ThemeIcon size="lg" variant="light" color={a.cor}>
                {a.icone}
              </ThemeIcon>
              <Text fw={600}>{a.titulo}</Text>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
