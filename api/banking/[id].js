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
  // 1. Executa o middleware de CORS atualizado
  if (cors(req, res)) return;

  // 2. Trava de segurança para requisições Preflight
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

      const senha = Array.isArray(fields.senha)
        ? fields.senha[0]
        : fields.senha;
      arquivoForm = Array.isArray(files.arquivo)
        ? files.arquivo[0]
        : files.arquivo;

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
      // 🔄 ESTRATÉGIA DE MESCLAGEM INTELIGENTE ATUALIZADA (BLINDADA CONTRA CONFLITO DE MESES)
      // =========================================================================

      // 1. Busca o usuário com os períodos atuais salvos
      const usuarioAtual = await db
        .collection("users")
        .findOne({ _id: new ObjectId(id) }, { projection: { periodos: 1 } });

      let periodosDoBanco = usuarioAtual?.periodos || [];

      // Criamos um Set com assinaturas de texto limpo + período correspondente para evitar falsos positivos
      const chavesExistentes = new Set();

      periodosDoBanco.forEach((p) => {
        // Compatibilidade: se o banco tem período antigo com mes/ano separados, normaliza para o front
        if (!p.mesAno && p.mes && p.ano) {
          p.mesAno = `${p.mes}/${p.ano}`;
        }

        const periodoChave = p.mesAno;

        (p.transacoes || []).forEach((t) => {
          const dataDesc = descriptografar(t.data) || "";
          const descDesc = descriptografar(t.descricao) || "";
          const valorDesc =
            descriptografar(t.valor) !== undefined
              ? String(descriptografar(t.valor))
              : "";

          // 🔒 ALTERAÇÃO: Vincula a chave estritamente ao período dela.
          // Isso garante que se 'maio' foi parar erroneamente em 'junho' no banco por bugs passados,
          // o arquivo novo que processa o mês correto de 'maio' ainda consiga inserir seus registros normalmente.
          chavesExistentes.add(`${periodoChave}-${dataDesc}-${descDesc}-${valorDesc}`);
        });
      });

      let houveNovasTransacoes = false;

      // 2. Itera sobre os períodos retornados pelo Gemini
      (resposta.periodos || []).forEach((periodoNovo) => {
        // Fallback: se por acaso a IA mandar separado, monta a string esperada pelo front
        const stringMesAno =
          periodoNovo.mesAno || `${periodoNovo.mes}/${periodoNovo.ano}`;
        periodoNovo.mesAno = stringMesAno;

        // Procura o mês correspondente no histórico (aceita checagem por string ou legado)
        let periodoExistenteNoBanco = periodosDoBanco.find(
          (p) =>
            p.mesAno === stringMesAno ||
            (p.mes === periodoNovo.mes && p.ano === periodoNovo.ano),
        );

        // Filtra apenas as transações do PDF que não existem NESTE período específico do banco
        const transacoesIneditas = (periodoNovo.transacoes || []).filter(
          (t) => {
            // 🔒 ALTERAÇÃO: Valida se a transação já existe dentro deste escopo de mês/ano específico
            const chaveNova = `${stringMesAno}-${t.data}-${t.descricao}-${t.valor}`;
            return !chavesExistentes.has(chaveNova);
          },
        );

        if (transacoesIneditas.length > 0) {
          houveNovasTransacoes = true;

          // Criptografa blindando contra propriedades vazias ou nulas
          const transacoesCriptografadas = transacoesIneditas.map((t) => ({
            data: criptografar(t.data || ""),
            descricao: criptografar(t.descricao || ""),
            valor: criptografar(t.valor !== undefined ? t.valor : 0),
            tipo: criptografar(t.tipo || "debito"),
            categoria: criptografar(t.categoria || "outros"),
            tags: criptografar(t.tags || "outros"), // 🔒 Suporta o campo tags do seu layout
          }));

          if (periodoExistenteNoBanco) {
            // Se o bloco do mês já existe, injeta apenas o que sobrou de inédito dentro dele
            if (!periodoExistenteNoBanco.transacoes) {
              periodoExistenteNoBanco.transacoes = [];
            }
            periodoExistenteNoBanco.mesAno = stringMesAno; // Garante a consistência do campo
            periodoExistenteNoBanco.transacoes.push(
              ...transacoesCriptografadas,
            );
          } else {
            // Se o mês é inédito, adiciona a nova estrutura organizada por mês/ano
            periodosDoBanco.push({
              mesAno: stringMesAno,
              transacoes: transacoesCriptografadas,
            });
          }
        }
      });

      // Bloco de logs para acompanhamento
      console.log("===== [DEBUG] PERÍODOS A SALVAR =====");
      periodosDoBanco.forEach((p, i) => {
        console.log(
          `  ${i + 1}: mesAno="${p.mesAno}" | ${p.transacoes?.length} transações`,
        );
      });
      console.log("=====================================");

      // 3. Salva no banco apenas se houver novas atualizações de transações
      if (houveNovasTransacoes) {
        await db.collection("users").updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              periodos: periodosDoBanco,
            },
          },
        );
      } else {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
        return res.status(400).json({
          status: "Erro",
          message:
            "Todas as transações deste arquivo já foram importadas anteriormente.",
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
          tags: t.tags ? descriptografar(t.tags) : "outros", // Tratamento dinâmico para registros legados que não tinham tags
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