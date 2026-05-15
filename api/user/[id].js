import { ObjectId } from 'mongodb'; // <-- Faltava essa importação!
import clientPromise from '../../lib/mongodb.js';//conexão com o banco de dados

export default async function handler(req, res) {
    const client = await clientPromise;
    const db = client.db("NoSufocoDB"); //inicializa o banco de dados NoSufocoDB
    
    if (req.method === 'GET') {
        const { id } = req.query; // Obtendo o ID do usuário a partir dos parâmetros da URL
        
        // Buscando o usuário pelo ID
        const usuario = await db.collection("users").findOne({ _id: new ObjectId(id) });

        return res.status(200).json(usuario);
    }
}
