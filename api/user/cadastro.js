import clientPromise from '../../lib/mongodb.js';//conexão com o banco de dados

export default async function handler(req, res) {
  const client = await clientPromise;
  const db = client.db("NoSufocoDB"); //inicializa o banco de dados NoSufocoDB

  if (req.method === 'POST') {
    const { nome, email, senha, banco} = req.body; // Recebendo os dados do corpo da requisição
    
    // Inserindo o usuário
    const resultado = await db.collection("users").insertOne({ nome, email, senha, banco }); // Inserindo o usuário na coleção "users"
    
    // Retornamos o ID gerado
    return res.status(201).json({ 
      mensagem: "Usuário criado!", 
      idCriado: resultado.insertedId 
    });
  }
}