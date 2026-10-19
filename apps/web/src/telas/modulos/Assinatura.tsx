// Assinatura eletrônica padronizada para todos os módulos (TR 1.1.1.44 a 1.1.1.56, 1.1.2.1.63):
// documentos emitidos, assinatura individual ou em lote, solicitações e repositório de certificados.
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Checkbox, FileInput, Group, Modal, Paper, PasswordInput, Radio, ScrollArea, Select, Stack, Switch, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { IconCertificate, IconSignature } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { api } from '@/api';
import { useTituloJanela } from '@/shell/Janelas';
import { confirmar, pedirTexto } from '@/genericos/dialogos';
import { fmtDataHora, notificarErro, notificarOk, SelecaoRef, TabelaSimples } from '@/componentes/comum';
import { registrarTela } from '../registro';

type Modalidade = 'BASICA' | 'AVANCADA' | 'QUALIFICADA';
const MODALIDADES: { value: Modalidade; label: string }[] = [
  { value: 'BASICA', label: 'Básica (operador autenticado)' },
  { value: 'AVANCADA', label: 'Avançada (certificado individual do sistema)' },
  { value: 'QUALIFICADA', label: 'Qualificada (ICP-Brasil A1)' },
];
const TIPOS_CERT: Record<string, string> = { A1_OPERADOR: 'A1 do operador', A1_ENTIDADE: 'A1 da contratante', AVANCADA: 'Avançada (sistema)' };

const base64 = (f: File) =>
  new Promise<string>((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = erro;
    r.readAsDataURL(f);
  });

/** Diálogo de assinatura: mostra o documento (ou a lista em lote), a modalidade e o certificado conferido (TR 1.1.1.51, 1.1.1.56.5, 1.1.1.56.6). */
export function DialogoAssinatura({ codigos, titulos, aoFechar, executar }: { codigos: string[]; titulos?: string[]; aoFechar: (ok: boolean) => void; executar?: (p: Record<string, unknown>) => Promise<unknown> }) {
  const [modalidade, setModalidade] = useState<Modalidade>('AVANCADA');
  const [certs, setCerts] = useState<any[]>([]);
  const [certId, setCertId] = useState<string | null>(null);
  const [origem, setOrigem] = useState<'repositorio' | 'local'>('repositorio');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [conferido, setConferido] = useState<any>(null);
  const [assinando, setAssinando] = useState(false);
  useEffect(() => {
    api.get('/api/assinatura/certificados').then(setCerts).catch(notificarErro);
  }, []);
  const compativeis = certs.filter((c) => (modalidade === 'AVANCADA' ? c.tipo === 'AVANCADA' : modalidade === 'QUALIFICADA' ? c.tipo !== 'AVANCADA' : false));
  useEffect(() => setCertId(compativeis.find((c) => !c.vencido) ? String(compativeis.find((c) => !c.vencido).id) : null), [modalidade, certs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function conferir() {
    if (!arquivo) return;
    try {
      setConferido(await api.post('/api/assinatura/certificados/conferir', { pfx: await base64(arquivo), senha }));
    } catch (e) {
      notificarErro(e);
    }
  }
  async function assinar() {
    setAssinando(true);
    try {
      const certificadoLocal = modalidade === 'QUALIFICADA' && origem === 'local' && arquivo ? { pfx: await base64(arquivo), senha } : null;
      const corpo = { modalidade, certificadoId: certId ? Number(certId) : null, certificadoLocal };
      if (executar) await executar(corpo);
      else await api.post('/api/assinatura/assinar', { codigos, ...corpo });
      notificarOk(`${codigos.length} documento(s) assinado(s).`);
      aoFechar(true);
    } catch (e) {
      notificarErro(e);
    } finally {
      setAssinando(false);
    }
  }
  return (
    <Modal opened onClose={() => aoFechar(false)} title="Assinatura eletrônica" size={codigos.length === 1 ? 'xl' : 'lg'}>
      <Stack gap="xs">
        {codigos.length === 1 ? (
          <iframe title="Documento" src={`/api/publico/validar/${codigos[0]}/arquivo`} style={{ width: '100%', height: 420, border: '1px solid #ddd' }} />
        ) : (
          <Paper withBorder p="xs">
            <Text size="sm" fw={600}>
              Documentos a assinar em lote ({codigos.length})
            </Text>
            {codigos.map((c, i) => (
              <Group key={c} justify="space-between">
                <Text size="xs">{titulos?.[i] ?? c}</Text>
                <Button size="compact-xs" variant="subtle" component="a" href={`/api/publico/validar/${c}/arquivo`} target="_blank">
                  Visualizar
                </Button>
              </Group>
            ))}
          </Paper>
        )}
        <Select label="Modalidade (Lei 14.063/2020)" data={MODALIDADES} value={modalidade} onChange={(v) => setModalidade((v as Modalidade) ?? 'AVANCADA')} />
        {modalidade === 'QUALIFICADA' && (
          <Radio.Group value={origem} onChange={(v) => setOrigem(v as any)}>
            <Group>
              <Radio value="repositorio" label="Certificado do repositório" />
              <Radio value="local" label="Certificado A1 da minha máquina" />
            </Group>
          </Radio.Group>
        )}
        {modalidade !== 'BASICA' && (origem === 'repositorio' || modalidade === 'AVANCADA') && (
          <Select
            label="Certificado"
            data={compativeis.map((c) => ({ value: String(c.id), label: `${c.titular} · ${TIPOS_CERT[c.tipo] ?? c.tipo} · válido até ${dayjs(c.validade_fim).format('DD/MM/YYYY')}${c.vencido ? ' (VENCIDO)' : ''}`, disabled: c.vencido }))}
            value={certId}
            onChange={setCertId}
            nothingFoundMessage={modalidade === 'AVANCADA' ? 'Crie seu certificado avançado na aba Certificados' : 'Importe um certificado A1'}
          />
        )}
        {modalidade === 'QUALIFICADA' && origem === 'local' && (
          <Group align="flex-end" grow>
            <FileInput label="Arquivo .pfx / .p12" accept=".pfx,.p12" value={arquivo} onChange={setArquivo} />
            <PasswordInput label="Senha do certificado" value={senha} onChange={(e) => setSenha(e.currentTarget.value)} />
            <Button variant="light" onClick={() => void conferir()} disabled={!arquivo}>
              Conferir
            </Button>
          </Group>
        )}
        {conferido && (
          <Alert color={conferido.vencido ? 'red' : 'teal'} py={6}>
            {conferido.titular} · emitido por {conferido.emissor} · válido até {dayjs(conferido.fim).format('DD/MM/YYYY')}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button leftSection={<IconSignature size={16} />} loading={assinando} onClick={() => void assinar()}>
            Assinar
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function AbaDocumentos() {
  const [busca, setBusca] = useState('');
  const [docs, setDocs] = useState<any[]>([]);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [assinar, setAssinar] = useState<string[] | null>(null);
  const carregar = () => api.get('/api/assinatura/documentos', { busca }).then(setDocs).catch(notificarErro);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), []);
  async function abrirAssinatura(codigos: string[]) {
    for (const c of codigos) {
      const r = await api.get(`/api/assinatura/documentos/${c}/ja-assinado`);
      if (r.jaAssinado && !(await confirmar('Documento já assinado', `Você já assinou o documento ${c}. Deseja assinar novamente?`, 'Assinar novamente'))) return;
    }
    setAssinar(codigos);
  }
  return (
    <Stack gap="xs">
      <Group>
        <TextInput placeholder="Título ou código" value={busca} onChange={(e) => setBusca(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && void carregar()} />
        <Button variant="light" onClick={() => void carregar()}>
          Pesquisar
        </Button>
        <Button disabled={!marcados.length} leftSection={<IconSignature size={16} />} onClick={() => void abrirAssinatura(marcados)}>
          Assinar selecionados ({marcados.length})
        </Button>
      </Group>
      <ScrollArea h="calc(100vh - 300px)">
        <Table fz="xs" striped highlightOnHover stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={30} />
              <Table.Th>Emitido em</Table.Th>
              <Table.Th>Documento</Table.Th>
              <Table.Th>Código</Table.Th>
              <Table.Th>Assinaturas</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {docs.map((d) => (
              <Table.Tr key={d.codigo}>
                <Table.Td>
                  <Checkbox size="xs" checked={marcados.includes(d.codigo)} onChange={(e) => setMarcados(e.currentTarget.checked ? [...marcados, d.codigo] : marcados.filter((x) => x !== d.codigo))} />
                </Table.Td>
                <Table.Td>{fmtDataHora(d.emitido_em)}</Table.Td>
                <Table.Td>{d.titulo}</Table.Td>
                <Table.Td>{d.codigo}</Table.Td>
                <Table.Td>
                  {(d.assinaturas ?? []).map((a: any, i: number) => (
                    <Badge key={i} size="xs" color="teal" mr={4}>
                      {a.signatario.split(' ')[0]} · {a.modalidade}
                    </Badge>
                  ))}
                </Table.Td>
                <Table.Td>
                  <Button size="compact-xs" variant="light" onClick={() => void abrirAssinatura([d.codigo])}>
                    Assinar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
      {assinar && <DialogoAssinatura codigos={assinar} titulos={assinar.map((c) => docs.find((d) => d.codigo === c)?.titulo)} aoFechar={(ok) => (setAssinar(null), ok && (setMarcados([]), void carregar()))} />}
    </Stack>
  );
}

function AbaPendentes() {
  const [lista, setLista] = useState<any[]>([]);
  const [respondendo, setRespondendo] = useState<any>(null);
  const carregar = () => api.get('/api/assinatura/solicitacoes/pendentes').then(setLista).catch(notificarErro);
  useEffect(() => void carregar(), []);
  async function rejeitar(s: any) {
    const ja = (s.documentos ?? []).some((d: any) => d.ja_assinado);
    const motivo = await pedirTexto('Rejeitar solicitação', ja ? 'Motivo (documento já assinado por você anteriormente)' : 'Motivo da rejeição');
    if (!motivo) return;
    await api.post(`/api/assinatura/solicitacoes/${s.id}/responder`, { acao: 'REJEITAR', motivo }).then(() => (notificarOk('Solicitação rejeitada.'), carregar())).catch(notificarErro);
  }
  return (
    <Stack gap="xs">
      {lista.map((s) => (
        <Paper key={s.id} withBorder p="sm">
          <Group justify="space-between">
            <div>
              <Text fw={600}>{s.titulo}</Text>
              <Text size="xs" c="dimmed">
                Solicitado por {s.solicitante} em {fmtDataHora(s.criada_em)} · {s.modo === 'SEQUENCIAL' ? 'assinatura sequencial' : 'assinatura unificada'} · modalidade {s.modalidade}
              </Text>
            </div>
            <Group gap="xs">
              <Button size="xs" variant="light" color="red" onClick={() => void rejeitar(s)}>
                Rejeitar
              </Button>
              <Button size="xs" leftSection={<IconSignature size={14} />} onClick={() => setRespondendo(s)}>
                Assinar
              </Button>
            </Group>
          </Group>
          {(s.documentos ?? []).map((d: any) => (
            <Group key={d.codigo} gap="xs">
              <Text size="xs">• {d.titulo}</Text>
              {d.ja_assinado && (
                <Badge size="xs" color="orange">
                  você já assinou este documento
                </Badge>
              )}
            </Group>
          ))}
        </Paper>
      ))}
      {!lista.length && <Text c="dimmed">Nenhuma solicitação de assinatura pendente.</Text>}
      {respondendo && (
        <DialogoAssinatura
          codigos={(respondendo.documentos ?? []).map((d: any) => d.codigo)}
          titulos={(respondendo.documentos ?? []).map((d: any) => d.titulo)}
          executar={(p) => api.post(`/api/assinatura/solicitacoes/${respondendo.id}/responder`, { acao: 'ASSINAR', ...p })}
          aoFechar={(ok) => (setRespondendo(null), ok && void carregar())}
        />
      )}
    </Stack>
  );
}

function AbaSolicitacoes() {
  const [lista, setLista] = useState<any[]>([]);
  const [nova, setNova] = useState(false);
  const [f, setF] = useState<{ titulo: string; modo: string; notificar: boolean; codigos: string; signatarios: (number | null)[] }>({ titulo: '', modo: 'SEQUENCIAL', notificar: true, codigos: '', signatarios: [null] });
  const carregar = () => api.get('/api/assinatura/solicitacoes/minhas').then(setLista).catch(notificarErro);
  useEffect(() => void carregar(), []);
  async function criar() {
    try {
      await api.post('/api/assinatura/solicitacoes', {
        titulo: f.titulo,
        modo: f.modo,
        notificarConclusao: f.notificar,
        documentos: f.codigos.split(/[\s,;]+/).filter(Boolean),
        signatarios: f.signatarios.filter(Boolean).map((operadorId) => ({ operadorId })),
      });
      notificarOk('Solicitação enviada aos signatários.');
      setNova(false);
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack gap="xs">
      <Group>
        <Button onClick={() => setNova(true)}>Nova solicitação de assinatura</Button>
      </Group>
      <TabelaSimples
        linhas={lista}
        colunas={[
          { titulo: 'Criada em', valor: (s: any) => fmtDataHora(s.criada_em) },
          { titulo: 'Título', valor: (s: any) => s.titulo },
          { titulo: 'Modo', valor: (s: any) => s.modo },
          { titulo: 'Documentos', valor: (s: any) => (s.documentos ?? []).length },
          { titulo: 'Signatários', valor: (s: any) => (s.signatarios ?? []).map((g: any) => `${g.ordem}. ${g.nome} (${g.situacao}${g.motivo ? ': ' + g.motivo : ''})`).join(' · ') },
          { titulo: 'Situação', valor: (s: any) => <Badge size="sm" color={s.situacao === 'CONCLUIDA' ? 'teal' : s.situacao === 'REJEITADA' ? 'red' : 'blue'}>{s.situacao}</Badge> },
        ]}
      />
      <Modal opened={nova} onClose={() => setNova(false)} title="Nova solicitação de assinatura" size="lg">
        <Stack gap="xs">
          <TextInput label="Título" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.currentTarget.value })} />
          <TextInput label="Códigos dos documentos (separados por vírgula)" value={f.codigos} onChange={(e) => setF({ ...f, codigos: e.currentTarget.value })} />
          <Select label="Execução" data={[{ value: 'SEQUENCIAL', label: 'Sequencial (um após o outro)' }, { value: 'UNIFICADA', label: 'Unificada (todos ao mesmo tempo)' }]} value={f.modo} onChange={(v) => setF({ ...f, modo: v ?? 'SEQUENCIAL' })} />
          {f.signatarios.map((s, i) => (
            <SelecaoRef key={i} entidade="operador" rotulo={`Signatário ${i + 1}`} valor={s} aoMudar={(v) => setF({ ...f, signatarios: f.signatarios.map((x, j) => (j === i ? v : x)) })} />
          ))}
          <Button variant="subtle" size="xs" onClick={() => setF({ ...f, signatarios: [...f.signatarios, null] })}>
            Adicionar signatário
          </Button>
          <Switch label="Receber notificação quando todos assinarem" checked={f.notificar} onChange={(e) => setF({ ...f, notificar: e.currentTarget.checked })} />
          <Group justify="flex-end">
            <Button onClick={() => void criar()} disabled={!f.titulo || !f.codigos || !f.signatarios.some(Boolean)}>
              Enviar
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function AbaCertificados() {
  const [certs, setCerts] = useState<any[]>([]);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [entidade, setEntidade] = useState(false);
  const carregar = () => api.get('/api/assinatura/certificados').then(setCerts).catch(notificarErro);
  useEffect(() => void carregar(), []);
  async function importar() {
    if (!arquivo) return;
    try {
      await api.post('/api/assinatura/certificados/importar', { pfx: await base64(arquivo), senha, entidade });
      notificarOk('Certificado armazenado no repositório (cifrado).');
      setArquivo(null);
      setSenha('');
      void carregar();
    } catch (e) {
      notificarErro(e);
    }
  }
  return (
    <Stack gap="sm" maw={900}>
      <TabelaSimples
        linhas={certs}
        vazio="Nenhum certificado disponível."
        colunas={[
          { titulo: 'Titular', valor: (c: any) => c.titular },
          { titulo: 'Tipo', valor: (c: any) => TIPOS_CERT[c.tipo] ?? c.tipo },
          { titulo: 'Emissor', valor: (c: any) => c.emissor },
          {
            titulo: 'Validade',
            valor: (c: any) => (
              <Badge size="sm" color={c.vencido ? 'red' : c.a_vencer ? 'orange' : 'teal'}>
                {c.vencido ? 'VENCIDO em ' : 'até '}
                {dayjs(c.validade_fim).format('DD/MM/YYYY')}
              </Badge>
            ),
          },
        ]}
      />
      <Paper withBorder p="sm">
        <Text fw={600} size="sm" mb="xs">
          Certificado de assinatura avançada
        </Text>
        <Text size="xs" c="dimmed" mb="xs">
          Certificado individual e exclusivo, emitido pelo sistema para o operador, válido por 3 anos.
        </Text>
        <Button leftSection={<IconCertificate size={16} />} variant="light" onClick={() => api.post('/api/assinatura/certificados/avancado').then(() => (notificarOk('Certificado criado.'), carregar())).catch(notificarErro)}>
          Criar meu certificado avançado
        </Button>
      </Paper>
      <Paper withBorder p="sm">
        <Text fw={600} size="sm" mb="xs">
          Importar certificado ICP-Brasil A1
        </Text>
        <Group align="flex-end" grow>
          <FileInput label="Arquivo .pfx / .p12" accept=".pfx,.p12" value={arquivo} onChange={setArquivo} />
          <PasswordInput label="Senha" value={senha} onChange={(e) => setSenha(e.currentTarget.value)} />
        </Group>
        <Group mt="xs" justify="space-between">
          <Checkbox label="Certificado da contratante (uso compartilhado por operadores autorizados)" checked={entidade} onChange={(e) => setEntidade(e.currentTarget.checked)} />
          <Button onClick={() => void importar()} disabled={!arquivo}>
            Importar
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}

function TelaAssinaturas() {
  useTituloJanela('Assinatura eletrônica');
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Assinatura eletrônica de documentos</Title>
      <Tabs defaultValue="documentos" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="documentos">Meus documentos emitidos</Tabs.Tab>
          <Tabs.Tab value="pendentes">Solicitações para mim</Tabs.Tab>
          <Tabs.Tab value="minhas">Solicitações que enviei</Tabs.Tab>
          <Tabs.Tab value="certificados">Certificados</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="documentos" pt="sm">
          <AbaDocumentos />
        </Tabs.Panel>
        <Tabs.Panel value="pendentes" pt="sm">
          <AbaPendentes />
        </Tabs.Panel>
        <Tabs.Panel value="minhas" pt="sm">
          <AbaSolicitacoes />
        </Tabs.Panel>
        <Tabs.Panel value="certificados" pt="sm">
          <AbaCertificados />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

registrarTela({
  id: 'assinaturas',
  titulo: 'Assinatura eletrônica',
  menu: 'Administração/Assinatura digital',
  padrao: '/t/assinaturas',
  palavras: ['assinar', 'certificado', 'icp-brasil', 'e-cpf', 'atestado', 'receita'],
  ordem: 1,
  render: () => <TelaAssinaturas />,
});
