import clientPromise from "../../lib/mongodb.js";
import bcrypt from "bcrypt";
import * as jwt from "jsonwebtoken";

function generateToken(userId, username) {
  const JWT_SECRET = process.env.JWT_SECRET;

  return jwt.sign(
    {
      id: userId.toString(),
      username: username,
    },
    JWT_SECRET,
    {
      expiresIn: "1h",
    }
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);

    return res.status(405).json({
      mensagem: `Método ${req.method} não permitido`,
    });
  }

  try {
    const client = await clientPromise;
    const db = client.db("NoSufocoDB");

    const { nome, email, senha, banco } = req.body;

    if (!email || !senha) {
      return res.status(400).json({
        mensagem: "E-mail e senha são obrigatórios.",
      });
    }

    const usuarioExistente = await db
      .collection("users")
      .findOne({ email });

    if (usuarioExistente) {
      return res.status(409).json({
        mensagem: "Este e-mail já está cadastrado.",
      });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const resultado = await db.collection("users").insertOne({
      nome,
      email,
      senhaHash,
      banco,
      criadoEm: new Date(),
    });

    const token = generateToken(resultado.insertedId, nome);

    return res.status(201).json({
      mensagem: "Usuário criado!",
      idCriado: resultado.insertedId,
      token,
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      mensagem: "Erro interno no servidor.",
    });
  }
}