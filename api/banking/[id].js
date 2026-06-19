import { descriptografar, criptografar } from "../../middleware/crypto.js";
import clientPromise from "../../lib/mongodb.js";
import { ObjectId } from "mongodb";
import { extrairInformacoes, analiseDeTransacoes } from "../../src/service/index.js";
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
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    const { id } = req.query;

    if (!id || !ObjectId.isValid(id)) {
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(400).json({ status: "Erro", message: "ID de usuário inválido ou não fornecido." });
    }

    let arquivoForm = null;

    try {
      const form = formidable({});
      const [fields, files] = await form.parse(req);

      const senha = Array.isArray(fields.senha) ? fields.senha[0] : fields.senha;
      arquivoForm = Array.isArray(files.arquivo) ? files.arquivo[0] : files.arquivo;

      if (!arquivoForm || !arquivoForm.filepath) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
        return res.status(400).json({ status: "Erro", details: "Nenhum arquivo PDF foi detetado." });
      }

      const pdfBuffer = fs.readFileSync(arquivoForm.filepath);
      const resposta = await extrairInformacoes(pdfBuffer, senha);

      // =========================================================================
      // 🛠️ REAGRUPAMENTO DETERMINÍSTICO (BLINDADO E FLEXÍVEL)
      // =========================================================================
      const periodosCorrigidosMap = {};

      (resposta.periodos || []).forEach(p => {
        // Fallback: guarda o mesAno sugerido pela IA caso não consigamos ler da data da transação
        let fallbackMesAno = p.mesAno || "0/0000";
        if (fallbackMesAno.includes('-')) {
          fallbackMesAno = fallbackMesAno.replace('-', '/'); // Normaliza 05-2026 para 05/2026
        }

        (p.transacoes || []).forEach(t => {
          let mesAnoStr = null;

          if (t.data) {
            const dataStr = String(t.data).trim();
            
            // Tenta YYYY-MM-DD ou YYYY/MM/DD
            const matchISO = dataStr.match(/(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
            // Tenta DD/MM/YYYY, DD.MM.YYYY ou DD/MM/YY (ano de 2 a 4 dígitos)
            const matchBR = dataStr.match(/(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{2,4})/);

            if (matchISO) {
              mesAnoStr = `${parseInt(matchISO[2], 10)}/${matchISO[1]}`;
            } else if (matchBR) {
              let ano = matchBR[3];
              if (ano.length === 2) ano = "20" + ano; // Converte "26" em "2026"
              mesAnoStr = `${parseInt(matchBR[2], 10)}/${ano}`;
            }
          }

          // Se falhou em extrair a data (ex: a data no PDF era só "15/05"), 
          // aproveitamos o agrupamento que a Inteligência Artificial sugeriu.
          if (!mesAnoStr) {
            mesAnoStr = fallbackMesAno;
          }

          // Remove zeros à esquerda (ex: transforma "05/2026" em "5/2026")
          const partes = mesAnoStr.split('/');
          if (partes.length === 2 && partes[1] !== "0000") {
             mesAnoStr = `${parseInt(partes[0], 10)}/${partes[1]}`;
          }

          if (!periodosCorrigidosMap[mesAnoStr]) {
            periodosCorrigidosMap[mesAnoStr] = { mesAno: mesAnoStr, transacoes: [] };
          }
          periodosCorrigidosMap[mesAnoStr].transacoes.push(t);
        });
      });

      resposta.periodos = Object.values(periodosCorrigidosMap);

      // =========================================================================
      // 🔄 ESTRATÉGIA DE MESCLAGEM INTELIGENTE
      // =========================================================================
      const usuarioAtual = await db
        .collection("users")
        .findOne({ _id: new ObjectId(id) }, { projection: { periodos: 1 } });

      let periodosDoBanco = usuarioAtual?.periodos || [];
      const chavesExistentes = new Set();

      periodosDoBanco.forEach((p) => {
        if (!p.mesAno && p.mes && p.ano) {
          p.mesAno = `${p.mes}/${p.ano}`;
        }
        const periodoChave = p.mesAno;

        (p.transacoes || []).forEach((t) => {
          const dataDesc = descriptografar(t.data) || "";
          const descDesc = descriptografar(t.descricao) || "";
          const valorDesc = descriptografar(t.valor) !== undefined ? String(descriptografar(t.valor)) : "";
          
          chavesExistentes.add(`${periodoChave}-${dataDesc}-${descDesc}-${valorDesc}`);
        });
      });

      let houveNovasTransacoes = false;

      resposta.periodos.forEach((periodoNovo) => {
        const stringMesAno = periodoNovo.mesAno;

        let periodoExistenteNoBanco = periodosDoBanco.find(
          (p) =>
            p.mesAno === stringMesAno ||
            (p.mes === parseInt(stringMesAno.split('/')[0]) && p.ano === parseInt(stringMesAno.split('/')[1])),
        );

        const transacoesIneditas = (periodoNovo.transacoes || []).filter(
          (t) => {
            const chaveNova = `${stringMesAno}-${t.data}-${t.descricao}-${t.valor}`;
            return !chavesExistentes.has(chaveNova);
          },
        );

        if (transacoesIneditas.length > 0) {
          houveNovasTransacoes = true;

          const transacoesCriptografadas = transacoesIneditas.map((t) => ({
            data: criptografar(t.data || ""),
            descricao: criptografar(t.descricao || ""),
            valor: criptografar(t.valor !== undefined ? t.valor : 0),
            tipo: criptografar(t.tipo || "debito"),
            categoria: criptografar(t.categoria || "outros"),
            tags: criptografar(t.tags || "outros"), 
          }));

          if (periodoExistenteNoBanco) {
            if (!periodoExistenteNoBanco.transacoes) {
              periodoExistenteNoBanco.transacoes = [];
            }
            periodoExistenteNoBanco.mesAno = stringMesAno;
            periodoExistenteNoBanco.transacoes.push(...transacoesCriptografadas);
          } else {
            periodosDoBanco.push({
              mesAno: stringMesAno,
              transacoes: transacoesCriptografadas,
            });
          }
        }
      });

      // Log para terminal
      console.log("===== [DEBUG] PERÍODOS A SALVAR NO BANCO =====");
      periodosDoBanco.forEach((p, i) => {
        console.log(`  ${i + 1}: mesAno="${p.mesAno}" | ${p.transacoes?.length} transações`);
      });
      console.log("==============================================");

      if (houveNovasTransacoes) {
        await db.collection("users").updateOne(
          { _id: new ObjectId(id) },
          { $set: { periodos: periodosDoBanco } }
        );
      } else {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
        return res.status(400).json({ status: "Erro", message: "Todas as transações deste arquivo já foram importadas anteriormente." });
      }

      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(200).json({
        status: "Sucesso",
        message: "Arquivo processado. Novos registos mesclados com sucesso!",
        resposta: resposta,
      });
    } catch (e) {
      console.error("Erro interno no upload:", e);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(500).json({ status: "Erro", details: e.message });
    } finally {
      if (arquivoForm && arquivoForm.filepath && fs.existsSync(arquivoForm.filepath)) {
        fs.unlinkSync(arquivoForm.filepath);
      }
    }
  }

  // --- MÉTODO GET: Busca e Análise ---
  if (req.method === "GET") {
    const decodedUser = verifyToken(req);
    if (!decodedUser) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }
    const { id } = req.query;

    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({ status: "Erro", message: "ID inválido ou não fornecido." });
    }

    try {
      const usuario = await db.collection("users").findOne(
          { _id: new ObjectId(id) },
          { projection: { periodos: 1, _id: 0 } }
        );

      if (!usuario) {
        return res.status(404).json({ status: "Erro", message: "Utilizador não encontrado." });
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
          tags: t.tags ? descriptografar(t.tags) : "outros",
        }));

      if (transacoesDescriptografadas.length === 0) {
        return res.status(200).json({
          analise: "Nenhuma transação encontrada para analisar. Envie um extrato primeiro.",
        });
      }

      const analiseTexto = await analiseDeTransacoes(transacoesDescriptografadas);

      return res.status(200).json({ analise: analiseTexto });
    } catch (e) {
      console.error("Erro interno na análise:", e);
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
      return res.status(500).json({ status: "Erro", details: e.message });
    }
  }

  res.setHeader("Allow", ["POST", "GET"]);
  return res.status(405).json({ status: "Erro", message: `Método ${req.method} não permitido.` });
}