// Telas de administração da plataforma.
import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Group,
  JsonInput,
  Modal,
  MultiSelect,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import { api } from '@/api';
import { confirmar, pedirTexto } from '@/genericos/dialogos';
import { registrarExtensaoFormulario } from '@/genericos/Formulario';
import { TrocarSenha } from '@/auth/Login';
import { useTituloJanela } from '@/shell/Janelas';
import { OPCOES_FORMATO } from '@/tipos';
import { registrarTela } from './registro';

const fmtData = (v: any) => (v ? new Date(v).toLocaleString('pt-BR') : '');

function Sessoes() {
  useTituloJanela('Sessões ativas');
  const [linhas, setLinhas] = useState<any[]>([]);
  const carregar = () => api.get('/api/admin/sessoes').then(setLinhas);
  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, []);
  const dur = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min`;
  return (
    <Stack>
      <Title order={4}>Sessões ativas ({linhas.length})</Title>
      <Paper withBorder>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Código</Table.Th>
              <Table.Th>Operador</Table.Th>
              <Table.Th>Início da sessão</Table.Th>
              <Table.Th>Tempo de sessão</Table.Th>
              <Table.Th>Último acesso</Table.Th>
              <Table.Th>IP</Table.Th>
              <Table.Th>Unidade</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {linhas.map((l) => (
              <Table.Tr key={l.id}>
                <Table.Td>{l.operador_id}</Table.Td>
                <Table.Td>
                  {l.operador} <Text span size="xs" c="dimmed">({l.login})</Text>
                </Table.Td>
                <Table.Td>{fmtData(l.inicio)}</Table.Td>
                <Table.Td>{dur(l.duracao_segundos)}</Table.Td>
                <Table.Td>{fmtData(l.ultimo_acesso)}</Table.Td>
                <Table.Td>
                  <Code>{l.ip}</Code>
                </Table.Td>
                <Table.Td>{l.unidade}</Table.Td>
                <Table.Td>
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="light"
                    onClick={async () => {
                      if (await confirmar('Encerrar sessão', `Encerrar a sessão de ${l.operador}?`, 'Encerrar', true)) {
                        await api.delete(`/api/admin/sessoes/${l.id}`);
                        void carregar();
                      }
                    }}
                  >
                    Encerrar
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

const TIPOS_LOG = [
  { valor: 'dados', rotulo: 'Alterações de dados' },
  { valor: 'acessos', rotulo: 'Autenticação (login/logout)' },
  { valor: 'rotinas', rotulo: 'Acessos por rotina e ação' },
  { valor: 'certificados', rotulo: 'Uso de certificados' },
  { valor: 'integracoes', rotulo: 'Integrações externas' },
  { valor: 'erros', rotulo: 'Erros' },
];

function Auditoria() {
  useTituloJanela('Auditoria');
  const [tipo, setTipo] = useState('dados');
  const [filtros, setFiltros] = useState<Record<string, any>>({ de: dayjs().subtract(7, 'day').format('YYYY-MM-DD'), ate: dayjs().format('YYYY-MM-DD') });
  const [linhas, setLinhas] = useState<any[]>([]);
  const [detalhe, setDetalhe] = useState<any>(null);
  const buscar = () => api.get(`/api/auditoria/${tipo}`, filtros).then(setLinhas);
  useEffect(() => {
    void buscar();
  }, [tipo]);
  const colunas = useMemo(() => {
    if (!linhas.length) return [];
    return Object.keys(linhas[0]).filter((k) => !['antes', 'depois', 'pilha', 'detalhe'].includes(k));
  }, [linhas]);
  return (
    <Stack>
      <Title order={4}>Logs de auditoria</Title>
      <Group align="flex-end">
        <Select label="Tipo" data={TIPOS_LOG.map((t) => ({ value: t.valor, label: t.rotulo }))} value={tipo} onChange={(v) => setTipo(v!)} w={260} />
        <DateInput label="De" valueFormat="DD/MM/YYYY" value={filtros.de ? new Date(filtros.de + 'T00:00') : null} onChange={(d) => setFiltros({ ...filtros, de: d ? dayjs(d).format('YYYY-MM-DD') : undefined })} />
        <DateInput label="Até" valueFormat="DD/MM/YYYY" value={filtros.ate ? new Date(filtros.ate + 'T00:00') : null} onChange={(d) => setFiltros({ ...filtros, ate: d ? dayjs(d).format('YYYY-MM-DD') : undefined })} />
        <TextInput label="Código do operador" w={140} value={filtros.operador_id ?? ''} onChange={(e) => setFiltros({ ...filtros, operador_id: e.currentTarget.value })} />
        {tipo === 'dados' && <TextInput label="Tabela" placeholder="cad.pessoa" w={160} value={filtros.tabela ?? ''} onChange={(e) => setFiltros({ ...filtros, tabela: e.currentTarget.value })} />}
        {tipo === 'rotinas' && <TextInput label="Rotina" w={160} value={filtros.rotina ?? ''} onChange={(e) => setFiltros({ ...filtros, rotina: e.currentTarget.value })} />}
        <Button onClick={() => void buscar()}>Pesquisar</Button>
      </Group>
      <Paper withBorder>
        <ScrollArea h="calc(100vh - 290px)">
          <Table striped highlightOnHover stickyHeader fz="xs">
            <Table.Thead>
              <Table.Tr>
                {colunas.map((c) => (
                  <Table.Th key={c}>{c}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {linhas.map((l) => (
                <Table.Tr key={l.id} onClick={() => setDetalhe(l)} style={{ cursor: 'pointer' }}>
                  {colunas.map((c) => (
                    <Table.Td key={c}>{c === 'data_hora' ? fmtData(l[c]) : String(l[c] ?? '')}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
      <Modal opened={!!detalhe} onClose={() => setDetalhe(null)} title="Detalhe do registro de auditoria" size="xl">
        <Group grow align="flex-start">
          {detalhe?.antes !== undefined && (
            <div>
              <Text fw={600}>Antes</Text>
              <Code block>{JSON.stringify(detalhe?.antes, null, 2)}</Code>
            </div>
          )}
          {detalhe?.depois !== undefined && (
            <div>
              <Text fw={600}>Depois</Text>
              <Code block>{JSON.stringify(detalhe?.depois, null, 2)}</Code>
            </div>
          )}
          {(detalhe?.detalhe || detalhe?.pilha) && <Code block>{JSON.stringify(detalhe?.detalhe ?? detalhe?.pilha, null, 2)}</Code>}
        </Group>
      </Modal>
    </Stack>
  );
}

function Parametros() {
  useTituloJanela('Parâmetros do sistema');
  const [lista, setLista] = useState<any[]>([]);
  const carregar = () => api.get('/api/parametros').then(setLista);
  useEffect(() => {
    void carregar();
  }, []);
  const grupos = useMemo(() => {
    const g: Record<string, any[]> = {};
    for (const p of lista) (g[p.modulo ?? 'Geral'] ??= []).push(p);
    return g;
  }, [lista]);
  return (
    <Stack>
      <Title order={4}>Parâmetros do sistema</Title>
      <Accordion multiple defaultValue={Object.keys(grupos)} variant="separated">
        {Object.entries(grupos).map(([mod, ps]) => (
          <Accordion.Item key={mod} value={mod}>
            <Accordion.Control>{mod}</Accordion.Control>
            <Accordion.Panel>
              <Stack>
                {ps.map((p) => (
                  <EditorParametro key={p.chave} p={p} aoSalvar={carregar} />
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}

function EditorParametro({ p, aoSalvar }: { p: any; aoSalvar: () => void }) {
  const [valor, setValor] = useState(JSON.stringify(p.valor, null, 2));
  const simples = typeof p.valor === 'string' || typeof p.valor === 'number' || typeof p.valor === 'boolean' || p.valor === null;
  async function salvar() {
    let v: any;
    try {
      v = simples && typeof p.valor === 'string' ? valor : JSON.parse(valor);
    } catch {
      return notifications.show({ color: 'red', message: 'Valor inválido.' });
    }
    await api.put(`/api/parametros/${encodeURIComponent(p.chave)}`, { valor: v });
    notifications.show({ color: 'teal', message: 'Parâmetro atualizado.' });
    aoSalvar();
  }
  return (
    <Group align="flex-end" wrap="nowrap">
      {simples && typeof p.valor === 'string' && p.valor.length > 80 ? (
        <Textarea style={{ flex: 1 }} label={p.descricao} description={p.chave} value={valor} onChange={(e) => setValor(e.currentTarget.value)} autosize minRows={2} />
      ) : simples && typeof p.valor === 'string' ? (
        <TextInput style={{ flex: 1 }} label={p.descricao} description={p.chave} value={valor} onChange={(e) => setValor(e.currentTarget.value)} />
      ) : (
        <JsonInput style={{ flex: 1 }} label={p.descricao} description={p.chave} value={simples && typeof p.valor === 'string' ? valor : valor} onChange={setValor} autosize minRows={1} formatOnBlur validationError="JSON inválido" />
      )}
      <Button size="sm" variant="light" onClick={() => void salvar()}>
        Salvar
      </Button>
    </Group>
  );
}

// Permissões do perfil por rotina e ação (TR 1.1.1.29.2, 1.1.2.1.37).
function EditorPermissoes({ perfil, aoSalvar }: { perfil: any; aoSalvar: () => void }) {
  const [catalogo, setCatalogo] = useState<any[]>([]);
  const [perms, setPerms] = useState<Set<string>>(new Set(perfil?.permissoes ?? []));
  const [filtro, setFiltro] = useState('');
  useEffect(() => {
    api.get('/api/permissoes/catalogo').then(setCatalogo);
  }, []);
  useEffect(() => setPerms(new Set(perfil?.permissoes ?? [])), [perfil]);
  const alternar = (p: string) => setPerms((s) => (s.has(p) ? new Set([...s].filter((x) => x !== p)) : new Set([...s, p])));
  const modulos = useMemo(() => [...new Set(catalogo.map((c) => c.modulo))], [catalogo]);
  if (!perfil) return <Text c="dimmed">Salve o perfil para definir as permissões.</Text>;
  const ACOES: Record<string, string> = { consultar: 'Consultar', incluir: 'Incluir', alterar: 'Alterar', excluir: 'Excluir', exportar: 'Exportar/imprimir', executar: 'Executar' };
  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Checkbox label="Acesso total (todas as rotinas)" checked={perms.has('*')} onChange={() => alternar('*')} />
          <TextInput size="xs" placeholder="Filtrar rotinas..." value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} />
        </Group>
        <Button
          onClick={async () => {
            await api.put(`/api/e/perfil/${perfil.id}`, { permissoes: [...perms] });
            notifications.show({ color: 'teal', message: 'Permissões salvas.' });
            aoSalvar();
          }}
        >
          Salvar permissões
        </Button>
      </Group>
      <Accordion multiple variant="contained">
        {modulos.map((m) => (
          <Accordion.Item key={m} value={m}>
            <Accordion.Control>
              <Group gap="xs">
                <Text fw={600}>{m}</Text>
                <Checkbox size="xs" label="Todo o módulo" checked={perms.has(`${m}:*`)} onChange={() => alternar(`${m}:*`)} onClick={(e) => e.stopPropagation()} />
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <Table fz="xs">
                <Table.Tbody>
                  {catalogo
                    .filter((c) => c.modulo === m && (!filtro || c.descricao.toLowerCase().includes(filtro.toLowerCase())))
                    .map((c) => (
                      <Table.Tr key={c.chave}>
                        <Table.Td w="40%">{c.descricao}</Table.Td>
                        <Table.Td>
                          <Group gap="sm">
                            {c.acoes.map((a: string) => (
                              <Checkbox key={a} size="xs" label={ACOES[a] ?? a} checked={perms.has(`${c.chave}:${a}`) || perms.has(`${c.chave}:*`)} onChange={() => alternar(`${c.chave}:${a}`)} />
                            ))}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}

registrarExtensaoFormulario('perfil', {
  abasExtras: (registro) => [{ titulo: 'Permissões', conteudo: <EditorPermissoes perfil={registro} aoSalvar={() => {}} /> }],
});

registrarExtensaoFormulario('operador', {
  acoes: (registro, recarregar) =>
    registro ? (
      <>
        {registro.bloqueado && (
          <Button size="sm" variant="light" onClick={() => api.post(`/api/admin/operadores/${registro.id}/desbloquear`).then(recarregar)}>
            Desbloquear
          </Button>
        )}
        <Button
          size="sm"
          variant="default"
          onClick={async () => {
            if (await confirmar('Redefinir senha', 'Gerar senha temporária e enviar ao e-mail do operador?')) {
              await api.post(`/api/admin/operadores/${registro.id}/redefinir-senha`);
              notifications.show({ color: 'teal', message: 'Senha temporária enviada ao e-mail do operador.' });
            }
          }}
        >
          Redefinir senha (e-mail)
        </Button>
        <Button
          size="sm"
          variant="default"
          onClick={async () => {
            const s = await pedirTexto('Definir senha', 'Nova senha (o operador deverá trocá-la no próximo acesso)');
            if (s) {
              await api.post(`/api/admin/operadores/${registro.id}/definir-senha`, { senha: s, expirada: true });
              notifications.show({ color: 'teal', message: 'Senha definida.' });
              recarregar();
            }
          }}
        >
          Definir senha
        </Button>
      </>
    ) : null,
});

function RelatoriosEmitidos() {
  useTituloJanela('Relatórios emitidos');
  const [filtros, setFiltros] = useState<Record<string, string>>({});
  const [linhas, setLinhas] = useState<any[]>([]);
  const buscar = () => api.get('/api/relatorios', filtros).then(setLinhas);
  useEffect(() => {
    void buscar();
    const t = setInterval(buscar, 20_000);
    return () => clearInterval(t);
  }, []);
  return (
    <Stack>
      <Title order={4}>Relatórios e documentos emitidos</Title>
      <Group align="flex-end">
        <TextInput label="Código de emissão" value={filtros.codigo ?? ''} onChange={(e) => setFiltros({ ...filtros, codigo: e.currentTarget.value })} />
        <TextInput label="Operador" value={filtros.operador ?? ''} onChange={(e) => setFiltros({ ...filtros, operador: e.currentTarget.value })} />
        <Select label="Situação" clearable data={[{ value: 'gerando', label: 'Em geração' }, { value: 'concluido', label: 'Concluído' }, { value: 'erro', label: 'Erro' }]} value={filtros.situacao ?? null} onChange={(v) => setFiltros({ ...filtros, situacao: v ?? '' })} />
        <Button onClick={() => void buscar()}>Pesquisar</Button>
      </Group>
      <Paper withBorder>
        <Table striped fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Código</Table.Th>
              <Table.Th>Título</Table.Th>
              <Table.Th>Formato</Table.Th>
              <Table.Th>Operador</Table.Th>
              <Table.Th>Emissão</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {linhas.map((l) => (
              <Table.Tr key={l.id}>
                <Table.Td>
                  <Code>{l.codigo}</Code>
                </Table.Td>
                <Table.Td>{l.titulo}</Table.Td>
                <Table.Td>{l.formato}</Table.Td>
                <Table.Td>{l.operador}</Table.Td>
                <Table.Td>{fmtData(l.emitido_em)}</Table.Td>
                <Table.Td>
                  <Badge color={l.situacao === 'concluido' ? 'teal' : l.situacao === 'erro' ? 'red' : 'yellow'}>{l.situacao}</Badge>
                </Table.Td>
                <Table.Td>
                  {l.arquivo_id && (
                    <Group gap={4}>
                      <Button size="compact-xs" variant="light" component="a" href={`/api/arquivos/${l.arquivo_id}`} target="_blank">
                        Abrir
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={async () => {
                          const ids = await pedirTexto('Enviar por e-mail', 'Códigos das pessoas destinatárias (separados por vírgula)');
                          if (ids) {
                            const r = await api.post(`/api/relatorios/${l.id}/email`, { pessoas: ids.split(',').map((x) => Number(x.trim())).filter(Boolean) });
                            notifications.show({ color: 'teal', message: `Enviado para ${r.enviados} destinatário(s).` });
                          }
                        }}
                      >
                        E-mail
                      </Button>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

function Consistencia() {
  useTituloJanela('Consistência da base de dados');
  const [execucoes, setExecucoes] = useState<any[]>([]);
  const carregar = () => api.get('/api/consistencia').then(setExecucoes);
  useEffect(() => {
    void carregar();
    const t = setInterval(carregar, 10_000);
    return () => clearInterval(t);
  }, []);
  const ultima = execucoes[0];
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>Verificação de consistência da base</Title>
        <Button onClick={() => api.post('/api/consistencia').then(() => (notifications.show({ message: 'Verificação iniciada em segundo plano. A operação do sistema não é interrompida.' }), carregar()))}>
          Executar verificação
        </Button>
      </Group>
      {ultima && (
        <Paper withBorder p="md">
          <Group mb="sm">
            <Text fw={600}>Última execução: {fmtData(ultima.iniciada_em)}</Text>
            <Badge color={ultima.situacao === 'consistente' ? 'teal' : ultima.situacao === 'executando' ? 'yellow' : 'red'}>{ultima.situacao}</Badge>
          </Group>
          {Array.isArray(ultima.resultado) && ultima.resultado.length > 0 && (
            <Table fz="sm" striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Verificação</Table.Th>
                  <Table.Th>Tabela</Table.Th>
                  <Table.Th>Ocorrências</Table.Th>
                  <Table.Th>Exemplos (códigos)</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {ultima.resultado.map((o: any, i: number) => (
                  <Table.Tr key={i}>
                    <Table.Td>{o.verificacao}</Table.Td>
                    <Table.Td>{o.tabela}</Table.Td>
                    <Table.Td>{o.quantidade}</Table.Td>
                    <Table.Td>{JSON.stringify(o.exemplos ?? '').slice(0, 120)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Paper>
      )}
    </Stack>
  );
}

function Lgpd() {
  useTituloJanela('LGPD - dados pessoais tratados');
  const [cpf, setCpf] = useState('');
  const [res, setRes] = useState<any>(null);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Stack>
      <Title order={4}>Relatório de dados pessoais tratados (LGPD)</Title>
      <Alert color="blue">Relatório restrito ao Encarregado de Proteção de Dados do controlador. Informe o CPF do titular ou deixe em branco para a visão global.</Alert>
      <Group align="flex-end">
        <TextInput label="CPF do titular" value={cpf} onChange={(e) => setCpf(e.currentTarget.value)} />
        <Button onClick={() => api.get('/api/lgpd/dados-tratados', { cpf }).then((r) => (setRes(r), setErro(null))).catch((e) => setErro(e.message))}>Consultar</Button>
        <Select
          placeholder="Exportar..."
          data={OPCOES_FORMATO.map((f) => ({ value: f.valor, label: f.rotulo }))}
          onChange={(f) => f && api.arquivo(`/api/lgpd/dados-tratados?cpf=${cpf}&formato=${f}`, undefined, 'baixar', 'GET')}
        />
      </Group>
      {erro && <Alert color="red">{erro}</Alert>}
      {res && (
        <Paper withBorder p="sm">
          {res.titular && (
            <Text mb="sm">
              Titular: <b>{res.titular.nome}</b>
            </Text>
          )}
          <ScrollArea h={420}>
            <Code block>{JSON.stringify(res, null, 2)}</Code>
          </ScrollArea>
        </Paper>
      )}
    </Stack>
  );
}

function EnviarNotificacao() {
  useTituloJanela('Enviar notificação a operadores');
  const [ops, setOps] = useState<{ value: string; label: string }[]>([]);
  const [grupos, setGrupos] = useState<{ value: string; label: string }[]>([]);
  const [f, setF] = useState<{ destinatarios: string[]; grupos: string[]; titulo: string; mensagem: string; anexoId?: string }>({ destinatarios: [], grupos: [], titulo: '', mensagem: '' });
  useEffect(() => {
    api.get('/api/e/operador/opcoes', { limite: 200 }).then((r) => setOps(r.map((o: any) => ({ value: String(o.id), label: o.rotulo }))));
    api.get('/api/e/grupo_operador/opcoes', { limite: 200 }).then((r) => setGrupos(r.map((o: any) => ({ value: String(o.id), label: o.rotulo }))));
  }, []);
  return (
    <Stack maw={720}>
      <Title order={4}>Enviar notificação a operadores</Title>
      <MultiSelect label="Operadores" data={ops} searchable value={f.destinatarios} onChange={(v) => setF({ ...f, destinatarios: v })} />
      <MultiSelect label="Grupos de operadores" data={grupos} value={f.grupos} onChange={(v) => setF({ ...f, grupos: v })} />
      <TextInput label="Título" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.currentTarget.value })} />
      <Textarea label="Mensagem" autosize minRows={4} value={f.mensagem} onChange={(e) => setF({ ...f, mensagem: e.currentTarget.value })} />
      <Group>
        <input type="file" onChange={(e) => e.target.files?.[0] && api.enviarArquivo(e.target.files[0]).then((r) => setF((x) => ({ ...x, anexoId: r.id })))} />
        {f.anexoId && <Badge>Anexo carregado</Badge>}
      </Group>
      <Group justify="flex-end">
        <Button
          onClick={() =>
            api
              .post('/api/notificacoes', { ...f, destinatarios: f.destinatarios.map(Number), grupos: f.grupos.map(Number) })
              .then((r) => notifications.show({ color: 'teal', message: `Notificação enviada a ${r.enviadas} operador(es).` }))
          }
        >
          Enviar
        </Button>
      </Group>
    </Stack>
  );
}

function IndicadoresSuporte() {
  useTituloJanela('Chamados e SLA');
  const [comp, setComp] = useState(dayjs().format('YYYY-MM'));
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    api.get('/api/suporte/mttr', { competencia: comp }).then(setD);
  }, [comp]);
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>Chamados de suporte, MTtR e SLA</Title>
        <Group>
          <TextInput type="month" value={comp} onChange={(e) => setComp(e.currentTarget.value)} />
          <Button variant="default" onClick={() => api.arquivo(`/api/suporte/mttr?competencia=${comp}&formato=pdf`, undefined, 'abrir', 'GET')}>
            Relatório de chamados (PDF)
          </Button>
        </Group>
      </Group>
      <Paper withBorder>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Classificação</Table.Th>
              <Table.Th>Ocorrências</Table.Th>
              <Table.Th>MTtR (horas úteis)</Table.Th>
              <Table.Th>Limite</Table.Th>
              <Table.Th>Situação</Table.Th>
              <Table.Th>Desconto na fatura</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {d?.indicadores.map((i: any) => (
              <Table.Tr key={i.classificacao}>
                <Table.Td>{i.classificacao}</Table.Td>
                <Table.Td>{i.ocorrencias}</Table.Td>
                <Table.Td>{i.mttr.toLocaleString('pt-BR')}</Table.Td>
                <Table.Td>{i.limite} h</Table.Td>
                <Table.Td>
                  <Badge color={i.cumprido ? 'teal' : 'red'}>{i.cumprido ? 'Cumprido' : 'Descumprido'}</Badge>
                </Table.Td>
                <Table.Td>{i.desconto_percentual ? `${i.desconto_percentual}%` : '-'}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}

function DicionarioDados() {
  useTituloJanela('Dicionário de dados');
  const [linhas, setLinhas] = useState<any[]>([]);
  const [filtro, setFiltro] = useState('');
  useEffect(() => {
    api.get('/api/dicionario-dados').then(setLinhas);
  }, []);
  const vis = linhas.filter((l) => !filtro || l.tabela_completa.includes(filtro) || (l.descricao ?? '').toLowerCase().includes(filtro.toLowerCase()));
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>Dicionário de dados ({linhas.length} colunas)</Title>
        <Group>
          <TextInput placeholder="Filtrar tabela ou descrição" value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} />
          <Select placeholder="Exportar..." data={OPCOES_FORMATO.map((f) => ({ value: f.valor, label: f.rotulo }))} onChange={(f) => f && api.arquivo(`/api/dicionario-dados?formato=${f}`, undefined, 'baixar', 'GET')} />
        </Group>
      </Group>
      <Paper withBorder>
        <ScrollArea h="calc(100vh - 220px)">
          <Table fz="xs" striped stickyHeader>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tabela</Table.Th>
                <Table.Th>Coluna</Table.Th>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Obrig.</Table.Th>
                <Table.Th>Chave</Table.Th>
                <Table.Th>Referência</Table.Th>
                <Table.Th>Descrição / valores</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {vis.slice(0, 2000).map((l, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{l.tabela_completa}</Table.Td>
                  <Table.Td>{l.coluna}</Table.Td>
                  <Table.Td>{l.tipo}</Table.Td>
                  <Table.Td>{l.obrigatorio ? 'Sim' : ''}</Table.Td>
                  <Table.Td>{l.chave}</Table.Td>
                  <Table.Td>{l.referencia}</Table.Td>
                  <Table.Td>{l.descricao}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Paper>
    </Stack>
  );
}

registrarTela({ id: 'sessoes', titulo: 'Sessões ativas', menu: 'Administração/Segurança', padrao: '/t/sessoes', permissao: 'sessao:consultar', modulo: 'TEC', palavras: ['logados', 'conectados'], render: () => <Sessoes /> });
registrarTela({ id: 'auditoria', titulo: 'Logs de auditoria', menu: 'Administração/Segurança', padrao: '/t/auditoria', permissao: 'auditoria:consultar', modulo: 'TEC', palavras: ['log', 'histórico'], render: () => <Auditoria /> });
registrarTela({ id: 'parametros', titulo: 'Parâmetros do sistema', menu: 'Administração/Configurações', padrao: '/t/parametros', permissao: 'parametro:consultar', modulo: 'TEC', palavras: ['configuração'], render: () => <Parametros /> });
registrarTela({ id: 'relatorios-emitidos', titulo: 'Relatórios emitidos', menu: 'Administração/Relatórios', padrao: '/t/relatorios-emitidos', palavras: ['código', 'autenticidade', 'fila de impressão'], render: () => <RelatoriosEmitidos /> });
registrarTela({ id: 'consistencia', titulo: 'Consistência da base', menu: 'Administração/Configurações', padrao: '/t/consistencia', permissao: 'consistencia:executar', modulo: 'TEC', render: () => <Consistencia /> });
registrarTela({ id: 'lgpd', titulo: 'LGPD - dados tratados', menu: 'Administração/Segurança', padrao: '/t/lgpd', palavras: ['proteção de dados', 'titular'], render: () => <Lgpd /> });
registrarTela({ id: 'notificar', titulo: 'Enviar notificação a operadores', menu: 'Administração/Comunicação', padrao: '/t/notificar', permissao: 'notificacao:incluir', modulo: 'TEC', render: () => <EnviarNotificacao /> });
registrarTela({ id: 'suporte-sla', titulo: 'Chamados e SLA', menu: 'Administração/Suporte', padrao: '/t/suporte-sla', permissao: 'chamado:consultar', modulo: 'TEC', palavras: ['mttr', 'chamado'], render: () => <IndicadoresSuporte /> });
registrarTela({ id: 'dicionario', titulo: 'Dicionário de dados', menu: 'Administração/Configurações', padrao: '/t/dicionario', permissao: 'auditoria:consultar', modulo: 'TEC', render: () => <DicionarioDados /> });
registrarTela({ id: 'alterar-senha', titulo: 'Alterar senha', padrao: '/t/alterar-senha', render: () => <TrocarSenha /> });
