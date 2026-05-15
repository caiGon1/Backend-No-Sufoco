import clientPromise from '../../lib/mongodb.js';

export default async function handler(req, res) {
  const client = await clientPromise;
  const db = client.db("NoSufocoDB");

  if (req.method === 'POST') {
    const { nome, email, senha, banco} = req.body;
    
    // Inserindo o usuário
    const resultado = await db.collection("users").insertOne({ nome, email, senha, banco });
    
    // Retornamos o ID gerado
    return res.status(201).json({ 
      mensagem: "Usuário criado!", 
      idCriado: resultado.insertedId 
    });
  }
}