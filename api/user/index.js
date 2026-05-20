import clientPromise from '../../lib/mongodb.js';//conexão com o banco de dados
import cors from '../../middleware/cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const client = await clientPromise;
  const db = client.db("NoSufocoDB"); //inicializa o banco de dados NoSufocoDB

  if (req.method === 'GET') {
    return res.status(200).json({ 
        status: "Online",
        sector: "User API",
        message: "Backend Serverless e MongoDB integrados com sucesso!" 
    });
  }
}