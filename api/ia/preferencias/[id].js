import clientPromise from "../../../../lib/mongodb";
import { descriptografar, criptografar } from "../../../../middleware/crypto";
import { verifyToken } from "../../../../lib/auth";
import { ObjectId } from "mongodb";
import crypto from "crypto";

function normalizarTermo(texto) {
  if (!texto) return "";
  return texto
    .replace(/\d{2}\/\d{2}\/\d{4}/g, "")
    .replace(/Cp\s*:\s*\d+/gi, "Cp")
    .trim();
}

function gerarHash(texto) {
  return crypto.createHash("sha256").update(texto.toLowerCase()).digest("hex");
}

export default async function handler(req, res) {
  // 🟢 1. TRATAMENTO IMEDIATO E INCONDICIONAL DO PREFLIGHT (OPTIONS)
  // Responde 200 OK no topo absoluto do handler sem encostar em banco ou token
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 🟢 2. BLOCO TRY-CATCH GLOBAL PARA REQUISIÇÕES POST
  try {
    if (req.method === "POST") {
      const decodedUser = verifyToken(req);
      if (!decodedUser) {
        return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
      }

      const { id } = req.query;
      const userId = id || req.user?.id || decodedUser.id;

      if (!userId || !ObjectId.isValid(userId)) {
        return res.status(400).json({ error: "ID de usuário inválido." });
      }

      const { alteracoes } = req.body;

      if (!alteracoes || !Array.isArray(alteracoes) || alteracoes.length === 0) {
        return res.status(400).json({ error: "Invalid request body" });
      }

      const client = await clientPromise;
      const db = client.db("NoSufocoDB");
      const usersCollection = db.collection("users");

      for (const alteracao of alteracoes) {
        const { uuid, nome, categoria } = alteracao;

        const termoLimpo = normalizarTermo(nome);
        const termHash = gerarHash(termoLimpo);

        const termoCriptografado = criptografar(termoLimpo);
        const categoriaCriptografada = criptografar(categoria);

        // Atualização em preferências
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

        // Atualização no extrato pelo UUID da transação
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
    }

    return res.status(405).json({ status: "Erro", message: "Método não permitido." });
  } catch (error) {
    console.error("Erro fatal na API de preferências:", error);
    // Retorna JSON para o Axios conseguir ler a mensagem no lugar do erro de CORS
    return res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
    });
  }
}