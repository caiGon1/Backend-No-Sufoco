import { descriptografar, criptografar } from "../../middleware/crypto.js";
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
      return res
        .status(400)
        .json({
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
        return res
          .status(400)
          .json({
            status: "Erro",
            details: "Nenhum arquivo PDF foi detetado.",
          });
      }

      const pdfBuffer = fs.readFileSync(arquivoForm.filepath);
      const resposta = await extrairInformacoes(pdfBuffer, senha);

      // =========================================================================
      // 🛠️ REAGRUPAMENTO DETERMINÍSTICO (BLINDADO E FLEXÍVEL)
      // =========================================================================
      const periodosCorrigidosMap = {};

      (resposta.periodos || []).forEach((p) => {
        let fallbackMesAno = p.mesAno || "0/0000";
        if (fallbackMesAno.includes("-")) {
          fallbackMesAno = fallbackMesAno.replace("-", "/");
        }

        (p.transacoes || []).forEach((t) => {
          let mesAnoStr = null;

          if (t.data) {
            const dataStr = String(t.data).trim();

            const matchISO = dataStr.match(
              /(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/,
            );
            const matchBR = dataStr.match(
              /(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{2,4})/,
            );

            if (matchISO) {
              mesAnoStr = `${parseInt(matchISO[2], 10)}/${matchISO[1]}`;
            } else if (matchBR) {
              let ano = matchBR[3];
              if (ano.length === 2) ano = "20" + ano;
              mesAnoStr = `${parseInt(matchBR[2], 10)}/${ano}`;
            }
          }

          if (!mesAnoStr) {
            mesAnoStr = fallbackMesAno;
          }

          const partes = mesAnoStr.split("/");
          if (partes.length === 2 && partes[1] !== "0000") {
            mesAnoStr = `${parseInt(partes[0], 10)}/${partes[1]}`;
          }

          if (!periodosCorrigidosMap[mesAnoStr]) {
            periodosCorrigidosMap[mesAnoStr] = {
              mesAno: mesAnoStr,
              transacoes: [],
            };
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
          try {
            if (t.dadosCriptografados) {
              const objDescriptografado = JSON.parse(
                descriptografar(t.dadosCriptografados),
              );
              chavesExistentes.add(
                `${periodoChave}-${objDescriptografado.data}-${objDescriptografado.descricao}-${objDescriptografado.valor}`,
              );
            } else {
              const dataDesc = descriptografar(t.data) || "";
              const descDesc = descriptografar(t.descricao) || "";
              const valorDesc =
                t.valor !== undefined ? String(descriptografar(t.valor)) : "";
              chavesExistentes.add(
                `${periodoChave}-${dataDesc}-${descDesc}-${valorDesc}`,
              );
            }
          } catch (err) {
            console.error(
              "Erro ao descriptografar transação antiga para o Set:",
              err,
            );
          }
        });
      });

      let houveNovasTransacoes = false;

      resposta.periodos.forEach((periodoNovo) => {
        const stringMesAno = periodoNovo.mesAno;

        let periodoExistenteNoBanco = periodosDoBanco.find(
          (p) =>
            p.mesAno === stringMesAno ||
            (p.mes === parseInt(stringMesAno.split("/")[0]) &&
              p.ano === parseInt(stringMesAno.split("/")[1])),
        );

        const transacoesIneditas = (periodoNovo.transacoes || []).filter(
          (t) => {
            const chaveNova = `${stringMesAno}-${t.data}-${t.descricao}-${t.valor}`;
            return !chavesExistentes.has(chaveNova);
          },
        );

        if (transacoesIneditas.length > 0) {
          houveNovasTransacoes = true;

          const transacoesCriptografadas = transacoesIneditas.map((t) => {
            // 🛠️ FILTRO ANTIALUCINAÇÃO:
            // Se a IA marcou como parcela, mas o número da parcela atual for igual ao dia ou mês da transação,
            // ou se os valores vieram zerados/estranhos, nós forçamos o cancelamento da parcela por código.
            let parcelaTratada = t.parcela || { eParcela: false };

            if (parcelaTratada.eParcela) {
              const descricaoLetrasMinusculas = (
                t.descricao || ""
              ).toLowerCase();

              // Se não houver termos de parcelamento e a IA apenas se confundiu com números isolados
              const temSinalDeParcela =
                descricaoLetrasMinusculas.includes("parc") ||
                descricaoLetrasMinusculas.includes("/") ||
                descricaoLetrasMinusculas.includes("de");

              if (
                !temSinalDeParcela ||
                parcelaTratada.parcelaAtual === undefined
              ) {
                parcelaTratada = { eParcela: false }; // Reseta!
              }
            }

            const transacaoTratada = {
              data: t.data || "",
              descricao: t.descricao || "",
              valor: t.valor !== undefined ? t.valor : 0,
              tipo: t.tipo || "debito",
              categoria: t.categoria || "outros",
              tags: t.tags || "outros",
              parcela: parcelaTratada, // Salva o objeto higienizado
            };

            return {
              dadosCriptografados: criptografar(
                JSON.stringify(transacaoTratada),
              ),
            };
          });

          if (periodoExistenteNoBanco) {
            if (!periodoExistenteNoBanco.transacoes) {
              periodoExistenteNoBanco.transacoes = [];
            }
            periodoExistenteNoBanco.mesAno = stringMesAno;
            periodoExistenteNoBanco.transacoes.push(
              ...transacoesCriptografadas,
            );
          } else {
            periodosDoBanco.push({
              mesAno: stringMesAno,
              transacoes: transacoesCriptografadas,
            });
          }
        }
      });

      console.log("===== [DEBUG] PERÍODOS A SALVAR NO BANCO =====");
      periodosDoBanco.forEach((p, i) => {
        console.log(
          `  ${i + 1}: mesAno="${p.mesAno}" | ${p.transacoes?.length} transações`,
        );
      });
      console.log("==============================================");

      if (houveNovasTransacoes) {
        await db
          .collection("users")
          .updateOne(
            { _id: new ObjectId(id) },
            { $set: { periodos: periodosDoBanco } },
          );
      } else {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
        return res
          .status(400)
          .json({
            status: "Erro",
            message:
              "Todas as transações deste arquivo já foram importadas anteriormente.",
          });
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
          .json({ status: "Erro", message: "Utilizador não encontrado." });
      }

      const transacoesDescriptografadas = (usuario.periodos || [])
        .flatMap((p) => p.transacoes || [])
        .map((t) => {
          try {
            if (t.dadosCriptografados) {
              return JSON.parse(descriptografar(t.dadosCriptografados));
            }
            return {
              data: descriptografar(t.data),
              descricao: descriptografar(t.descricao),
              valor: descriptografar(t.valor),
              tipo: descriptografar(t.tipo),
              categoria: descriptografar(t.categoria),
              tags: t.tags ? descriptografar(t.tags) : "outros",
            };
          } catch (err) {
            console.error("Falha ao descriptografar item:", err);
            return null;
          }
        })
        .filter(Boolean);

      if (transacoesDescriptografadas.length === 0) {
        return res.status(200).json({
          analise:
            "Nenhuma transação encontrada para analisar. Envie um extrato primeiro.",
        });
      }

      const analiseTexto = await analiseDeTransacoes(
        transacoesDescriptografadas,
      );

      return res.status(200).json({ analise: analiseTexto });
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
