// Monta o menu a partir das entidades liberadas ao operador e das telas registradas.
import type { Meta } from '@/tipos';
import { listarTelas } from '@/telas/registro';

export interface ItemMenu {
  rotulo: string;
  caminho?: string;
  filhos?: ItemMenu[];
  palavras?: string[];
  ordem?: number;
}

const ORDEM_GRUPOS = [
  'Atendimento',
  'Agendamento',
  'Prontuário',
  'Farmácia',
  'Imunização',
  'Regulação',
  'Exames',
  'Transporte',
  'Saúde mental',
  'Atenção primária',
  'Faturamento',
  'Indicadores',
  'Cadastros',
  'Administração',
];

export function montarMenu(metas: Meta[], pode: (perm: string, modulo?: string) => boolean): ItemMenu[] {
  const raiz: ItemMenu = { rotulo: '', filhos: [] };
  const inserir = (caminhoMenu: string, item: ItemMenu) => {
    const partes = caminhoMenu.split('/');
    let no = raiz;
    for (const p of partes) {
      no.filhos ??= [];
      let filho = no.filhos.find((f) => f.rotulo === p && !f.caminho);
      if (!filho) {
        filho = { rotulo: p, filhos: [] };
        no.filhos.push(filho);
      }
      no = filho;
    }
    no.filhos!.push(item);
  };
  for (const m of metas) {
    if (m.menu && m.acoes.consultar) inserir(m.menu, { rotulo: m.titulo, caminho: `/e/${m.nome}`, palavras: [m.tituloSingular, ...(m.tr ?? [])] });
  }
  for (const t of listarTelas()) {
    if (!t.menu) continue;
    if (t.permissao && !pode(t.permissao, t.modulo)) continue;
    inserir(t.menu, { rotulo: t.titulo, caminho: t.padrao, palavras: t.palavras, ordem: t.ordem });
  }
  const ordenar = (itens: ItemMenu[], nivel: number) => {
    itens.sort((a, b) => {
      if (nivel === 0) {
        const ia = ORDEM_GRUPOS.indexOf(a.rotulo);
        const ib = ORDEM_GRUPOS.indexOf(b.rotulo);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      }
      if (!!a.caminho !== !!b.caminho) return a.caminho ? 1 : -1;
      return (a.ordem ?? 50) - (b.ordem ?? 50) || a.rotulo.localeCompare(b.rotulo);
    });
    for (const i of itens) if (i.filhos) ordenar(i.filhos, nivel + 1);
  };
  ordenar(raiz.filhos!, 0);
  return raiz.filhos!;
}

/** Lista plana de funcionalidades para a busca por palavra-chave (TR 1.1.2.1.49). */
export function achatarMenu(itens: ItemMenu[], prefixo = ''): { rotulo: string; caminho: string; grupo: string; palavras: string[] }[] {
  const out: { rotulo: string; caminho: string; grupo: string; palavras: string[] }[] = [];
  for (const i of itens) {
    if (i.caminho) out.push({ rotulo: i.rotulo, caminho: i.caminho, grupo: prefixo, palavras: i.palavras ?? [] });
    if (i.filhos) out.push(...achatarMenu(i.filhos, prefixo ? `${prefixo} › ${i.rotulo}` : i.rotulo));
  }
  return out;
}
