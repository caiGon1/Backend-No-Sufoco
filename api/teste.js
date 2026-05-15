import { MongoClient } from 'mongodb';
import index from './service/index.js';

const client = new MongoClient(process.env.db);

export default async function handler(req, res) {
  try {
    // Tenta conectar
    await client.connect();
    
    // Faz um comando simples de "ping" no banco
    await client.db("admin").command({ ping: 1 });
    const respostaIA = await index(); // Chama a função de IA para testar a integração  

    // Se chegou aqui, deu certo!
    return res.status(200).json({ 
      status: "Online", 
      message: "Backend Serverless e MongoDB integrados com sucesso!",
      mensagemIA: respostaIA // Retorna a resposta da IA para verificar se está funcionando
    });
  } catch (e) {
    // Se der erro, ele te avisa o que foi
    return res.status(500).json({ 
      status: "Erro", 
      details: e.message 
    });
  }
}