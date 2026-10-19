import { useEffect, useState } from 'react';
import { api } from '@/api';
import type { Meta } from '@/tipos';

const cache = new Map<string, Promise<Meta>>();

export function carregarMeta(nome: string): Promise<Meta> {
  if (!cache.has(nome)) {
    const p = api.get<Meta>(`/api/meta/${nome}`);
    p.catch(() => cache.delete(nome));
    cache.set(nome, p);
  }
  return cache.get(nome)!;
}

export function useMeta(nome: string) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    setMeta(null);
    carregarMeta(nome)
      .then((m) => ativo && setMeta(m))
      .catch((e) => ativo && setErro(e.message));
    return () => {
      ativo = false;
    };
  }, [nome]);
  return { meta, erro };
}
