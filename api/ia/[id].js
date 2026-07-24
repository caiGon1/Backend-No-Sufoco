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

// Função auxiliar para descriptografar sem derrubar a aplicação com throw
function tentarDescriptografar(valor) {
  if (!valor) return "";
  try {
    return descriptografar(valor);
  } catch (err) {
    // Se o valor já estiver em texto puro ou der erro, retorna o próprio valor
    return valor;
  }
}

export default async function handler(req, res) {
  // CORS Universal
 res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // 2. Responde o Preflight IMEDIATAMENTE (sem passar por nada pesado)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const client = await clientPromise;
  const db = client.db("NoSufocoDB");
  const usersCollection = db.collection("users");

  // =========================================================================
  // MÉTODO GET: Retorna Transações e Períodos para o Dashboard
  // =========================================================================
  if (req.method === "GET") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    const { id } = req.query;
    const userId = id || decodedUser.id;

    if (!userId || !ObjectId.isValid(userId)) {
      return res.status(400).json({ status: "Erro", message: "ID de usuário inválido." });
    }

    try {
      const usuario = await usersCollection.findOne(
        { _id: new ObjectId(userId) },
        { projection: { periodos: 1, preferencias: 1 } }
      );

      if (!usuario) {
        return res.status(404).json({ status: "Erro", message: "Usuário não encontrado." });
      }

      // Mapeia e descriptografa com segurança os períodos e transações
      const periodosTratados = (usuario.periodos || []).map((periodo) => {
        const transacoesDescriptografadas = (periodo.transacoes || []).map((t) => {
          try {
            if (t.dadosCriptografados) {
              const dados = JSON.parse(descriptografar(t.dadosCriptografados));
              return {
                uuid: t.uuid || dados.uuid,
                ...dados,
              };
            }

            // Fallback para estrutura com campos individualmente criptografados
            return {
              uuid: t.uuid,
              data: tentarDescriptografar(t.data),
              descricao: tentarDescriptografar(t.descricao),
              valor: typeof t.valor === "number" ? t.valor : Number(tentarDescriptografar(t.valor)),
              tipo: tentarDescriptografar(t.tipo) || "debito",
              categoria: tentarDescriptografar(t.categoriaEncrypted || t.categoria) || "outros",
              tags: t.tags ? tentarDescriptografar(t.tags) : "outros",
              parcela: t.parcela || { eParcela: false },
            };
          } catch (err) {
            console.error("Erro ao processar item de transação no GET:", err);
            return null;
          }
        }).filter(Boolean);

        return {
          ...periodo,
          transacoes: transacoesDescriptografadas,
        };
      });

      return res.status(200).json({
        status: "Sucesso",
        periodos: periodosTratados,
      });

    } catch (error) {
      console.error("ERRO 500 NO GET /api/ia/[id]:", error);
      return res.status(500).json({ 
        status: "Erro", 
        message: "Erro interno do servidor ao carregar dados.",
        details: error.message 
      });
    }
  }

  // =========================================================================
  // MÉTODO POST: Atualiza Preferências e Categorias
  // =========================================================================
  if (req.method === "POST") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    const { id } = req.query;
    const userId = id || decodedUser.id;

    if (!userId || !ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "ID de usuário inválido." });
    }

    const { alteracoes } = req.body;

    if (!alteracoes || !Array.isArray(alteracoes) || alteracoes.length === 0) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    try {
      for (const alteracao of alteracoes) {
        const { uuid, nome, categoria } = alteracao;

        const termoLimpo = normalizarTermo(nome);
        const termHash = gerarHash(termoLimpo);

        const termoCriptografado = criptografar(termoLimpo);
        const categoriaCriptografada = criptografar(categoria);

        // 1. Grava no objeto preferencias
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

        // 2. Grava na transação correspondente no extrato
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
      console.error("ERRO NO POST /api/ia/[id]:", error);
      return res.status(500).json({ error: "Internal server error", details: error.message });
    }
  }

  res.setHeader("Allow", ["POST", "GET"]);
  return res
    .status(405)
    .json({ status: "Erro", message: `Método ${req.method} não permitido.` });
}