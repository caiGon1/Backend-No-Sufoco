import clientPromise from "../../lib/mongodb.js";
import bcrypt from "bcrypt";
import cors from "../../middleware/cors.js";

function generateToken(user) {
  const jwt = require("jsonwebtoken");

  const JWT_SECRET = process.env.JWT_SECRET;

  return jwt.sign(
    {
      id: user._id,
      username: user.nome,
    },
    JWT_SECRET,
    {
      expiresIn: "1h",
    }
  );
}

export default async function handler(req, res) {
  // CORS
  const finished = cors(req, res);

  if (finished) return;

  // Só aceita POST
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);

    return res.status(405).json({
      message: `Method ${req.method} not allowed`,
    });
  }

  try {
    const client = await clientPromise;

    const db = client.db("NoSufocoDB");

    const { email, senha } = req.body;

    // Validação
    if (!email || !senha) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    // Busca usuário
    const user = await db
      .collection("users")
      .findOne({ email });

    if (!user) {
      return res.status(400).json({
        message: "Invalid email or password",
      });
    }

    // Verifica senha
    const isMatch = await bcrypt.compare(
      senha,
      user.senhaHash
    );

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid email or password",
      });
    }

    // Login OK
    return res.status(200).json({
      mensagem: "Login realizado!",
      user: {
        id: user._id,
        nome: user.nome,
        email: user.email,
      },
      token: generateToken(user),
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: "Internal server error",
    });
  }
}