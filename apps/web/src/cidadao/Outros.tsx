// Demais telas do aplicativo do cidadão: unidades e mapa, mensagens, família e dependentes (TR 1.2.41.6),
// sala de teleatendimento, avaliação/ouvidoria e dados pessoais com preferências de aviso (TR 1.2.41.7.4).
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Group, Modal, PasswordInput, Rating, ScrollArea, SegmentedControl, Select, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconBell, IconMapPin, IconPhone, IconPlus, IconSend, IconUserPlus, IconVideo } from '@tabler/icons-react';
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { senhaAtendePolitica } from '@compartilhado/validacao';
import { api } from '@/api';
import { RequisitosSenha } from './Acesso';
import { avisoErro, avisoOk, Cartao, Estado, fmtData, fmtDataHora, nomeParentesco, PARENTESCOS, Secao, useCidadao, useDados } from './comum';

export function Unidades() {
  const { dados, erro, carregando } = useDados<any[]>('/api/cidadao/unidades');
  const [modo, setModo] = useState('lista');
  const comCoord = (dados ?? []).filter((u) => u.latitude != null && u.longitude != null);
  const centro: [number, number] = comCoord.length ? [comCoord.reduce((s, u) => s + Number(u.latitude), 0) / comCoord.length, comCoord.reduce((s, u) => s + Number(u.longitude), 0) / comCoord.length] : [-23.3, -47.13];
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Unidades de saúde</Title>
        <SegmentedControl size="xs" value={modo} onChange={setModo} data={[{ value: 'lista', label: 'Lista' }, { value: 'mapa', label: 'Mapa' }]} />
      </Group>
      <Estado erro={erro} carregando={carregando} vazio={!dados?.length}>
        {modo === 'mapa' ? (
          <div style={{ height: 420, borderRadius: 12, overflow: 'hidden' }}>
            <MapContainer center={centro} zoom={12} style={{ height: '100%' }}>
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {comCoord.map((u) => (
                <CircleMarker key={u.id} center={[Number(u.latitude), Number(u.longitude)]} radius={9} pathOptions={{ color: '#1c5aa8', fillOpacity: 0.8 }}>
                  <Popup>
                    <b>{u.nome}</b>
                    <br />
                    {[u.logradouro, u.numero, u.bairro].filter(Boolean).join(', ')}
                    {u.telefone && (
                      <>
                        <br />
                        Tel. {u.telefone}
                      </>
                    )}
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        ) : (
          <Stack gap={6}>
            {dados?.map((u) => (
              <Cartao key={u.id}>
                <Text fw={600} size="sm">
                  {u.nome}
                </Text>
                <Group gap={4} wrap="nowrap" align="flex-start">
                  <IconMapPin size={14} style={{ marginTop: 3 }} />
                  <Text size="xs">{[u.logradouro, u.numero, u.bairro, u.municipio].filter(Boolean).join(', ') || 'Endereço não informado'}</Text>
                </Group>
                {u.telefone && (
                  <Group gap={4}>
                    <IconPhone size={14} />
                    <Anchor size="xs" href={`tel:${u.telefone}`}>
                      {u.telefone}
                    </Anchor>
                  </Group>
                )}
                {u.especialidades && (
                  <Text size="xs" c="dimmed">
                    {u.especialidades}
                  </Text>
                )}
                {u.latitude != null && (
                  <Anchor size="xs" href={`https://www.openstreetmap.org/directions?to=${u.latitude}%2C${u.longitude}`} target="_blank" rel="noopener">
                    Como chegar
                  </Anchor>
                )}
              </Cartao>
            ))}
          </Stack>
        )}
      </Estado>
    </Stack>
  );
}

export function Mensagens() {
  const { recarregar: recarregarSessao } = useCidadao();
  const { dados, erro, carregando } = useDados<any[]>('/api/cidadao/mensagens');
  useEffect(() => {
    const naoLidas = (dados ?? []).filter((m) => !m.lida).map((m) => m.id);
    if (naoLidas.length) void api.post('/api/cidadao/mensagens/lidas', { ids: naoLidas }).then(recarregarSessao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados]);
  return (
    <Stack gap="md">
      <Title order={3}>Mensagens</Title>
      <Estado erro={erro} carregando={carregando} vazio={!dados?.length}>
        <Stack gap={6}>
          {dados?.map((m) => (
            <Cartao key={m.id} cor={m.lida ? undefined : 'blue'}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap={6}>
                  <IconBell size={14} />
                  <Text fw={600} size="sm">
                    {m.assunto ?? 'Aviso'}
                  </Text>
                </Group>
                {!m.lida && <Badge size="xs">nova</Badge>}
              </Group>
              <Text size="sm">{m.texto}</Text>
              <Text size="xs" c="dimmed">
                {fmtDataHora(m.gerada_em)} · {m.paciente}
              </Text>
            </Cartao>
          ))}
        </Stack>
      </Estado>
    </Stack>
  );
}

/** Inclusão de dependentes pelo responsável familiar, mantidos em pré-cadastro (TR 1.2.41.6.1, 1.2.41.6.2). */
export function Familia() {
  const { recarregar: recarregarSessao, setPessoaId } = useCidadao();
  const { dados, erro, carregando, recarregar } = useDados<any>('/api/cidadao/dependentes');
  const { dados: info } = useDados<any>('/api/cidadao/publico/info');
  const [novo, setNovo] = useState(false);
  const [f, setF] = useState({ nome: '', sexo: '', nascimento: '', nomeMae: '', racaCor: '', etnia: '', parentesco: '' });
  const [enviando, setEnviando] = useState(false);
  const etnias = useDados<any[]>(null);
  void etnias;
  void info;
  const salvar = async () => {
    setEnviando(true);
    try {
      const r = await api.post('/api/cidadao/dependentes', { nome: f.nome, sexo: f.sexo, nascimento: f.nascimento, nomeMae: f.nomeMae, racaCor: f.racaCor, parentesco: f.parentesco });
      avisoOk(r.mensagem);
      setNovo(false);
      await recarregar();
      await recarregarSessao();
    } catch (e) {
      avisoErro(e);
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3}>Minha família</Title>
        {dados?.familia?.responsavel && (
          <Button size="xs" leftSection={<IconUserPlus size={14} />} onClick={() => setNovo(true)}>
            Incluir dependente
          </Button>
        )}
      </Group>
      <Estado erro={erro} carregando={carregando}>
        {dados && !dados.familia?.responsavel && (
          <Alert color="blue" variant="light">
            A inclusão de dependentes é feita pelo responsável familiar com a família cadastrada na unidade de saúde ou pelo agente comunitário.
          </Alert>
        )}
        <Stack gap={6}>
          {dados?.membros.map((m: any) => (
            <Cartao key={m.id} cor={m.situacao === 'PRE_CADASTRO' ? 'orange' : 'teal'} onClick={() => setPessoaId(m.id)}>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600} size="sm">
                  {m.nome}
                </Text>
                {m.situacao === 'PRE_CADASTRO' ? <Badge color="orange">Pré-cadastro</Badge> : <Badge variant="light">{m.titular ? 'Titular' : nomeParentesco(m.parentesco)}</Badge>}
              </Group>
              <Text size="xs" c="dimmed">
                Nascimento {fmtData(m.nascimento)} · CNS {m.cns ?? 'não informado'}
              </Text>
              {m.situacao === 'PRE_CADASTRO' && (
                <Text size="xs" c="orange.8" mt={4}>
                  Compareça a uma unidade de saúde com um documento do integrante para validar o cadastro e liberar as funcionalidades.
                </Text>
              )}
            </Cartao>
          ))}
        </Stack>
      </Estado>
      <Modal opened={novo} onClose={() => setNovo(false)} title="Incluir dependente" centered>
        <Stack gap="xs">
          <TextInput label="Nome completo" required value={f.nome} onChange={(e) => setF({ ...f, nome: e.currentTarget.value.toUpperCase() })} />
          <Select label="Sexo" required data={[{ value: 'F', label: 'Feminino' }, { value: 'M', label: 'Masculino' }]} value={f.sexo || null} onChange={(v) => setF({ ...f, sexo: v ?? '' })} />
          <TextInput label="Data de nascimento" type="date" required value={f.nascimento} onChange={(e) => setF({ ...f, nascimento: e.currentTarget.value })} />
          <TextInput label="Nome da mãe" required value={f.nomeMae} onChange={(e) => setF({ ...f, nomeMae: e.currentTarget.value.toUpperCase() })} />
          <Select
            label="Cor da pele (raça/cor)"
            required
            data={[{ value: '01', label: 'Branca' }, { value: '02', label: 'Preta' }, { value: '03', label: 'Parda' }, { value: '04', label: 'Amarela' }, { value: '05', label: 'Indígena' }, { value: '99', label: 'Sem informação' }]}
            value={f.racaCor || null}
            onChange={(v) => setF({ ...f, racaCor: v ?? '' })}
          />
          {f.racaCor === '05' && <TextInput label="Etnia" description="Informe a etnia; a unidade confirmará no cadastro" value={f.etnia} onChange={(e) => setF({ ...f, etnia: e.currentTarget.value })} />}
          <Select label="Grau de parentesco" required data={PARENTESCOS.map(([value, label]) => ({ value, label }))} value={f.parentesco || null} onChange={(v) => setF({ ...f, parentesco: v ?? '' })} />
          <Alert color="orange" variant="light" p="xs">
            O integrante ficará em pré-cadastro até a apresentação de documento na unidade de saúde.
          </Alert>
          <Button onClick={salvar} loading={enviando} disabled={!f.nome || !f.sexo || !f.nascimento || !f.nomeMae || !f.racaCor || !f.parentesco} leftSection={<IconPlus size={14} />}>
            Incluir
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** Sala virtual do teleatendimento: link da videochamada e conversa com o profissional. */
export function Teleatendimento() {
  const { id } = useParams();
  const { dados, erro, carregando, recarregar } = useDados<any>(`/api/cidadao/teleatendimentos/${id}`, [id]);
  const [texto, setTexto] = useState('');
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && recarregar(), 5000);
    return () => clearInterval(t);
  }, [recarregar]);
  useEffect(() => fim.current?.scrollIntoView({ behavior: 'smooth' }), [dados?.mensagens?.length]);
  const enviar = async () => {
    if (!texto.trim()) return;
    try {
      await api.post(`/api/cidadao/teleatendimentos/${id}/mensagens`, { texto });
      setTexto('');
      await recarregar();
    } catch (e) {
      avisoErro(e);
    }
  };
  return (
    <Estado erro={erro} carregando={carregando && !dados}>
      {dados && (
        <Stack gap="sm">
          <Title order={3}>Teleatendimento</Title>
          <Cartao cor="teal">
            <Text fw={600}>{dados.agendamento.especialidade}</Text>
            <Text size="sm">
              {fmtData(dados.agendamento.data)} às {dados.agendamento.hora} — {dados.agendamento.profissional}
            </Text>
            <Button component="a" href={dados.sala.link_video} target="_blank" rel="noopener" mt="xs" color="teal" leftSection={<IconVideo size={16} />} disabled={dados.sala.situacao === 'ENCERRADO'}>
              Entrar na videochamada
            </Button>
            <Text size="xs" c="dimmed" mt={4}>
              Situação da sala: {dados.sala.situacao === 'AGUARDANDO' ? 'aguardando o profissional' : dados.sala.situacao === 'EM_ANDAMENTO' ? 'em andamento' : 'encerrada'}
            </Text>
          </Cartao>
          <Secao titulo="Conversa">
            <ScrollArea h={260} type="auto">
              <Stack gap={6}>
                {!dados.mensagens.length && <Text size="sm" c="dimmed">Envie uma mensagem ao profissional enquanto aguarda.</Text>}
                {dados.mensagens.map((m: any) => (
                  <Group key={m.id} justify={m.autor === 'PACIENTE' ? 'flex-end' : 'flex-start'}>
                    <Stack gap={0} p="xs" maw="80%" style={{ borderRadius: 10, background: m.autor === 'PACIENTE' ? 'var(--mantine-color-blue-1)' : 'var(--mantine-color-gray-1)' }}>
                      <Text size="sm">{m.texto}</Text>
                      <Text size="10px" c="dimmed" ta="right">
                        {m.autor === 'PACIENTE' ? 'Você' : 'Profissional'} · {fmtDataHora(m.data_hora)}
                      </Text>
                    </Stack>
                  </Group>
                ))}
                <div ref={fim} />
              </Stack>
            </ScrollArea>
            <Group gap="xs" wrap="nowrap">
              <TextInput style={{ flex: 1 }} placeholder="Escreva sua mensagem" value={texto} onChange={(e) => setTexto(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && enviar()} disabled={dados.sala.situacao === 'ENCERRADO'} />
              <Button onClick={enviar} disabled={!texto.trim()}>
                <IconSend size={16} />
              </Button>
            </Group>
          </Secao>
        </Stack>
      )}
    </Estado>
  );
}

export function ListaTeleatendimentos() {
  const { dados, erro, carregando } = useDados<any[]>('/api/cidadao/teleatendimentos');
  return (
    <Stack gap="md">
      <Title order={3}>Teleconsultas</Title>
      <Estado erro={erro} carregando={carregando} vazio={!dados?.length}>
        <Stack gap={6}>
          {dados?.map((t) => (
            <Cartao key={t.id} cor="teal" onClick={() => (window.location.href = `/cidadao/teleatendimento/${t.id}`)}>
              <Text fw={600} size="sm">
                {t.especialidade} — {t.profissional}
              </Text>
              <Text size="xs">
                {fmtData(t.data)} às {t.hora} · {t.paciente}
              </Text>
            </Cartao>
          ))}
        </Stack>
      </Estado>
    </Stack>
  );
}

export function Ouvidoria() {
  const [busca] = useSearchParams();
  const agendamentoId = busca.get('agendamento');
  const { dados, recarregar } = useDados<any[]>('/api/cidadao/manifestacoes');
  const { dados: unidades } = useDados<any[]>('/api/cidadao/unidades');
  const [tipo, setTipo] = useState(agendamentoId ? 'AVALIACAO' : 'SUGESTAO');
  const [nota, setNota] = useState(5);
  const [texto, setTexto] = useState('');
  const [unidadeId, setUnidadeId] = useState<string | null>(null);
  const enviar = async () => {
    try {
      const r = await api.post('/api/cidadao/manifestacoes', { tipo, texto, nota: tipo === 'AVALIACAO' ? nota : null, unidadeId: unidadeId ? Number(unidadeId) : null, agendamentoId: agendamentoId ? Number(agendamentoId) : null });
      avisoOk(`Manifestação registrada. Protocolo ${r.protocolo}.`);
      setTexto('');
      await recarregar();
    } catch (e) {
      avisoErro(e);
    }
  };
  return (
    <Stack gap="md">
      <Title order={3}>Avaliação e ouvidoria</Title>
      <Cartao>
        <Stack gap="xs">
          <Select label="Tipo" data={[{ value: 'AVALIACAO', label: 'Avaliar atendimento' }, { value: 'ELOGIO', label: 'Elogio' }, { value: 'SUGESTAO', label: 'Sugestão' }, { value: 'RECLAMACAO', label: 'Reclamação' }, { value: 'SOLICITACAO', label: 'Solicitação' }]} value={tipo} onChange={(v) => setTipo(v ?? 'SUGESTAO')} />
          {tipo === 'AVALIACAO' && (
            <Group>
              <Text size="sm">Nota</Text>
              <Rating value={nota} onChange={setNota} size="lg" />
            </Group>
          )}
          <Select label="Unidade (opcional)" clearable searchable data={(unidades ?? []).map((u) => ({ value: String(u.id), label: u.nome }))} value={unidadeId} onChange={setUnidadeId} />
          <Textarea label="Mensagem" minRows={3} value={texto} onChange={(e) => setTexto(e.currentTarget.value)} />
          <Button onClick={enviar} disabled={texto.trim().length < 3}>
            Enviar
          </Button>
        </Stack>
      </Cartao>
      {(dados ?? []).map((m) => (
        <Cartao key={m.id} cor={m.resposta ? 'teal' : 'gray'}>
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              Protocolo {m.protocolo}
            </Text>
            <Badge variant="light">{m.situacao.toLowerCase()}</Badge>
          </Group>
          <Text size="sm">{m.texto}</Text>
          {m.resposta && (
            <Alert color="teal" variant="light" p="xs" mt={4}>
              Resposta: {m.resposta}
            </Alert>
          )}
        </Cartao>
      ))}
    </Stack>
  );
}

export function MeusDados() {
  const { sessao, recarregar } = useCidadao();
  const c = sessao?.conta;
  const [contato, setContato] = useState({ celular: c?.pessoa_celular ?? c?.celular ?? '', email: c?.pessoa_email ?? c?.email ?? '', notificarSms: !!c?.notificar_sms, notificarEmail: !!c?.notificar_email, notificarApp: c?.notificar_app !== false });
  const [senhas, setSenhas] = useState({ senhaAtual: '', novaSenha: '' });
  const { dados: info } = useDados<any>('/api/cidadao/publico/info');
  const [termos, setTermos] = useState(false);
  const salvar = async () => {
    try {
      await api.put('/api/cidadao/contato', contato);
      avisoOk('Dados atualizados.');
      await recarregar();
    } catch (e) {
      avisoErro(e);
    }
  };
  const trocar = async () => {
    try {
      await api.post('/api/cidadao/trocar-senha', senhas);
      avisoOk('Senha alterada.');
      setSenhas({ senhaAtual: '', novaSenha: '' });
    } catch (e) {
      avisoErro(e);
    }
  };
  if (!c) return null;
  return (
    <Stack gap="md">
      <Title order={3}>Meus dados</Title>
      <Cartao>
        <Text fw={600}>{c.nome}</Text>
        <Text size="sm">CNS {c.cns} · CPF {c.cpf ?? '-'}</Text>
        <Text size="sm">Nascimento {fmtData(c.nascimento)}</Text>
        <Text size="sm" c="dimmed">
          Unidade de referência: {c.unidade_referencia ?? '-'}
        </Text>
      </Cartao>
      <Secao titulo="Contato e avisos">
        <TextInput label="Celular" value={contato.celular} onChange={(e) => setContato({ ...contato, celular: e.currentTarget.value })} />
        <TextInput label="E-mail" value={contato.email} onChange={(e) => setContato({ ...contato, email: e.currentTarget.value })} />
        <Switch label="Receber avisos por SMS" checked={contato.notificarSms} onChange={(e) => setContato({ ...contato, notificarSms: e.currentTarget.checked })} />
        <Switch label="Receber avisos por e-mail" checked={contato.notificarEmail} onChange={(e) => setContato({ ...contato, notificarEmail: e.currentTarget.checked })} />
        <Switch label="Receber avisos no aplicativo" checked={contato.notificarApp} onChange={(e) => setContato({ ...contato, notificarApp: e.currentTarget.checked })} />
        <Button onClick={salvar}>Salvar</Button>
      </Secao>
      <Secao titulo="Alterar senha">
        <PasswordInput label="Senha atual" value={senhas.senhaAtual} onChange={(e) => setSenhas({ ...senhas, senhaAtual: e.currentTarget.value })} />
        <PasswordInput label="Nova senha" value={senhas.novaSenha} onChange={(e) => setSenhas({ ...senhas, novaSenha: e.currentTarget.value })} />
        <RequisitosSenha senha={senhas.novaSenha} />
        <Button variant="light" onClick={trocar} disabled={!senhas.senhaAtual || !!senhaAtendePolitica(senhas.novaSenha)}>
          Alterar senha
        </Button>
      </Secao>
      <Anchor size="sm" onClick={() => setTermos(true)}>
        Termos de uso e privacidade (aceitos na versão {c.termos_versao})
      </Anchor>
      <Modal opened={termos} onClose={() => setTermos(false)} title="Termos de uso e privacidade">
        <Text size="sm">{info?.termos}</Text>
      </Modal>
    </Stack>
  );
}
