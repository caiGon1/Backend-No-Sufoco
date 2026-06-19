import { ObjectId } from "mongodb";
import clientPromise from "../../lib/mongodb.js";
import { verifyToken } from "../../middleware/authentication.js";
import cors from "../../middleware/cors.js";
import { descriptografar } from "../../middleware/crypto.js"; // Garanta que o caminho está correto de acordo com sua estrutura

export default async function handler(req, res) {
  if (cors(req, res)) return;

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const client = await clientPromise;
  const db = client.db("NoSufocoDB");

  // --- MÉTODO GET: Busca Usuário e Descriptografa Transações ---
  if (req.method === "GET") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res
        .status(401)
        .json({ error: "Unauthorized: Invalid or missing token" });
    }

    const { id } = req.query;

    if (!id || !ObjectId.isValid(id)) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(400).json({ status: "Erro", message: "ID inválido." });
    }

    try {
      const usuario = await db
        .collection("users")
        .findOne({ _id: new ObjectId(id) });

      if (!usuario) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
        return res
          .status(404)
          .json({ status: "Erro", message: "Usuário não encontrado." });
      }

      // 🔓 MAPEAMENTO E DESCRIPTOGRAFIA: Restaura a integridade de todos os campos para o React
      if (usuario.periodos && Array.isArray(usuario.periodos)) {
        usuario.periodos = usuario.periodos.map((periodo) => ({
          ...periodo,
          transacoes: (periodo.transacoes || []).map((t) => ({
            ...t,
            data: descriptografar(t.data),
            descricao: descriptografar(t.descricao),
            valor: descriptografar(t.valor), // Voltará a ser do tipo numérico puro aqui
            tipo: descriptografar(t.tipo),
            categoria: descriptografar(t.categoria),
          })),
        }));
      }

      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(200).json(usuario);
    } catch (erro) {
      console.error(erro);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(500).json({ erro: "Erro interno ao buscar usuário." });
    }
  }

  // --- MÉTODO PATCH: Atualiza Dados ---
  if (req.method === "PATCH") {
    try {
      const decodedUser = verifyToken(req);
      if (!decodedUser) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
        return res
          .status(401)
          .json({ error: "Unauthorized: Invalid or missing token" });
      }
      const { id } = req.query;
      const { nome, email, senha, banco } = req.body;

      const dadosAtualizados = {};

      if (nome) dadosAtualizados.nome = nome;
      if (email) dadosAtualizados.email = email;
      if (banco) dadosAtualizados.banco = banco;
      if (senha) dadosAtualizados.senha = senha;

      const resultado = await db
        .collection("users")
        .updateOne({ _id: new ObjectId(id) }, { $set: dadosAtualizados });

      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(200).json({
        mensagem: "Usuário atualizado!",
        resultado,
      });
    } catch (erro) {
      console.error(erro);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(500).json({
        erro: "Erro interno do servidor",
      });
    }
  }

  // --- MÉTODO DELETE: Remove Usuário ---
  if (req.method === "DELETE") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res
        .status(401)
        .json({ error: "Unauthorized: Invalid or missing token" });
    }

    try {
      const { id } = req.query;
      const resultado = await db
        .collection("users")
        .deleteOne({ _id: new ObjectId(id) });

      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(200).json({ mensagem: "Usuário deletado!", resultado });
    } catch (erro) {
      console.error(erro);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res
        .status(500)
        .json({ erro: "Erro interno do servidor ao deletar." });
    }
  }

  res.setHeader("Allow", ["GET", "PATCH", "DELETE", "OPTIONS"]);
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  return res.status(405).json({ erro: `Método ${req.method} não permitido.` });
}
