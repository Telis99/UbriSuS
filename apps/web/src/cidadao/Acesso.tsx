// Entrada no aplicativo do cidadão: login pelo Cartão SUS (TR 1.2.41.4), bloqueio após tentativas
// inválidas (TR 1.2.41.5), solicitação de acesso com aceite dos termos/LGPD (TR 1.2.41.3) e recuperação de senha.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Anchor, Button, Checkbox, Group, Paper, PasswordInput, PinInput, ScrollArea, Stack, Stepper, Text, TextInput, Title } from '@mantine/core';
import { IconId, IconLock, IconShieldCheck } from '@tabler/icons-react';
import { senhaAtendePolitica, somenteDigitos, validarCns, validarCpf } from '@compartilhado/validacao';
import { api } from '@/api';
import { avisoErro, avisoOk, useCidadao, useDados } from './comum';

const mascaraCns = (v: string) => somenteDigitos(v).slice(0, 15).replace(/^(\d{3})(\d{0,4})(\d{0,4})(\d{0,4}).*/, (_, a, b, c, d) => [a, b, c, d].filter(Boolean).join(' '));

export function RequisitosSenha({ senha }: { senha: string }) {
  const itens: [boolean, string][] = [
    [senha.length >= 8, 'Mínimo de 8 caracteres'],
    [/\d/.test(senha), '1 número'],
    [/[A-Za-z]/.test(senha), '1 letra'],
    [/[^A-Za-z0-9]/.test(senha), '1 caractere especial (@ # $ % & * ! ?)'],
  ];
  return (
    <Stack gap={2}>
      {itens.map(([ok, t]) => (
        <Text key={t} size="xs" c={ok ? 'teal' : 'dimmed'}>
          {ok ? '✓' : '•'} {t}
        </Text>
      ))}
    </Stack>
  );
}

export function Entrar() {
  const { recarregar } = useCidadao();
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const entrar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await api.post('/api/cidadao/login', { login: somenteDigitos(login), senha });
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Stack gap="md">
      <Stack gap={0} ta="center">
        <Title order={3}>Entrar</Title>
        <Text size="sm" c="dimmed">
          Use o número do seu Cartão Nacional de Saúde (CNS)
        </Text>
      </Stack>
      {erro && <Alert color="red">{erro}</Alert>}
      <TextInput label="Cartão SUS (CNS)" placeholder="000 0000 0000 0000" inputMode="numeric" leftSection={<IconId size={16} />} value={mascaraCns(login)} onChange={(e) => setLogin(e.currentTarget.value)} autoComplete="username" />
      <PasswordInput label="Senha" leftSection={<IconLock size={16} />} value={senha} onChange={(e) => setSenha(e.currentTarget.value)} autoComplete="current-password" onKeyDown={(e) => e.key === 'Enter' && entrar()} />
      <Button size="md" onClick={entrar} loading={enviando} disabled={somenteDigitos(login).length < 11 || !senha}>
        Entrar
      </Button>
      <Group justify="space-between">
        <Anchor component={Link} to="/cidadao/recuperar" size="sm">
          Esqueci minha senha
        </Anchor>
        <Anchor component={Link} to="/cidadao/solicitar" size="sm" fw={600}>
          Solicitar acesso
        </Anchor>
      </Group>
    </Stack>
  );
}

export function SolicitarAcesso() {
  const navegar = useNavigate();
  const { dados: info } = useDados<any>('/api/cidadao/publico/info');
  const [passo, setPasso] = useState(0);
  const [f, setF] = useState({ cns: '', cpf: '', nome: '', nascimento: '', nomeMae: '', email: '', celular: '', senha: '', confirmar: '', aceite: false });
  const [enviando, setEnviando] = useState(false);
  const alterar = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }));
  const cnsOk = validarCns(somenteDigitos(f.cns));
  const cpfOk = !f.cpf || validarCpf(somenteDigitos(f.cpf));
  const dadosOk = cnsOk && cpfOk && f.nome.trim().length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(f.nascimento) && (somenteDigitos(f.celular).length >= 10 || /@/.test(f.email));
  const senhaOk = !senhaAtendePolitica(f.senha) && f.senha === f.confirmar;
  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await api.post('/api/cidadao/solicitar-acesso', {
        cns: somenteDigitos(f.cns),
        cpf: somenteDigitos(f.cpf) || null,
        nome: f.nome,
        nascimento: f.nascimento,
        nomeMae: f.nomeMae || null,
        email: f.email || null,
        celular: somenteDigitos(f.celular) || null,
        senha: f.senha,
        aceiteTermos: f.aceite,
      });
      avisoOk(r.mensagem);
      navegar('/cidadao');
    } catch (e) {
      avisoErro(e);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Stack gap="md">
      <Title order={3} ta="center">
        Solicitar acesso
      </Title>
      <Stepper active={passo} size="xs" allowNextStepsSelect={false}>
        <Stepper.Step label="Dados">
          <Stack gap="xs" mt="sm">
            <TextInput label="Cartão SUS (CNS)" required inputMode="numeric" value={mascaraCns(f.cns)} onChange={(e) => alterar('cns', e.currentTarget.value)} error={f.cns && !cnsOk ? 'CNS inválido' : null} />
            <TextInput label="CPF (opcional)" inputMode="numeric" value={f.cpf} onChange={(e) => alterar('cpf', e.currentTarget.value)} error={!cpfOk ? 'CPF inválido' : null} />
            <TextInput label="Nome completo" required value={f.nome} onChange={(e) => alterar('nome', e.currentTarget.value.toUpperCase())} />
            <TextInput label="Data de nascimento" required type="date" value={f.nascimento} onChange={(e) => alterar('nascimento', e.currentTarget.value)} />
            <TextInput label="Nome da mãe" value={f.nomeMae} onChange={(e) => alterar('nomeMae', e.currentTarget.value.toUpperCase())} />
            <TextInput label="Celular" inputMode="tel" value={f.celular} onChange={(e) => alterar('celular', e.currentTarget.value)} description="Para avisos de consultas e recuperação de senha" />
            <TextInput label="E-mail" type="email" value={f.email} onChange={(e) => alterar('email', e.currentTarget.value)} />
            <Button onClick={() => setPasso(1)} disabled={!dadosOk}>
              Continuar
            </Button>
          </Stack>
        </Stepper.Step>
        <Stepper.Step label="Senha">
          <Stack gap="xs" mt="sm">
            <PasswordInput label="Crie uma senha" value={f.senha} onChange={(e) => alterar('senha', e.currentTarget.value)} />
            <RequisitosSenha senha={f.senha} />
            <PasswordInput label="Repita a senha" value={f.confirmar} onChange={(e) => alterar('confirmar', e.currentTarget.value)} error={f.confirmar && f.confirmar !== f.senha ? 'As senhas não conferem' : null} />
            <Group grow>
              <Button variant="default" onClick={() => setPasso(0)}>
                Voltar
              </Button>
              <Button onClick={() => setPasso(2)} disabled={!senhaOk}>
                Continuar
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>
        <Stepper.Step label="Termos">
          <Stack gap="xs" mt="sm">
            <Group gap="xs">
              <IconShieldCheck size={18} />
              <Text fw={600} size="sm">
                Termos de uso e privacidade (LGPD)
              </Text>
            </Group>
            <ScrollArea h={180} type="always">
              <Text size="sm">{info?.termos}</Text>
            </ScrollArea>
            <Checkbox checked={f.aceite} onChange={(e) => alterar('aceite', e.currentTarget.checked)} label="Li e aceito os termos de uso e autorizo o tratamento dos meus dados para os serviços de saúde." />
            <Alert color="blue" variant="light">
              O acesso será liberado após conferência dos seus dados pela unidade de saúde. Você receberá um aviso por SMS ou e-mail.
            </Alert>
            <Group grow>
              <Button variant="default" onClick={() => setPasso(1)}>
                Voltar
              </Button>
              <Button onClick={enviar} loading={enviando} disabled={!f.aceite}>
                Enviar solicitação
              </Button>
            </Group>
          </Stack>
        </Stepper.Step>
      </Stepper>
      <Anchor component={Link} to="/cidadao" size="sm" ta="center">
        Já tenho acesso
      </Anchor>
    </Stack>
  );
}

export function RecuperarSenha() {
  const navegar = useNavigate();
  const [etapa, setEtapa] = useState<'dados' | 'codigo'>('dados');
  const [login, setLogin] = useState('');
  const [nascimento, setNascimento] = useState('');
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const solicitar = async () => {
    setEnviando(true);
    try {
      const r = await api.post('/api/cidadao/recuperar-senha', { login: somenteDigitos(login), nascimento });
      avisoOk(r.mensagem);
      setEtapa('codigo');
    } catch (e) {
      avisoErro(e);
    } finally {
      setEnviando(false);
    }
  };
  const redefinir = async () => {
    setEnviando(true);
    try {
      await api.post('/api/cidadao/redefinir-senha', { login: somenteDigitos(login), codigo, novaSenha: senha });
      avisoOk('Senha redefinida. Entre com a nova senha.');
      navegar('/cidadao');
    } catch (e) {
      avisoErro(e);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Stack gap="md">
      <Title order={3} ta="center">
        Recuperar senha
      </Title>
      {etapa === 'dados' ? (
        <>
          <TextInput label="Cartão SUS (CNS)" inputMode="numeric" value={mascaraCns(login)} onChange={(e) => setLogin(e.currentTarget.value)} />
          <TextInput label="Data de nascimento" type="date" value={nascimento} onChange={(e) => setNascimento(e.currentTarget.value)} />
          <Button onClick={solicitar} loading={enviando} disabled={somenteDigitos(login).length < 11 || !nascimento}>
            Enviar código
          </Button>
        </>
      ) : (
        <>
          <Text size="sm">Digite o código de 6 números enviado por SMS/e-mail e a nova senha. A recuperação também desbloqueia o acesso.</Text>
          <Group justify="center">
            <PinInput length={6} type="number" value={codigo} onChange={setCodigo} oneTimeCode />
          </Group>
          <PasswordInput label="Nova senha" value={senha} onChange={(e) => setSenha(e.currentTarget.value)} />
          <RequisitosSenha senha={senha} />
          <Button onClick={redefinir} loading={enviando} disabled={codigo.length !== 6 || !!senhaAtendePolitica(senha)}>
            Redefinir senha
          </Button>
        </>
      )}
      <Anchor component={Link} to="/cidadao" size="sm" ta="center">
        Voltar para a entrada
      </Anchor>
    </Stack>
  );
}

export function CaixaEntrada({ children }: { children: React.ReactNode }) {
  return (
    <Paper withBorder radius="lg" p="lg" shadow="sm">
      {children}
    </Paper>
  );
}
