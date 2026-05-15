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
    if (req.method === 'PATCH') {
        const { id } = req.query; // Obtendo o ID do usuário a partir dos parâmetros da URL
        const { nome, email, senha, banco } = req.body; // Obtendo os dados atualizados do corpo da requisição
        // Atualizando o usuário pelo ID
        const resultado = await db.collection("users").updateOne(
            { _id: new ObjectId(id) },
            { $set: { nome, email, senha, banco } }
        );
        return res.status(200).json({ mensagem: "Usuário atualizado!", resultado });
    }
    if (req.method === 'DELETE') {
        const { id } = req.query; // Obtendo o ID do usuário a partir dos parâmetros da URL
        // Deletando o usuário pelo ID
        const resultado = await db.collection("users").deleteOne({ _id: new ObjectId(id) });
        return res.status(200).json({ mensagem: "Usuário deletado!", resultado });
    }
}
