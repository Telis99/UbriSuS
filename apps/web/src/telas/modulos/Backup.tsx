// Cópias de segurança no servidor local da contratante, validação de integridade e exportação para portabilidade (TR 1.1.1.23, 1.1.1.70).
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Grid, Group, NumberInput, Paper, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconDatabaseExport, IconDownload, IconPackageExport, IconShieldCheck } from '@tabler/icons-react';
import { api } from '@/api';
import { useTituloJanela } from '@/shell/Janelas';
import { fmtDataHora, notificarErro, notificarOk, useCarregar, useIntervalo } from '@/componentes/comum';
import { registrarTela } from '../registro';

interface Configuracao {
  ativo: boolean;
  diretorio: string;
  hora: number;
  retencaoDias: number;
  validarUltimas: number;
}

const tamanho = (b?: number | null) => (b == null ? '' : b > 1 << 30 ? `${(b / (1 << 30)).toFixed(2)} GB` : b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

function TelaBackup() {
  useTituloJanela('Cópias de segurança');
  const { dados, recarregar } = useCarregar(() => api.get<{ configuracao: Configuracao; copias: any[] }>('/api/backup'), []);
  const [cfg, setCfg] = useState<Configuracao | null>(null);
  useEffect(() => {
    if (dados && !cfg) setCfg(dados.configuracao);
  }, [dados, cfg]);
  const executando = !!dados?.copias.some((k) => k.situacao === 'EXECUTANDO');
  useIntervalo(recarregar, 5000, executando);
  const salvar = () => api.put('/api/backup/configuracao', cfg).then(() => notificarOk('Configuração gravada.')).catch(notificarErro);
  const executar = (tipo: 'BACKUP' | 'PORTABILIDADE') =>
    api
      .post<{ mensagem: string }>('/api/backup/executar', { tipo })
      .then((r) => (notificarOk(r.mensagem), setTimeout(recarregar, 800)))
      .catch(notificarErro);
  const validar = () =>
    api
      .post<any[]>('/api/backup/validar', {})
      .then((r) => (notificarOk(`${r.filter((x) => x.integro).length} de ${r.length} cópia(s) íntegra(s).`), recarregar()))
      .catch(notificarErro);
  const c = (k: keyof Configuracao) => (v: any) => setCfg((x) => (x ? { ...x, [k]: v } : x));
  return (
    <Stack p="md" gap="sm">
      <Title order={4}>Cópias de segurança e portabilidade</Title>
      <Alert color="blue" py="xs">
        As cópias completas do banco são gravadas no diretório do servidor local disponibilizado pela contratante e validadas periodicamente (resumo SHA-256 e
        leitura do catálogo). O pacote de portabilidade reúne todos os dados em CSV com dicionário de dados, esquema SQL e anexos, para transferência a outro sistema.
      </Alert>
      {cfg && (
        <Paper withBorder p="sm">
          <Grid gutter="xs" align="flex-end">
            <Grid.Col span={{ base: 12, md: 2 }}>
              <Switch label="Cópia diária automática" checked={cfg.ativo} onChange={(e) => c('ativo')(e.currentTarget.checked)} mb={8} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 4 }}>
              <TextInput label="Diretório do servidor local (montado)" value={cfg.diretorio} onChange={(e) => c('diretorio')(e.currentTarget.value)} />
            </Grid.Col>
            <Grid.Col span={{ base: 4, md: 1 }}>
              <NumberInput label="Hora" min={0} max={23} value={cfg.hora} onChange={(v) => c('hora')(Number(v))} />
            </Grid.Col>
            <Grid.Col span={{ base: 4, md: 2 }}>
              <NumberInput label="Retenção (dias)" min={1} value={cfg.retencaoDias} onChange={(v) => c('retencaoDias')(Number(v))} />
            </Grid.Col>
            <Grid.Col span={{ base: 4, md: 2 }}>
              <NumberInput label="Revalidar últimas" min={1} max={60} value={cfg.validarUltimas} onChange={(v) => c('validarUltimas')(Number(v))} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 1 }}>
              <Button onClick={salvar}>Gravar</Button>
            </Grid.Col>
          </Grid>
        </Paper>
      )}
      <Group>
        <Button leftSection={<IconDatabaseExport size={16} />} onClick={() => executar('BACKUP')} disabled={executando}>
          Fazer cópia agora
        </Button>
        <Button leftSection={<IconShieldCheck size={16} />} variant="light" onClick={validar}>
          Validar integridade
        </Button>
        <Button leftSection={<IconPackageExport size={16} />} variant="light" color="grape" onClick={() => executar('PORTABILIDADE')} disabled={executando}>
          Gerar pacote de portabilidade
        </Button>
        {executando && <Text size="sm" c="dimmed">Em execução...</Text>}
      </Group>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={1300}>
          <Table striped fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Tipo</Table.Th>
                <Table.Th>Origem</Table.Th>
                <Table.Th>Início</Table.Th>
                <Table.Th>Término</Table.Th>
                <Table.Th>Arquivo</Table.Th>
                <Table.Th>Tamanho</Table.Th>
                <Table.Th>Situação</Table.Th>
                <Table.Th>Integridade</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(dados?.copias ?? []).map((k) => (
                <Table.Tr key={k.id}>
                  <Table.Td>{k.tipo === 'BACKUP' ? 'Banco de dados' : 'Portabilidade'}</Table.Td>
                  <Table.Td>
                    {k.origem === 'AGENDADA' ? 'Agendada' : 'Manual'}
                    {k.operador ? ` · ${k.operador}` : ''}
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtDataHora(k.iniciado_em)}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmtDataHora(k.concluido_em)}</Table.Td>
                  <Table.Td>
                    <Tooltip label={k.sha256 ? `SHA-256 ${k.sha256}` : k.arquivo ?? ''} disabled={!k.arquivo}>
                      <Text size="xs" ff="monospace" td={k.excluido ? 'line-through' : undefined}>
                        {k.arquivo?.split('/').pop()}
                      </Text>
                    </Tooltip>
                  </Table.Td>
                  <Table.Td>{tamanho(k.tamanho)}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    <Badge style={{ overflow: 'visible' }} color={k.situacao === 'CONCLUIDO' ? 'green' : k.situacao === 'FALHA' ? 'red' : 'blue'} variant="light">
                      {k.excluido ? 'Removida (retenção)' : k.situacao === 'CONCLUIDO' ? 'Concluída' : k.situacao === 'FALHA' ? 'Falha' : 'Em execução'}
                    </Badge>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>
                    {k.validado_em && (
                      <Tooltip label={k.mensagem}>
                        <Badge style={{ overflow: 'visible' }} color={k.integro ? 'teal' : 'red'} variant="outline">
                          {k.integro ? 'Íntegra' : 'Problema'} · {fmtDataHora(k.validado_em)}
                        </Badge>
                      </Tooltip>
                    )}
                    {k.situacao === 'FALHA' && (
                      <Text size="xs" c="red">
                        {k.mensagem}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {k.tipo === 'PORTABILIDADE' && k.situacao === 'CONCLUIDO' && !k.excluido && (
                      <Button size="compact-xs" variant="subtle" leftSection={<IconDownload size={12} />} onClick={() => api.arquivo(`/api/backup/${k.id}/download`, undefined, 'baixar', 'GET').catch(notificarErro)}>
                        Baixar
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}

registrarTela({
  id: 'backup',
  titulo: 'Cópias de segurança',
  menu: 'Administração/Banco de dados',
  padrao: '/t/backup',
  permissao: 'backup:consultar',
  modulo: 'TEC',
  palavras: ['backup', 'cópia de segurança', 'portabilidade', 'exportar dados', 'integridade'],
  render: () => <TelaBackup />,
});
