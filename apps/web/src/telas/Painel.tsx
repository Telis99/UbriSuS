// Painel de chamadas para televisores (TR 1.2.17.6, 1.2.31.10, 1.2.42.2.7): acessado sem login pela chave
// do painel, exibe a chamada atual em destaque, as anteriores e anuncia por voz (síntese pt-BR).
import { useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Center, Group, Stack, Text, Title } from '@mantine/core';
import { useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '@/api';

const COR: Record<string, string> = { VERMELHO: '#e03131', LARANJA: '#f76707', AMARELO: '#f59f00', VERDE: '#2f9e44', AZUL: '#1971c2' };

function anunciar(texto: string) {
  if (!('speechSynthesis' in window)) return;
  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = 'pt-BR';
  fala.rate = 0.95;
  window.speechSynthesis.speak(fala);
}

function tocarAviso() {
  try {
    const ctx = new AudioContext();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.35);
      o.start(ctx.currentTime + i * 0.35);
      o.stop(ctx.currentTime + i * 0.35 + 0.3);
    });
  } catch {
    /* sem áudio */
  }
}

export function PainelChamadas() {
  const { chave = '' } = useParams();
  const [dados, setDados] = useState<any>(null);
  const [chamadas, setChamadas] = useState<any[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [som, setSom] = useState(false);
  const [hora, setHora] = useState(dayjs().format('HH:mm'));
  const ultimo = useRef<number | null>(null);
  const carregado = useRef(false);
  const somRef = useRef(som);
  somRef.current = som;

  useEffect(() => {
    let ativo = true;
    async function buscar() {
      try {
        const r = await api.get(`/api/publico/painel/${encodeURIComponent(chave)}`, { desde: ultimo.current ?? undefined });
        if (!ativo) return;
        setErro(null);
        setDados(r);
        const novas = [...r.chamadas].filter((c: any) => ultimo.current === null || c.id > ultimo.current).sort((a: any, b: any) => a.id - b.id);
        if (novas.length) {
          if (carregado.current && somRef.current) {
            tocarAviso();
            novas.forEach((c: any, i: number) => setTimeout(() => anunciar(`${c.senha ? `Senha ${c.senha.split('').join(' ')}. ` : ''}${c.nome ?? ''}. ${c.local}`), 800 + i * 4000));
          }
          ultimo.current = Math.max(...novas.map((c: any) => c.id));
          setChamadas((ant) => [...novas.reverse(), ...ant].slice(0, 12));
        }
        carregado.current = true;
      } catch (e) {
        if (ativo) setErro((e as Error).message);
      }
    }
    void buscar();
    const t = setInterval(buscar, 3000);
    const h = setInterval(() => setHora(dayjs().format('HH:mm')), 15_000);
    return () => {
      ativo = false;
      clearInterval(t);
      clearInterval(h);
    };
  }, [chave]);

  if (erro && !dados)
    return (
      <Center h="100vh">
        <Text c="red">{erro}</Text>
      </Center>
    );
  const atual = chamadas[0];
  return (
    <Box h="100vh" bg="#0b1f3a" c="white" p="lg" style={{ display: 'flex', flexDirection: 'column' }}>
      <Group justify="space-between">
        <Title order={2}>{dados?.painel?.unidade ?? 'Painel de chamadas'}</Title>
        <Group>
          {!som && (
            <Button color="yellow" onClick={() => (setSom(true), anunciar('Som do painel ativado'))}>
              Ativar som
            </Button>
          )}
          <Text fz={40} fw={700}>
            {hora}
          </Text>
        </Group>
      </Group>
      <Center style={{ flex: 1 }}>
        {atual ? (
          <Stack align="center" gap={4} p="xl" style={{ borderRadius: 16, background: '#132c52', borderBottom: `14px solid ${COR[atual.cor_faixa] ?? '#228be6'}`, minWidth: '70%' }}>
            {atual.senha && (
              <Text fz={90} fw={900} lh={1}>
                {atual.senha}
              </Text>
            )}
            {atual.nome && (
              <Text fz={56} fw={700} ta="center">
                {atual.nome}
              </Text>
            )}
            <Text fz={44} c="yellow.4" fw={700}>
              {atual.local}
            </Text>
            {atual.profissional && <Text fz={26}>{atual.profissional}</Text>}
          </Stack>
        ) : (
          <Text fz={36} c="dimmed">
            Aguardando chamadas
          </Text>
        )}
      </Center>
      <Group align="flex-end" justify="space-between" wrap="nowrap">
        <Stack gap={4} style={{ flex: 1 }}>
          <Text fw={700} c="gray.4">
            Últimas chamadas
          </Text>
          {chamadas.slice(1, 6).map((c) => (
            <Group key={c.id} gap="md" style={{ borderLeft: `8px solid ${COR[c.cor_faixa] ?? '#228be6'}`, paddingLeft: 8 }}>
              <Text fz={24} fw={700} w={110}>
                {c.senha ?? ''}
              </Text>
              <Text fz={24} style={{ flex: 1 }}>
                {c.nome ?? ''}
              </Text>
              <Text fz={24} c="yellow.4">
                {c.local}
              </Text>
              <Text fz={18} c="gray.5">
                {dayjs(c.chamado_em).format('HH:mm')}
              </Text>
            </Group>
          ))}
        </Stack>
        {dados?.estatisticas && (
          <Stack gap={4} align="flex-end">
            <Badge size="xl" color="blue">
              {dados.estatisticas.aguardando ?? 0} aguardando
            </Badge>
            <Badge size="xl" color="green">
              {dados.estatisticas.atendidos ?? 0} atendidos hoje
            </Badge>
            <Badge size="xl" color="gray">
              espera média {dados.estatisticas.tempo_medio ?? 0} min
            </Badge>
          </Stack>
        )}
      </Group>
    </Box>
  );
}
