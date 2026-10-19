// Exibição e registro do aceite da política de cookies (TR 1.1.1.66).
import { useEffect, useState } from 'react';
import { Affix, Button, Group, Paper, Text } from '@mantine/core';
import { api } from '@/api';

export function AvisoCookies() {
  const [politica, setPolitica] = useState<{ texto: string; versao: string } | null>(null);
  useEffect(() => {
    api
      .get('/api/parametros/publicos')
      .then((p) => {
        const versao = p['publico.politica_cookies_versao'] ?? '1';
        if (localStorage.getItem('cookies_aceitos') !== versao) setPolitica({ texto: p['publico.politica_cookies'] ?? '', versao });
      })
      .catch(() => {});
  }, []);
  if (!politica) return null;
  return (
    <Affix position={{ bottom: 16, left: 16, right: 16 }}>
      <Paper shadow="md" p="md" withBorder maw={720} mx="auto">
        <Text size="sm" mb="xs">
          <b>Política de cookies.</b> {politica.texto}
        </Text>
        <Group justify="flex-end">
          <Button
            size="xs"
            onClick={() => {
              void api.post('/api/publico/aceite-cookies', { versao: politica.versao });
              localStorage.setItem('cookies_aceitos', politica.versao);
              setPolitica(null);
            }}
          >
            Concordo
          </Button>
        </Group>
      </Paper>
    </Affix>
  );
}
