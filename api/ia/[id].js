import clientPromise from "../../lib/mongodb";
import { descriptografar, criptorafrar } from "../../middleware/crypto";
import { verifyToken } from "../../lib/auth";
import { ObjectId } from "mongodb";
import crypto from "crypto";

function normalizarTermo(texto) {
  return texto
    .replace(/\d{2}\/\d{2}\/\d{4}/g, "")
    .replace(/Cp\s*:\s*\d+/gi, "Cp")
    .trim();
}

function gerarHash(texto) {
  return crypto.createHash("sha256").update(texto.toLowerCase()).digest("hex");
}

export default async function handler(req, res) {
  // =========================================================================
  // 1. CONFIGURAÇÃO EXPLÍCITA DE CORS (Bloqueia o erro de Preflight)
  // =========================================================================
  const allowedOrigins = ["https://no-sufoco.vercel.app", "http://localhost:5173"];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // O navegador dispara um OPTIONS antes do POST. Precisamos responder 200 OK.
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // =========================================================================
  // 2. LÓGICA PRINCIPAL DO BANCO DE DADOS
  // =========================================================================
  const client = await clientPromise;
  const db = client.db("NoSufocoDB");
  const usersCollection = db.collection("users");

  if (req.method === "POST") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    const userId = req.user?.id || decodedUser.id;
    const { alteracoes } = req.body;

    if (!alteracoes || !Array.isArray(alteracoes) || alteracoes.length === 0) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    try {
      for (const alteracao of alteracoes) {
        const { uuid, nome, categoria } = alteracao;

        // Processamento e Limpeza
        const termoLimpo = normalizarTermo(nome);
        const termHash = gerarHash(termoLimpo);

        // Criptografia
        const termoCriptografado = criptorafrar(termoLimpo);
        const categoriaCriptografada = criptorafrar(categoria);

        // Atualização A: Regra de Preferência
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              [`preferencias.${termHash}`]: {
                termoLimpoEncrypted: termoCriptografado,
                categoriaEncrypted: categoriaCriptografada,
                updatedAt: new Date(),
              },
            },
          }
        );

        // Atualização B: Transação específica no extrato
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              "periodo.$[p].transacoes.$[t].categoriaEncrypted": categoriaCriptografada,
              "periodo.$[p].transacoes.$[t].editadoManualmente": true,
            },
          },
          {
            arrayFilters: [
              { "p.transacoes": { $exists: true } },
              { "t.uuid": uuid },
            ],
          }
        );
      }

      return res.status(200).json({
        status: "Sucesso",
        message: "Preferências e transações atualizadas com sucesso!",
      });
    } catch (error) {
      console.error("Error updating preferences:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  res.setHeader("Allow", ["POST", "GET"]);
  return res
    .status(405)
    .json({ status: "Erro", message: `Método ${req.method} não permitido.` });
}