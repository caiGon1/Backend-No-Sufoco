import clientPromise from "../../lib/mongodb.js";
import { ObjectId } from "mongodb";
import { verifyToken } from "../../middleware/authentication.js";

export async function handler(req, res) {
  if (req.method === "POST") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res
        .status(401)
        .json({ error: "Unauthorized: Invalid or missing token" });
    }

    try {
      const userId = req.user.id;
      const { ativosSelecionados } = req.body;

      if (!Array.isArray(ativosSelecionados)) {
        return res
          .status(400)
          .json({ error: "Formato inválido. Envie um array de ativos." });
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
      const valorMonitora =
        typeof monitoraAtual === "boolean" ? monitoraAtual : false;

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
      return res
        .status(500)
        .json({ error: "Erro interno ao processar os ativos." });
    }
  }

  if (req.method === "GET") {
    // 1. Verificação do token (assumindo que verifyToken retorna os dados do usuário ou popula o req.user)
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res
        .status(401)
        .json({ error: "Unauthorized: Invalid or missing token" });
    }

    try {
      // Dica: Se o seu verifyToken não estiver injetando no 'req.user',
      // você deve usar 'decodedUser.id' em vez de 'req.user.id'
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

      const acoesDoUsuario = usuario.acoes || { ativos: {} };
      const listaDeNomes = Object.keys(acoesDoUsuario.ativos);

      // Retorna: { ativos: ["PETR4", "VALE3", "BTC"] }
      return res.status(200).json({ ativos: listaDeNomes });
    } catch (error) {
      console.error("Erro ao buscar ativos:", error);
      return res
        .status(500)
        .json({ error: "Erro interno ao buscar os ativos." });
    }
  }

  if (req.method === "DELETE") {
    // 1. Verificação de segurança padrão
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res
        .status(401)
        .json({ error: "Unauthorized: Invalid or missing token" });
    }

    try {
      const userId = req.user?.id || decodedUser.id;

      // 2. O frontend deve enviar os ativos a serem deletados no body
      // Exemplo: { "ativosParaDeletar": ["PETR4", "BTC"] }
      const { ativosParaDeletar } = req.body;

      if (!Array.isArray(ativosParaDeletar) || ativosParaDeletar.length === 0) {
        return res
          .status(400)
          .json({ error: "Envie um array válido com os ativos para deletar." });
      }

      const client = await clientPromise;
      const db = client.db("NoSufocoDB");
      const usersCollection = db.collection("users");

      // 3. Monta o objeto dinâmico para o $unset
      // O MongoDB exige o formato: { $unset: { "acoes.ativos.PETR4": "", "acoes.ativos.BTC": "" } }
      const camposParaRemover = {};

      ativosParaDeletar.forEach((ativo) => {
        const tickerFormatado = ativo.toUpperCase();
        // O valor passado para o $unset não importa, geralmente usamos uma string vazia "" ou 1
        camposParaRemover[`acoes.ativos.${tickerFormatado}`] = "";
      });

      // 4. Executa a remoção no banco de dados
      const resultado = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $unset: camposParaRemover },
      );

      if (resultado.modifiedCount === 0) {
        return res
          .status(404)
          .json({ message: "Nenhum ativo foi encontrado para deletar." });
      }

      return res.status(200).json({ message: "Ativos removidos com sucesso!" });
    } catch (error) {
      console.error("Erro ao deletar ativos:", error);
      return res
        .status(500)
        .json({ error: "Erro interno ao deletar os ativos." });
    }
  }
}
