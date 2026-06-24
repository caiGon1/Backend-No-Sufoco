import clientPromise from "../../lib/mongodb.js";
import { ObjectId } from "mongodb";
import { verifyToken } from "../../middleware/authentication.js";
import cors from "../../middleware/cors.js";

export default async function handler(req, res) {
      if (cors(req, res)) return;
  // ==========================================
  // POST: SALVAR NOVOS ATIVOS SELECIONADOS
  // ==========================================
  if (req.method === "POST") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    try {
      // CORREÇÃO: Padronizado igual aos outros métodos para evitar TypeError
      const userId = req.user?.id || decodedUser.id;
      const { ativosSelecionados } = req.body;

      if (!Array.isArray(ativosSelecionados)) {
        return res.status(400).json({ error: "Formato inválido. Envie um array de ativos." });
      }

      const client = await clientPromise;
      const db = client.db("NoSufocoDB");
      const usersCollection = db.collection("users");

      const usuario = await usersCollection.findOne({
        _id: new ObjectId(userId),
      });

      if (!usuario) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      const monitoraAtual = usuario.acoes?.monitora;
      const valorMonitora = typeof monitoraAtual === "boolean" ? monitoraAtual : false;

      const camposParaAtualizar = {
        "acoes.monitora": valorMonitora,
      };

      ativosSelecionados.forEach((ativo) => {
        const tickerFormatado = ativo.toUpperCase();

        if (usuario.acoes?.ativos?.[tickerFormatado] === undefined) {
          camposParaAtualizar[`acoes.ativos.${tickerFormatado}`] = false;
        }
      });

      await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: camposParaAtualizar },
      );

      return res.status(200).json({ message: "Ativos salvos com sucesso!" });
    } catch (error) {
      console.error("Erro ao salvar ativos:", error);
      return res.status(500).json({ error: "Erro interno ao processar os ativos." });
    }
  }

  // ==========================================
  // GET: BUSCAR OS ATIVOS DO USUÁRIO
  // ==========================================
  if (req.method === "GET") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    try {
      const userId = req.user?.id || decodedUser.id;

      const client = await clientPromise;
      const db = client.db("NoSufocoDB");
      const usersCollection = db.collection("users");

      const usuario = await usersCollection.findOne({
        _id: new ObjectId(userId),
      });

      if (!usuario) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      // CORREÇÃO: Deixando mais seguro para evitar "Cannot convert undefined or null to object"
      const ativosDoUsuario = usuario.acoes?.ativos || {};
      const listaDeNomes = Object.keys(ativosDoUsuario);

      // Retorna: { ativos: ["PETR4", "VALE3", "BTC"] }
      return res.status(200).json({ ativos: listaDeNomes });
    } catch (error) {
      console.error("Erro ao buscar ativos:", error);
      return res.status(500).json({ error: "Erro interno ao buscar os ativos." });
    }
  }

  // ==========================================
  // DELETE: REMOVER ATIVOS ESPECÍFICOS
  // ==========================================
  if (req.method === "DELETE") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    try {
      const userId = req.user?.id || decodedUser.id;
      const { ativosParaDeletar } = req.body;

      if (!Array.isArray(ativosParaDeletar) || ativosParaDeletar.length === 0) {
        return res.status(400).json({ error: "Envie um array válido com os ativos para deletar." });
      }

      const client = await clientPromise;
      const db = client.db("NoSufocoDB");
      const usersCollection = db.collection("users");

      const camposParaRemover = {};

      ativosParaDeletar.forEach((ativo) => {
        const tickerFormatado = ativo.toUpperCase();
        camposParaRemover[`acoes.ativos.${tickerFormatado}`] = "";
      });

      const resultado = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $unset: camposParaRemover },
      );

      if (resultado.modifiedCount === 0) {
        return res.status(404).json({ message: "Nenhum ativo foi encontrado para deletar." });
      }

      return res.status(200).json({ message: "Ativos removidos com sucesso!" });
    } catch (error) {
      console.error("Erro ao deletar ativos:", error);
      return res.status(500).json({ error: "Erro interno ao deletar os ativos." });
    }
  }

  // ==========================================
  // PUT / PATCH: ATUALIZAR STATUS DE MONITORAMENTO
  // ==========================================
  if (req.method === "PUT" || req.method === "PATCH") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    try {
      const userId = req.user?.id || decodedUser.id;
      const { monitoraGlobal, alteracoesAtivos } = req.body;

      const client = await clientPromise;
      const db = client.db("NoSufocoDB");
      const usersCollection = db.collection("users");

      const camposParaAtualizar = {};

      if (typeof monitoraGlobal === "boolean") {
        camposParaAtualizar["acoes.monitora"] = monitoraGlobal;
      }

      if (alteracoesAtivos && typeof alteracoesAtivos === "object") {
        for (const [ticker, status] of Object.entries(alteracoesAtivos)) {
          const tickerFormatado = ticker.toUpperCase();
          camposParaAtualizar[`acoes.ativos.${tickerFormatado}`] = status;
        }
      }

      if (Object.keys(camposParaAtualizar).length === 0) {
        return res.status(400).json({ error: "Nenhum dado válido enviado para atualização." });
      }

      const resultado = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: camposParaAtualizar }
      );

      if (resultado.matchedCount === 0) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      return res.status(200).json({ message: "Configurações de monitoramento atualizadas!" });
    } catch (error) {
      console.error("Erro ao atualizar monitoramento:", error);
      return res.status(500).json({ error: "Erro interno ao atualizar configurações." });
    }
  }


  res.setHeader("Allow", ["GET", "POST", "PUT", "PATCH", "DELETE"]);
  return res.status(405).json({ error: `Método ${req.method} não permitido` });
}