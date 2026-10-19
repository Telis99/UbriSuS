import { Center, Loader } from '@mantine/core';
import { Route, Routes } from 'react-router-dom';
import { AceitarTermos, Login, TrocarSenha } from '@/auth/Login';
import { useAuth } from '@/auth/Auth';
import { Layout } from '@/shell/Layout';
import { ProvedorJanelas } from '@/shell/Janelas';
import { Validar } from '@/telas/Validar';
import '@/telas';

function Protegido() {
  const { eu, carregando } = useAuth();
  if (carregando)
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  if (!eu) return <Login />;
  if (eu.precisaTrocarSenha) return <TrocarSenha obrigatoria />;
  if (eu.precisaAceitarTermos) return <AceitarTermos texto={eu.termosUso} />;
  return (
    <ProvedorJanelas>
      <Layout />
    </ProvedorJanelas>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/validar" element={<Validar />} />
      <Route path="/validar/:codigo" element={<Validar />} />
      <Route path="*" element={<Protegido />} />
    </Routes>
  );
}
