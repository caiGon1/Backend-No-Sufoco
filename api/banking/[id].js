import clientPromise from "../../lib/mongodb.js";
import { ObjectId } from "mongodb";
import {
  extrairInformacoes,
  analiseDeTransacoes,
} from "../../src/service/index.js"; // Import unificado
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false, // Desabilita o parser padrão para o formidable funcionar
  },
};

export default async function handler(req, res) {
  // Inicialização global do banco de dados para ambos os métodos (POST e GET)
  const client = await clientPromise;
  const db = client.db("NoSufocoDB");

  // --- MÉTODO POST: Upload e Extração ---
  if (req.method === "POST") {
    const { id } = req.query;

    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "Erro",
        message: "ID de usuário inválido ou não fornecido.",
      });
    }

    let arquivoForm = null;

    try {
      const form = formidable({});

      const [fields, files] = await form.parse(req);

      const senha = Array.isArray(fields.senha)
        ? fields.senha[0]
        : fields.senha;
      arquivoForm = Array.isArray(files.arquivo)
        ? files.arquivo[0]
        : files.arquivo;

      if (!arquivoForm || !arquivoForm.filepath) {
        return res.status(400).json({
          status: "Erro",
          details: "Nenhum arquivo PDF foi detectado pelo servidor.",
        });
      }

      const pdfBuffer = fs.readFileSync(arquivoForm.filepath);
      const resposta = await extrairInformacoes(pdfBuffer, senha);

      const resultado = await db.collection("users").updateOne(
        { _id: new ObjectId(id) },
        {
          $push: {
            transacoes: resposta.transacoes || [],
          },
        },
      );

      console.log(resultado);

      return res.status(200).json({
        status: "Sucesso",
        message: "Arquivo processado e salvo no banco com sucesso!",
        resposta: resposta,
      });
    } catch (e) {
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
    const { id } = req.query;

    if (!id || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ status: "Erro", message: "ID inválido ou não fornecido." });
    }

    try {
      // CORREÇÃO: Removida a reinicialização duplicada de client e db
      const usuario = await db
        .collection("users")
        .findOne(
          { _id: new ObjectId(id) },
          { projection: { transacoes: 1, _id: 0 } },
        );

      if (!usuario) {
        return res
          .status(404)
          .json({ status: "Erro", message: "Usuário não encontrado." });
      }

      const transacoes = usuario.transacoes || [];

      if (transacoes.length === 0) {
        return res.status(200).json({
          transacoes: [],
          analise:
            "Nenhuma transação encontrada para analisar. Envie um extrato primeiro.",
        });
      }

      const analiseTexto = await analiseDeTransacoes(transacoes);

      return res.status(200).json({
        transacoes: transacoes, // Ajustado para de fato retornar a lista se o front precisar
        analise: analiseTexto,
      });
    } catch (e) {
      return res.status(500).json({ status: "Erro", details: e.message });
    }
  }

  // CORREÇÃO: Fallback obrigatório caso usem PUT, DELETE, etc.
  res.setHeader("Allow", ["POST", "GET"]);
  return res
    .status(405)
    .json({ status: "Erro", message: `Método ${req.method} não permitido.` });
}
