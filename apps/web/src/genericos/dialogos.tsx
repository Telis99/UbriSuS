// Diálogos assíncronos (confirmação, texto, credenciais) para uso em fluxos de tela.
import { useState } from 'react';
import { Button, Group, PasswordInput, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';

/** Confirmação antes de operações de risco (exclusões, cancelamentos, envios em massa) (TR 1.1.2.1.29). */
export function confirmar(titulo: string, mensagem: string, rotuloConfirmar = 'Confirmar', perigo = false): Promise<boolean> {
  return new Promise((resolve) => {
    modals.openConfirmModal({
      title: titulo,
      children: <Text size="sm">{mensagem}</Text>,
      labels: { confirm: rotuloConfirmar, cancel: 'Cancelar' },
      confirmProps: { color: perigo ? 'red' : undefined },
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
      onClose: () => resolve(false),
    });
  });
}

function FormTexto({ rotulo, longo, obrigatorio, aoConfirmar }: { rotulo: string; longo?: boolean; obrigatorio?: boolean; aoConfirmar: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        aoConfirmar(v);
      }}
    >
      <Stack>
        {longo ? (
          <Textarea label={rotulo} value={v} onChange={(e) => setV(e.currentTarget.value)} autosize minRows={3} data-autofocus required={obrigatorio} />
        ) : (
          <TextInput label={rotulo} value={v} onChange={(e) => setV(e.currentTarget.value)} data-autofocus required={obrigatorio} />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => modals.closeAll()}>
            Cancelar
          </Button>
          <Button type="submit" disabled={obrigatorio && !v.trim()}>
            Confirmar
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function pedirTexto(titulo: string, rotulo: string, opcoes: { longo?: boolean; obrigatorio?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let respondido = false;
    const id = modals.open({
      title: titulo,
      onClose: () => !respondido && resolve(null),
      children: (
        <FormTexto
          rotulo={rotulo}
          longo={opcoes.longo}
          obrigatorio={opcoes.obrigatorio ?? true}
          aoConfirmar={(v) => {
            respondido = true;
            resolve(v);
            modals.close(id);
          }}
        />
      ),
    });
  });
}

function FormCredenciais({ aoConfirmar }: { aoConfirmar: (l: string, s: string) => void }) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        aoConfirmar(login, senha);
      }}
    >
      <Stack>
        <TextInput label="Login do supervisor" value={login} onChange={(e) => setLogin(e.currentTarget.value)} data-autofocus required />
        <PasswordInput label="Senha" value={senha} onChange={(e) => setSenha(e.currentTarget.value)} required />
        <Group justify="flex-end">
          <Button type="submit">Liberar</Button>
        </Group>
      </Stack>
    </form>
  );
}

export function pedirCredenciais(titulo: string): Promise<{ login: string; senha: string } | null> {
  return new Promise((resolve) => {
    let respondido = false;
    const id = modals.open({
      title: titulo,
      onClose: () => !respondido && resolve(null),
      children: (
        <FormCredenciais
          aoConfirmar={(login, senha) => {
            respondido = true;
            resolve({ login, senha });
            modals.close(id);
          }}
        />
      ),
    });
  });
}

/** Confirmação de ação sensível pela senha do próprio operador (TR 1.2.47.43.64). */
export function pedirSenha(titulo: string): Promise<string | null> {
  return new Promise((resolve) => {
    let respondido = false;
    function Form() {
      const [s, setS] = useState('');
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            respondido = true;
            resolve(s);
            modals.close(id);
          }}
        >
          <Stack>
            <PasswordInput label="Sua senha" value={s} onChange={(e) => setS(e.currentTarget.value)} data-autofocus required />
            <Group justify="flex-end">
              <Button type="submit">Confirmar</Button>
            </Group>
          </Stack>
        </form>
      );
    }
    const id = modals.open({ title: titulo, onClose: () => !respondido && resolve(null), children: <Form /> });
  });
}
