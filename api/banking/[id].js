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
import crypto from "crypto"; 

export const config = {
  api: {
    bodyParser: false,
  },
};

// =========================================================================
// FUNÇÕES DE NORMALIZAÇÃO
// =========================================================================

function normalizarMesAno(mesAnoStr) {
  if (!mesAnoStr) return "0/0000";
  let str = String(mesAnoStr).trim();
  if (str.includes("-")) str = str.replace("-", "/");
  const partes = str.split("/");
  if (partes.length === 2) {
    const mes = parseInt(partes[0], 10) || 0;
    const ano = partes[1] === "0000" ? "0000" : partes[1];
    str = `${mes}/${ano}`; 
  }
  return str;
}
function normalizarValor(valor) {
  const n = typeof valor === "string" ? parseFloat(valor.replace(",", ".")) : valor;
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function normalizarTexto(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
    .replace(/\s*(?:-\s*)?\(?\b\d{1,2}\/\d{1,2}\b\)?/g, "")
    .replace(/\bparcela\s+\d+\s+de\s+\d+\b/g, "")
    .replace(/\s+/g, " ") 
    .trim();
}

function normalizarData(data) {
  return String(data || "").trim().replace(/-/g, "/");
}

function gerarChaveTransacao(data, descricao, valor) {
  return `${normalizarData(data)}-${normalizarTexto(descricao)}-${normalizarValor(valor)}`;
}

// =========================================================================
// HANDLER PRINCIPAL
// =========================================================================

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const client = await clientPromise;
  const db = client.db("NoSufocoDB");

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
          details: "Nenhum arquivo PDF foi detetado.",
        });
      }

      // =========================================================================
      // BUSCA DE PREFERÊNCIAS DO USUÁRIO
      // =========================================================================
      const usuarioAtual = await db
        .collection("users")
        .findOne(
          { _id: new ObjectId(id) }, 
          { projection: { periodos: 1, preferencias: 1 } }
        );

      let preferenciasFormatadas = "";

      if (usuarioAtual && usuarioAtual.preferencias) {
        const listaPref = Object.values(usuarioAtual.preferencias);

        preferenciasFormatadas = listaPref
          .map((pref) => {
            try {
              const termo = descriptografar(pref.termoLimpoEncrypted);
              const cat = descriptografar(pref.categoriaEncrypted);
              return `- "${termo}" categorizar como: ${cat}`;
            } catch (err) {
              return null;
            }
          })
          .filter(Boolean)
          .join("\n");
      }

      const pdfBuffer = fs.readFileSync(arquivoForm.filepath);
      const resposta = await extrairInformacoes(pdfBuffer, senha, preferenciasFormatadas);

      // =========================================================================
      // REAGRUPAMENTO DETERMINÍSTICO
      // =========================================================================
      const periodosCorrigidosMap = {};

      (resposta.periodos || []).forEach((p) => {
        const mesAnoStr = normalizarMesAno(p.mesAno);

        if (!periodosCorrigidosMap[mesAnoStr]) {
          periodosCorrigidosMap[mesAnoStr] = {
            mesAno: mesAnoStr,
            transacoes: [],
          };
        }

        (p.transacoes || []).forEach((t) => {
          periodosCorrigidosMap[mesAnoStr].transacoes.push(t);
        });
      });

      resposta.periodos = Object.values(periodosCorrigidosMap);

      // =========================================================================
      // ESTRATÉGIA DE MESCLAGEM INTELIGENTE
      // =========================================================================
let periodosDoBanco = usuarioAtual?.periodos || [];
      const chavesExistentes = new Set();

      periodosDoBanco.forEach((p) => {
        if (!p.mesAno && p.mes && p.ano) {
          p.mesAno = `${p.mes}/${p.ano}`;
        }
        
        p.mesAno = normalizarMesAno(p.mesAno);
        (p.transacoes || []).forEach((t) => {
          try {
            if (t.dadosCriptografados) {
              const objDescriptografado = JSON.parse(
                descriptografar(t.dadosCriptografados),
              );
              chavesExistentes.add(
                gerarChaveTransacao(
                  objDescriptografado.data, 
                  objDescriptografado.descricao, 
                  objDescriptografado.valor
                )
              );
            } else {
              const dataDesc = descriptografar(t.data) || "";
              const descDesc = descriptografar(t.descricao) || "";
              const valorDesc =
                t.valor !== undefined ? String(descriptografar(t.valor)) : "";

              chavesExistentes.add(
                gerarChaveTransacao(dataDesc, descDesc, valorDesc)
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
          (p) => p.mesAno === stringMesAno
        );

        const transacoesIneditas = (periodoNovo.transacoes || []).filter(
          (t) => {
            const chaveNova = gerarChaveTransacao(t.data, t.descricao, t.valor);
            return !chavesExistentes.has(chaveNova);
          },
        );

        if (transacoesIneditas.length > 0) {
          houveNovasTransacoes = true;

          const transacoesCriptografadas = transacoesIneditas.map((t) => {
            let parcelaTratada = t.parcela || { eParcela: false };

            if (parcelaTratada.eParcela) {
              if (
                parcelaTratada.parcelaAtual === undefined ||
                parcelaTratada.parcelaFinal === undefined ||
                parcelaTratada.parcelaFinal <= 1 ||
                parcelaTratada.parcelaAtual > parcelaTratada.parcelaFinal
              ) {
                parcelaTratada = { eParcela: false };
              }
            }

            const transacaoUuid = crypto.randomUUID();

            const transacaoTratada = {
              uuid: transacaoUuid,
              data: t.data || "",
              descricao: t.descricao || "",
              valor: t.valor !== undefined ? t.valor : 0,
              tipo: t.tipo || "debito",
              categoria: t.categoria || "outros",
              tags: t.tags || "outros",
              parcela: parcelaTratada,
            };

            return {
              uuid: transacaoUuid, 
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
        return res.status(400).json({
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
              const objDescriptografado = JSON.parse(descriptografar(t.dadosCriptografados));
              return { 
                uuid: t.uuid || objDescriptografado.uuid, 
                ...objDescriptografado 
              };
            }
            return {
              uuid: t.uuid,
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