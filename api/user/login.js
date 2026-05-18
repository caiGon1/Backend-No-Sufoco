import clientPromise from "../../lib/mongodb.js"; // Conexão com o banco de dados
import bcrypt from "bcrypt"; // Modificado para seguir o padrão import

export default async function handler(req, res) {
  // Garante que só aceita requisições do tipo POST
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res
      .status(405)
      .json({ message: `Method ${req.method} not allowed` });
  }

  try {
    const client = await clientPromise;
    const db = client.db("NoSufocoDB");

    const { email, senha } = req.body;

    // Validação simples dos campos recebidos
    if (!email || !senha) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // CORREÇÃO: Adicionado await e .collection("users")
    const user = await db.collection("users").findOne({ email });

    // Se o usuário não existir, retorna erro
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // CORREÇÃO: Alterado de user.senha para user.senhaHash (conforme o cadastro)
    const isMatch = await bcrypt.compare(senha, user.senhaHash);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // Sucesso: Login realizado com sucesso (Geralmente usa-se o status 200 para sucesso de login)
    return res.status(200).json({
      mensagem: "Login realizado!",
      user: { id: user._id, nome: user.nome, email: user.email },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
