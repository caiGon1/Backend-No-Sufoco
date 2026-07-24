import clientPromise from "../../../lib/mongodb";
import { descriptografar, criptografar } from "../../../middleware/crypto";
import { verifyToken } from "../../../lib/auth";
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

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

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

      // 🟢 Busca o usuário UMA vez, com os períodos, para localizar as transações
      const usuario = await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { periodos: 1 } }
      );

      if (!usuario) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      const naoEncontradas = [];

      for (const alteracao of alteracoes) {
        const { uuid, nome, categoria } = alteracao;

        // ---- 1) Atualiza preferências (aprendizado da IA) ----
        const termoLimpo = normalizarTermo(nome);
        const termHash = gerarHash(termoLimpo);
        const termoCriptografado = criptografar(termoLimpo);
        const categoriaCriptografada = criptografar(categoria);

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

        // ---- 2) Localiza a transação pelo uuid (em texto puro) dentro de periodos ----
        let transacaoEncontrada = null;

        for (const periodo of usuario.periodos || []) {
          const t = (periodo.transacoes || []).find((tr) => tr.uuid === uuid);
          if (t) {
            transacaoEncontrada = t;
            break;
          }
        }

        if (!transacaoEncontrada) {
          naoEncontradas.push(uuid);
          continue;
        }

        // ---- 3) Descriptografa o blob, edita a categoria, recriptografa ----
        let objTransacao;
        try {
          objTransacao = JSON.parse(descriptografar(transacaoEncontrada.dadosCriptografados));
        } catch (err) {
          console.error(`Erro ao descriptografar transação ${uuid}:`, err);
          naoEncontradas.push(uuid);
          continue;
        }

        objTransacao.categoria = categoria;

        const novoDadosCriptografados = criptografar(JSON.stringify(objTransacao));

        // ---- 4) Salva de volta usando arrayFilters (uuid é texto puro, pode filtrar direto) ----
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              "periodos.$[p].transacoes.$[t].dadosCriptografados": novoDadosCriptografados,
              "periodos.$[p].transacoes.$[t].editadoManualmente": true,
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
        naoEncontradas: naoEncontradas.length > 0 ? naoEncontradas : undefined,
      });
    }

    return res.status(405).json({ status: "Erro", message: "Método não permitido." });
  } catch (error) {
    console.error("Erro fatal na API de preferências:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      details: error.message,
    });
  }
}