import { MongoClient } from 'mongodb';
import gerarRespostaIA from './service/index.js';

let client;
let clientPromise;

if (!global._mongoClientPromise) {
  client = new MongoClient(process.env.MONGODB_URI);
  global._mongoClientPromise = client.connect();
}

clientPromise = global._mongoClientPromise;

export default async function handler(req, res) {

  if (req.method !== 'GET') {
    return res.status(405).json({
      erro: 'Método não permitido'
    });
  }

  try {

    const client = await clientPromise;

    await client.db("admin").command({ ping: 1 });

    const respostaIA = await gerarRespostaIA();

    return res.status(200).json({
      status: "Online",
      message: "MongoDB conectado com sucesso",
      mensagemIA: respostaIA
    });

  } catch (e) {

    console.error(e);

    return res.status(500).json({
      status: "Erro",
      details: e.message
    });
  }
}