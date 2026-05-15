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
  if (req.method !== "PATCH")
    return res.status(405).json({ error: "Método não permitido" });

  try {
    const { id } = req.query;
    const client = await clientPromise;
    const db = client.db("NoSufocoDB");

    // 1. Validar ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    // 2. Filtrar apenas o que foi enviado (Proteção contra undefined)
    // Isso impede que você apague dados por acidente se o body vier incompleto
    const camposParaAtualizar = {};
    const permitidos = ["nome", "email", "senha", "banco"];

    permitidos.forEach((campo) => {
      if (req.body[campo] !== undefined) {
        camposParaAtualizar[campo] = req.body[campo];
      }
    });

    if (Object.keys(camposParaAtualizar).length === 0) {
      return res
        .status(400)
        .json({ error: "Nenhum dado enviado para atualização" });
    }

    // 3. Executar a atualização
    const resultado = await db
      .collection("users")
      .updateOne({ _id: new ObjectId(id) }, { $set: camposParaAtualizar });

    // 4. Verificar se o usuário existia
    if (resultado.matchedCount === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    return res.status(200).json({
      mensagem: "Usuário atualizado!",
      modificado: resultado.modifiedCount > 0,
    });
  } catch (error) {
    return res.status(500).json({ error: "Erro interno: " + error.message });
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
