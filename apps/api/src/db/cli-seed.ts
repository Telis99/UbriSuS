// Carga inicial do banco: npm run db:seed [-- --demo]
import { migrar } from './migrar.js';
import { pool, transacao } from './pool.js';
import { carregarCid10, carregarEnderecos, carregarTabelasApoio } from './carga/basicos.js';
import { carregarAdministrador, carregarParametros, carregarPerfis, carregarUnidades } from './carga/configuracao.js';
import { carregarTabelasSaude } from './carga/saude.js';
import { cargasModulos } from './carga/modulos.js';

async function principal() {
  await migrar(() => {});
  const ctx = { usuarioId: null, ip: 'carga-inicial', rotina: 'carga-inicial' };
  let senhaAdmin: string | null = null;
  await transacao(ctx, async (c) => {
    console.log('Endereços (IBGE)...');
    await carregarEnderecos(c);
    console.log('Tabelas de apoio...');
    await carregarTabelasApoio(c);
    console.log('CID-10...');
    console.log(`  ${await carregarCid10(c)} códigos`);
    console.log('Tabelas clínicas...');
    await carregarTabelasSaude(c);
    console.log('Parâmetros e perfis...');
    await carregarParametros(c);
    await carregarPerfis(c);
    console.log('Unidades da rede municipal...');
    await carregarUnidades(c);
    for (const [nome, carga] of cargasModulos) {
      console.log(`${nome}...`);
      await carga(c);
    }
    senhaAdmin = await carregarAdministrador(c);
  });
  if (process.argv.includes('--demo')) {
    const { carregarDemonstracao } = await import('./carga/demonstracao.js');
    console.log('Dados fictícios de demonstração...');
    await transacao(ctx, carregarDemonstracao);
  }
  if (senhaAdmin) {
    console.log('\nAdministrador criado: login "admin"');
    console.log(`Senha temporária: ${senhaAdmin}  (troca obrigatória no primeiro acesso)\n`);
  }
  await pool.end();
}

principal().catch((e) => {
  console.error(e);
  process.exit(1);
});
