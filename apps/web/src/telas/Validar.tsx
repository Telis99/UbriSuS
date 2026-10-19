// Validação pública de autenticidade de documentos e relatórios (TR 1.1.1.64.18).
import { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Center, Group, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api';

export function Validar() {
  const { codigo } = useParams();
  const navegar = useNavigate();
  const [entrada, setEntrada] = useState(codigo ?? '');
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    if (codigo) api.get(`/api/publico/validar/${encodeURIComponent(codigo)}`).then(setR).catch((e) => setR({ valido: false, mensagem: e.message }));
  }, [codigo]);
  return (
    <Center mih="100vh" bg="gray.1" p="md">
      <Paper shadow="md" p="xl" radius="md" w={640} maw="100%">
        <Stack>
          <Group>
            <img src="/icone.svg" width={40} height={40} alt="" />
            <Title order={3}>Validação de documentos</Title>
          </Group>
          <Group align="flex-end">
            <TextInput style={{ flex: 1 }} label="Código de emissão" value={entrada} onChange={(e) => setEntrada(e.currentTarget.value.toUpperCase())} placeholder="AAAAMMDD-XXXXX-XXXXX" />
            <Button onClick={() => navegar(`/validar/${entrada.trim()}`)}>Validar</Button>
          </Group>
          {r && r.valido && (
            <Alert color="teal" icon={<IconCircleCheck />} title="Documento autêntico">
              <Table fz="sm">
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>Documento</Table.Td>
                    <Table.Td>{r.documento.titulo}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Emitido em</Table.Td>
                    <Table.Td>{new Date(r.documento.emitido_em).toLocaleString('pt-BR')}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Emitido por</Table.Td>
                    <Table.Td>{r.documento.operador ?? '-'}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Td>Resumo criptográfico (SHA-256)</Table.Td>
                    <Table.Td>
                      <Text size="xs" style={{ wordBreak: 'break-all' }}>
                        {r.documento.sha256}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              {r.assinaturas?.length > 0 && (
                <Stack gap={4} mt="sm">
                  <Text fw={600} size="sm">
                    Assinaturas eletrônicas
                  </Text>
                  {r.assinaturas.map((a: any, i: number) => (
                    <Group key={i} gap="xs">
                      <Badge>{a.modalidade}</Badge>
                      <Text size="sm">
                        {a.signatario} em {new Date(a.assinado_em).toLocaleString('pt-BR')}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              )}
              <Anchor href={`/api/publico/validar/${codigo}/arquivo`} target="_blank" size="sm" mt="sm" display="block">
                Visualizar o documento original
              </Anchor>
            </Alert>
          )}
          {r && !r.valido && (
            <Alert color="red" icon={<IconCircleX />} title="Documento não validado">
              {r.mensagem ?? 'O documento não foi encontrado ou não foi concluído.'}
            </Alert>
          )}
        </Stack>
      </Paper>
    </Center>
  );
}
