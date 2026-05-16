import clientPromise from '../lib/mongodb.js'; // Importa a conexão otimizada
import { main }  from '../src/service/index.js'; // Importa a função principal do serviço de IA
export default async function handler(req, res) {
  try {
    // Em vez de 'new MongoClient', usamos o client que vem da lib
    const client = await clientPromise;
    
    // Faz o ping para garantir que a ponte está de pé
    await client.db("admin").command({ ping: 1 });

    const resposta = await main(); // Chama a função principal do serviço de IA

    return res.status(200).json({ 
      status: "Online", 
      message: "Conexão via LIB funcionando com sucesso!",
      resposta: resposta

    });
  } catch (e) {
    return res.status(500).json({ 
      status: "Erro", 
      details: e.message 
    });
  }
}