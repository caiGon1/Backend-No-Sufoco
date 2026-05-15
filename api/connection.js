import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.db);

export default async function handler(req, res) {
  try {
    // Tenta conectar
    await client.connect();
    
    // Faz um comando simples de "ping" no banco
    await client.db("admin").command({ ping: 1 });

    // Se chegou aqui, deu certo!
    return res.status(200).json({ 
      status: "Online", 
      message: "Backend Serverless e MongoDB integrados com sucesso!" 
    });
  } catch (e) {
    // Se der erro, ele te avisa o que foi
    return res.status(500).json({ 
      status: "Erro", 
      details: e.message 
    });
  }
}