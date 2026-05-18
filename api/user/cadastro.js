import clientPromise from "../../lib/mongodb.js"; // Conexão com o banco de dados
import bcrypt from "bcrypt"; // Modificado para seguir o padrão import

export default async function handler(req, res) {
  // 1. Garante que só aceita requisições do tipo POST
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res
      .status(405)
      .json({ mensagem: `Método ${req.method} não permitido` });
  }

  try {
    const client = await clientPromise;
    const db = client.db("NoSufocoDB");

    const { nome, email, senha, banco } = req.body;

    // Validação simples (evita erros se o body vier vazio)
    if (!email || !senha) {
      return res
        .status(400)
        .json({ mensagem: "E-mail e senha são obrigatórios." });
    }

    // 2. Criptografa a senha (o return anterior foi removido)
    const saltRounds = 12;
    const senhaHash = await bcrypt.hash(senha, saltRounds);

    // 3. Insere o usuário no banco de dados
    const resultado = await db.collection("users").insertOne({
      nome,
      email,
      senhaHash,
      banco,
      criadoEm: new Date(), // Boa prática: salvar a data de criação
    });

    // 4. Retorna a resposta de sucesso
    return res.status(201).json({
      mensagem: "Usuário criado!",
      idCriado: resultado.insertedId,
    });
  } catch (error) {
    // Tratamento de erros caso o banco ou o bcrypt falhem
    console.error(error);
    return res.status(500).json({ mensagem: "Erro interno no servidor." });
  }
}
