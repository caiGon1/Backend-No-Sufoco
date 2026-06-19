import { descriptografar } from "../../middleware/crypto.js";
import { criptografar } from "../../middleware/crypto.js";
import clientPromise from "../../lib/mongodb.js";
import { ObjectId } from "mongodb";
import {
  extrairInformacoes,
  analiseDeTransacoes,
} from "../../src/service/index.js"; // Import unificado
import formidable from "formidable";
import { verifyToken } from "../../middleware/authentication.js";
import fs from "fs";
import cors from "../../middleware/cors.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // 1. Executa o middleware de CORS atualizado
  if (cors(req, res)) return;

  // 2. Trava de segurança para requisições Preflight que possam ter passado
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const client = await clientPromise;
  const db = client.db("NoSufocoDB");

  // --- MÉTODO POST: Upload e Extração ---
  if (req.method === "POST") {
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
      return res.status(400).json({
        status: "Erro",
        message: "ID de usuário inválido ou não fornecido.",
      });
    }

    let arquivoForm = null;

    try {
      const form = formidable({});
      const [fields, files] = await form.parse(req);

      const senha = Array.isArray(fields.senha) ? fields.senha[0] : fields.senha;
      arquivoForm = Array.isArray(files.arquivo) ? files.arquivo[0] : files.arquivo;

      if (!arquivoForm || !arquivoForm.filepath) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
        return res.status(400).json({
          status: "Erro",
          details: "Nenhum arquivo PDF foi detectado pelo servidor.",
        });
      }

      const pdfBuffer = fs.readFileSync(arquivoForm.filepath);
      const resposta = await extrairInformacoes(pdfBuffer, senha);


      const mesesDoExtrato = (resposta.periodos || []).map((p) => p.mesAno); // Ex: ["05/2026", "06/2026"]

      if (mesesDoExtrato.length > 0) {
        // 2. Procura no banco se este usuário específico já possui algum desses meses salvos
        const periodoExistente = await db.collection("users").findOne({
          _id: new ObjectId(id),
          "periodos.mesAno": { $in: mesesDoExtrato },
        });


        if (periodoExistente) {
          res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
          return res.status(400).json({
            status: "Erro",
            message: `Você já possui dados salvos para o período de: ${mesesDoExtrato.join(", ")}. Envie um mês diferente.`,
          });
        }
      }


      const periodosCriptografados = (resposta.periodos || []).map(
        (periodo) => ({
          ...periodo,
          transacoes: (periodo.transacoes || []).map((t) => ({
            ...t,
            data: criptografar(t.data),
            descricao: criptografar(t.descricao),
            valor: criptografar(t.valor),
            tipo: criptografar(t.tipo),
            categoria: criptografar(t.categoria),
          })),
        }),
      );

      await db.collection("users").updateOne(
        { _id: new ObjectId(id) },
        {
          $push: {
            periodos: {
              $each: periodosCriptografados,
            },
          },
        },
      );

      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(200).json({
        status: "Sucesso",
        message: "Arquivo processado e salvo no banco com segurança!",
        resposta: resposta, 
      });
    } catch (e) {
      console.error("Erro interno no upload:", e);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(500).json({
        status: "Erro",
        details: e.message,
      });
    } finally {
      if (
        arquivoForm &&
        arquivoForm.filepath &&
        fs.existsSync(arquivoForm.filepath)
      ) {
        fs.unlinkSync(arquivoForm.filepath);
      }
    }
  }

  // --- MÉTODO GET: Busca e Análise ---
  if (req.method === "GET") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      return res
        .status(401)
        .json({ error: "Unauthorized: Invalid or missing token" });
    }
    const { id } = req.query;

    if (!id || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ status: "Erro", message: "ID inválido ou não fornecido." });
    }

    try {
      const usuario = await db
        .collection("users")
        .findOne(
          { _id: new ObjectId(id) },
          { projection: { periodos: 1, _id: 0 } },
        );

      if (!usuario) {
        return res
          .status(404)
          .json({ status: "Erro", message: "Usuário não encontrado." });
      }

      const transacoesDescriptografadas = (usuario.periodos || [])
        .flatMap((p) => p.transacoes || [])
        .map((t) => ({
          ...t,
          data: descriptografar(t.data),
          descricao: descriptografar(t.descricao),
          valor: descriptografar(t.valor),
          tipo: descriptografar(t.tipo),
          categoria: descriptografar(t.categoria),
        }));

      if (transacoesDescriptografadas.length === 0) {
        return res.status(200).json({
          analise:
            "Nenhuma transação encontrada para analisar. Envie um extrato primeiro.",
        });
      }

      const analiseTexto = await analiseDeTransacoes(
        transacoesDescriptografadas,
      );

      return res.status(200).json({
        analise: analiseTexto,
      });
    } catch (e) {
      console.error("Erro interno na análise:", e);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(500).json({ status: "Erro", details: e.message });
    }
  }

  res.setHeader("Allow", ["POST", "GET"]);
  return res
    .status(405)
    .json({ status: "Erro", message: `Método ${req.method} não permitido.` });
}