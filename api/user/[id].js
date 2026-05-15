import { ObjectId } from "mongodb"; // <-- Faltava essa importação!
import clientPromise from "../../lib/mongodb.js"; //conexão com o banco de dados

export default async function handler(req, res) {
  const client = await clientPromise;
  const db = client.db("NoSufocoDB"); //inicializa o banco de dados NoSufocoDB

  if (req.method === "GET") {
    const { id } = req.query; // Obtendo o ID do usuário a partir dos parâmetros da URL

    // Buscando o usuário pelo ID
    const usuario = await db
      .collection("users")
      .findOne({ _id: new ObjectId(id) });

    return res.status(200).json(usuario);
    }
    
  if (req.method === "PATCH") {
    try {
      const { id } = req.query;
      const { nome, email, senha, banco } = req.body;

      const dadosAtualizados = {};

      if (nome) dadosAtualizados.nome = nome;
      if (email) dadosAtualizados.email = email;
      if (banco) dadosAtualizados.banco = banco;
        if (senha) dadosAtualizados.senha = senha;

      const resultado = await db
        .collection("users")
        .updateOne({ _id: new ObjectId(id) }, { $set: dadosAtualizados });

      return res.status(200).json({
        mensagem: "Usuário atualizado!",
        resultado,
      });
    } catch (erro) {
      console.error(erro);

      return res.status(500).json({
        erro: "Erro interno do servidor",
      });
    }
  }

  if (req.method === "DELETE") {
    const { id } = req.query; // Obtendo o ID do usuário a partir dos parâmetros da URL
    // Deletando o usuário pelo ID
    const resultado = await db
      .collection("users")
      .deleteOne({ _id: new ObjectId(id) });
    return res.status(200).json({ mensagem: "Usuário deletado!", resultado });
  }
}
