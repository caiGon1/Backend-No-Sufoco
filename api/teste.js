import clientPromise from '../lib/mongodb.js'; // Importa a conexão otimizada

export default async function handler(req, res) {
  try {
    // Em vez de 'new MongoClient', usamos o client que vem da lib
    const client = await clientPromise;
    
    // Faz o ping para garantir que a ponte está de pé
    await client.db("admin").command({ ping: 1 });

    return res.status(200).json({ 
      status: "Online", 
      message: "Conexão via LIB funcionando com sucesso!",

    });
  } catch (e) {
    return res.status(500).json({ 
      status: "Erro", 
      details: e.message 
    });
  }
}