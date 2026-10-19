// Envio de notificação avulsa ao paciente, disponível no cabeçalho do paciente em todas as telas (TR 1.2.2.10, 1.1.2.1.60).
import { useEffect, useState } from 'react';
import { ActionIcon, Button, Checkbox, Group, Modal, Select, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconMessage } from '@tabler/icons-react';
import { api } from '@/api';
import { useAuth } from '@/auth/Auth';
import { notificarErro, notificarOk } from './comum';

export interface ModeloMensagem {
  id: number;
  nome: string;
  assunto: string | null;
  texto: string;
}

export function useModelosMensagem() {
  const [modelos, setModelos] = useState<ModeloMensagem[]>([]);
  useEffect(() => {
    api
      .get<ModeloMensagem[]>('/api/mensagens-pacientes/modelos')
      .then(setModelos)
      .catch(() => {});
  }, []);
  return modelos;
}

export const MEIOS_MENSAGEM = [
  { value: 'sms', label: 'SMS (celular do cadastro)' },
  { value: 'email', label: 'E-mail' },
  { value: 'push', label: 'Aplicativo do cidadão' },
];

export function EnvioAvulso({ pacienteId, nome, aoFechar }: { pacienteId: number; nome: string; aoFechar: () => void }) {
  const modelos = useModelosMensagem();
  const [meios, setMeios] = useState<string[]>(['sms']);
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [quando, setQuando] = useState<Date | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await api.post<{ mensagens: number }>('/api/mensagens-pacientes/avulsa', { pacienteId, meios, assunto: assunto || null, texto, agendadaPara: quando?.toISOString() ?? null });
      notificarOk(quando ? `${r.mensagens} mensagem(ns) agendada(s).` : `${r.mensagens} mensagem(ns) enviada(s) para a fila.`);
      aoFechar();
    } catch (e) {
      notificarErro(e);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Modal opened onClose={aoFechar} title={`Enviar mensagem para ${nome}`} size="lg">
      <Stack gap="sm">
        <Select
          label="Modelo"
          placeholder="Opcional"
          clearable
          data={modelos.map((m) => ({ value: String(m.id), label: m.nome }))}
          onChange={(v) => {
            const m = modelos.find((x) => String(x.id) === v);
            if (m) (setAssunto(m.assunto ?? ''), setTexto(m.texto));
          }}
        />
        <Checkbox.Group label="Meios de envio" value={meios} onChange={setMeios}>
          <Group mt={4}>
            {MEIOS_MENSAGEM.map((m) => (
              <Checkbox key={m.value} value={m.value} label={m.label} />
            ))}
          </Group>
        </Checkbox.Group>
        <TextInput label="Assunto" value={assunto} onChange={(e) => setAssunto(e.currentTarget.value)} maxLength={150} />
        <Textarea
          label="Texto"
          autosize
          minRows={4}
          value={texto}
          onChange={(e) => setTexto(e.currentTarget.value)}
          maxLength={meios.includes('sms') ? 640 : 4000}
          description={`${texto.length} caracteres${meios.includes('sms') ? ` · ${Math.max(1, Math.ceil(texto.length / 160))} SMS` : ''} · variáveis: {nome}, {primeiro_nome}, {unidade}`}
        />
        <DateTimePicker label="Agendar envio para" placeholder="Enviar agora" value={quando} onChange={setQuando} clearable valueFormat="DD/MM/YYYY HH:mm" minDate={new Date()} />
        <Group justify="flex-end">
          <Button variant="default" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button onClick={enviar} loading={enviando} disabled={!texto.trim() || !meios.length}>
            {quando ? 'Agendar' : 'Enviar'}
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          O SMS é enviado somente ao celular do cadastro do paciente; meios desabilitados pelo paciente no cadastro não são utilizados.
        </Text>
      </Stack>
    </Modal>
  );
}

/** Botão de envio de mensagem ao paciente (exibido somente para quem tem a permissão). */
export function BotaoMensagemPaciente({ pacienteId, nome }: { pacienteId: number; nome: string }) {
  const { pode } = useAuth();
  const [aberto, setAberto] = useState(false);
  if (!pode('mensagem_paciente:incluir', 'AGE')) return null;
  return (
    <>
      <Tooltip label="Enviar mensagem ao paciente">
        <ActionIcon variant="subtle" onClick={() => setAberto(true)} aria-label="Enviar mensagem ao paciente">
          <IconMessage size={18} />
        </ActionIcon>
      </Tooltip>
      {aberto && <EnvioAvulso pacienteId={pacienteId} nome={nome} aoFechar={() => setAberto(false)} />}
    </>
  );
}
