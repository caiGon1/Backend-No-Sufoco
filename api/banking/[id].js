import { descriptografar } from "../../middleware/crypto.js";
import { criptografar } from "../../middleware/crypto.js";
import clientPromise from "../../lib/mongodb.js";
import { ObjectId } from "mongodb";
import {
  extrairInformacoes,
  analiseDeTransacoes,
} from "../../src/service/index.js"; 
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
  if (cors(req, res)) return;

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const client = await clientPromise;
  const db = client.db("NoSufocoDB");

  // --- MÉTODO POST: Upload, Extração e Mesclagem Inteligente ---
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

      // =========================================================================
      // 🔄 ESTRATÉGIA DE MESCLAGEM INTELIGENTE (EVITA DUPLICADOS NO MESMO OBJETO)
      // =========================================================================
      
      // 1. Busca o usuário atualizado com todos os períodos que ele já tem salvos
      const usuarioAtual = await db.collection("users").findOne(
        { _id: new ObjectId(id) },
        { projection: { periodos: 1 } }
      );

      // Inicializa o array de períodos caso o usuário não tenha nenhum ainda
      let periodosDoBanco = usuarioAtual?.periodos || [];

      // Criamos um Set com hashes de todas as transações que JÁ EXISTEM no banco (para busca rápida)
      const chavesExistentes = new Set();
      periodosDoBanco.forEach((p) => {
        (p.transacoes || []).forEach((t) => {
          const dataDesc = descriptografar(t.data);
          const descDesc = descriptografar(t.descricao);
          const valorDesc = descriptografar(t.valor);
          // Geramos uma assinatura única baseada em texto limpo para cada transação existente
          chavesExistentes.add(`${dataDesc}-${descDesc}-${valorDesc}`);
        });
      });

      let houveNovasTransacoes = false;

      // 2. Itera sobre os períodos retornados pelo Gemini
      (resposta.periodos || []).forEach((periodoNovo) => {
        // Encontra se já existe um objeto para esse mesmo mês/ano no banco
        let periodoExistenteNoBanco = periodosDoBanco.find(
          (p) => p.mesAno === periodoNovo.mesAno
        );

        // Filtra apenas as transações enviadas agora que NÃO existem no banco
        const transacoesIneditas = (periodoNovo.transacoes || []).filter((t) => {
          const chaveNova = `${t.data}-${t.descricao}-${t.valor}`;
          return !chavesExistentes.has(chaveNova);
        });

        if (transacoesIneditas.length > 0) {
          houveNovasTransacoes = true;

          // Criptografa individualmente apenas as transações inéditas
          const transacoesCriptografadas = transacoesIneditas.map((t) => ({
            ...t,
            data: criptografar(t.data),
            descricao: criptografar(t.descricao),
            valor: criptografar(t.valor),
            tipo: criptografar(t.tipo),
            categoria: criptografar(t.categoria),
          }));

          if (periodoExistenteNoBanco) {
            // 🎯 SE O OBJETO DO MÊS JÁ EXISTE: Injeta as transações inéditas dentro dele!
            if (!periodoExistenteNoBanco.transacoes) {
              periodoExistenteNoBanco.transacoes = [];
            }
            periodoExistenteNoBanco.transacoes.push(...transacoesCriptografadas);
          } else {
            // 🌟 SE O MÊS É TOTALMENTE NOVO: Cria um novo objeto de período no array
            periodosDoBanco.push({
              ...periodoNovo,
              transacoes: transacoesCriptografadas,
            });
          }
        }
      });

      // 3. Atualiza o banco de dados se houver pelo menos uma linha nova encontrada
      if (houveNovasTransacoes) {
        await db.collection("users").updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              periodos: periodosDoBanco, // Subescreve o array com a versão unificada e limpa
            },
          }
        );
      } else {
        // Se todas as transações do PDF já constavam no banco
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
        return res.status(400).json({
          status: "Erro",
          message: "Todas as transações deste arquivo já foram importadas anteriormente.",
        });
      }

      // =========================================================================

      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(200).json({
        status: "Sucesso",
        message: "Arquivo processado. Novos registros mesclados com sucesso!",
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

  // --- MÉTODO GET: Busca e Análise (Inalterado) ---
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