import { useState } from 'react';
import { Alert, Anchor, Box, Button, Center, Group, Paper, PasswordInput, Progress, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconFingerprint, IconLock, IconUser } from '@tabler/icons-react';
import { forcaSenha } from '@compartilhado/validacao';
import { api, ErroApi } from '@/api';
import { useAuth } from './Auth';
import { AvisoCookies } from './AvisoCookies';

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <Center mih="100vh" bg="linear-gradient(135deg, #0f3d78 0%, #1c5aa8 55%, #2f7fd6 100%)" p="md">
      <Paper shadow="xl" radius="md" p="xl" w={420} maw="100%">
        {children}
      </Paper>
      <AvisoCookies />
    </Center>
  );
}

export function Login() {
  const { recarregar } = useAuth();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [recuperar, setRecuperar] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await api.post('/api/auth/login', { login, senha });
      await recarregar();
    } catch (err) {
      setErro((err as ErroApi).message);
    } finally {
      setEnviando(false);
    }
  }

  async function enviarRecuperacao(e: React.FormEvent) {
    e.preventDefault();
    const r = await api.post('/api/auth/recuperar-senha', { login });
    setMsg(r.mensagem);
  }

  return (
    <Moldura>
      <Stack gap={4} mb="lg" align="center">
        <img src="/icone.svg" width={56} height={56} alt="" />
        <Title order={3}>Gestão da Saúde</Title>
        <Text size="sm" c="dimmed">
          Secretaria Municipal de Saúde
        </Text>
      </Stack>
      {!recuperar ? (
        <form onSubmit={entrar}>
          <Stack>
            <TextInput label="CPF ou login" leftSection={<IconUser size={16} />} value={login} onChange={(e) => setLogin(e.currentTarget.value)} autoFocus required autoComplete="username" />
            <PasswordInput label="Senha" leftSection={<IconLock size={16} />} value={senha} onChange={(e) => setSenha(e.currentTarget.value)} required autoComplete="current-password" />
            {erro && (
              <Alert color="red" icon={<IconAlertCircle size={16} />}>
                {erro}
              </Alert>
            )}
            <Button type="submit" loading={enviando} fullWidth>
              Entrar
            </Button>
            <Group justify="space-between">
              <Anchor size="sm" onClick={() => setRecuperar(true)}>
                Esqueci minha senha
              </Anchor>
              <Anchor size="sm" href="/api/auth/govbr" title="Login com a conta gov.br (depende de convênio do Município)">
                Entrar com gov.br
              </Anchor>
            </Group>
            <Button variant="subtle" leftSection={<IconFingerprint size={16} />} size="xs" onClick={() => entrarBiometria(login).then(recarregar).catch((e) => setErro(e.message))}>
              Entrar com biometria
            </Button>
          </Stack>
        </form>
      ) : (
        <form onSubmit={enviarRecuperacao}>
          <Stack>
            <Text size="sm">Informe seu CPF. Uma senha temporária será enviada ao e-mail cadastrado.</Text>
            <TextInput label="CPF ou login" value={login} onChange={(e) => setLogin(e.currentTarget.value)} required />
            {msg && <Alert color="blue">{msg}</Alert>}
            <Button type="submit">Enviar senha temporária</Button>
            <Anchor size="sm" onClick={() => setRecuperar(false)}>
              Voltar
            </Anchor>
          </Stack>
        </form>
      )}
    </Moldura>
  );
}

/** Autenticação biométrica via WebAuthn (leitor de digital / Windows Hello / Touch ID). */
async function entrarBiometria(login: string) {
  if (!login) throw new Error('Informe o CPF antes de usar a biometria.');
  if (!window.PublicKeyCredential) throw new Error('Este navegador não suporta autenticação biométrica.');
  const desafio = await api.post('/api/auth/biometria/desafio', { login });
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: Uint8Array.from(atob(desafio.desafio), (c) => c.charCodeAt(0)),
      allowCredentials: desafio.credenciais.map((id: string) => ({ id: Uint8Array.from(atob(id), (c) => c.charCodeAt(0)), type: 'public-key' })),
      userVerification: 'required',
      timeout: 60000,
    },
  })) as PublicKeyCredential;
  const resp = cred.response as AuthenticatorAssertionResponse;
  const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
  await api.post('/api/auth/biometria/entrar', {
    login,
    credencialId: b64(cred.rawId),
    clientDataJSON: b64(resp.clientDataJSON),
    authenticatorData: b64(resp.authenticatorData),
    assinatura: b64(resp.signature),
  });
}

export function TrocarSenha({ obrigatoria }: { obrigatoria?: boolean }) {
  const { recarregar, sair } = useAuth();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const forca = nova ? forcaSenha(nova) : null;
  const valorForca = forca === 'forte' ? 100 : forca === 'media' ? 60 : forca ? 25 : 0;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (nova !== conf) return setErro('A confirmação não confere com a nova senha.');
    try {
      await api.post('/api/auth/trocar-senha', { senhaAtual: atual, novaSenha: nova });
      await recarregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <Moldura>
      <form onSubmit={salvar}>
        <Stack>
          <Title order={4}>{obrigatoria ? 'Sua senha expirou: defina uma nova senha' : 'Alterar senha'}</Title>
          <PasswordInput label="Senha atual" value={atual} onChange={(e) => setAtual(e.currentTarget.value)} required />
          <PasswordInput label="Nova senha" value={nova} onChange={(e) => setNova(e.currentTarget.value)} required minLength={8} />
          {forca && (
            <Box>
              <Progress value={valorForca} color={forca === 'forte' ? 'teal' : forca === 'media' ? 'yellow' : 'red'} size="sm" />
              <Text size="xs" c="dimmed" mt={4}>
                Qualidade da senha: <b>{forca === 'forte' ? 'forte' : forca === 'media' ? 'média' : 'fraca'}</b>
              </Text>
            </Box>
          )}
          <PasswordInput label="Confirme a nova senha" value={conf} onChange={(e) => setConf(e.currentTarget.value)} required />
          {erro && <Alert color="red">{erro}</Alert>}
          <Group justify="space-between">
            <Button variant="default" onClick={() => void sair()}>
              Sair
            </Button>
            <Button type="submit" disabled={forca === 'fraca'}>
              Salvar nova senha
            </Button>
          </Group>
        </Stack>
      </form>
    </Moldura>
  );
}

export function AceitarTermos({ texto }: { texto?: string | null }) {
  const { recarregar, sair } = useAuth();
  return (
    <Moldura>
      <Stack>
        <Title order={4}>Termos e condições de uso</Title>
        <Paper withBorder p="sm" mah={320} style={{ overflow: 'auto' }}>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {texto ?? 'Termos de uso não configurados.'}
          </Text>
        </Paper>
        <Group justify="space-between">
          <Button variant="default" onClick={() => void sair()}>
            Recusar e sair
          </Button>
          <Button onClick={() => api.post('/api/auth/aceitar-termos').then(recarregar)}>Li e aceito os termos</Button>
        </Group>
      </Stack>
    </Moldura>
  );
}
