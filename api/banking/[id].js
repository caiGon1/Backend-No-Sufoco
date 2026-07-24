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

// 1️⃣ IMPORTAÇÃO: Adicionado módulo crypto nativo do Node.js
import crypto from "crypto"; 

export const config = {
  api: {
    bodyParser: false,
  },
};

// =========================================================================
// 🛠️ FUNÇÕES DE NORMALIZAÇÃO (BUG 1 E BUG 2 FIXES)
// =========================================================================

// 🐛 BUG 1 FIX: Função única e centralizada para normalizar meses e anos.
function normalizarMesAno(mesAnoStr) {
  if (!mesAnoStr) return "0/0000";
  let str = String(mesAnoStr).trim();
  if (str.includes("-")) str = str.replace("-", "/");
  const partes = str.split("/");
  if (partes.length === 2) {
    const mes = parseInt(partes[0], 10) || 0;
    const ano = partes[1] === "0000" ? "0000" : partes[1];
    str = `${mes}/${ano}`; // Remove zero à esquerda do mês garantidamente
  }
  return str;
}

// 🐛 BUG 2 FIX: Funções para normalizar todos os campos que formam a chave da transação
function normalizarValor(valor) {
  const n = typeof valor === "string" ? parseFloat(valor.replace(",", ".")) : valor;
  return isNaN(n) ? "0.00" : n.toFixed(2);
}

function normalizarTexto(texto) {
  return String(texto || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\s+/g, " "); // remove múltiplos espaços seguidos
}

function normalizarData(data) {
  return String(data || "").trim().replace(/-/g, "/");
}

function gerarChaveTransacao(mesAno, data, descricao, valor) {
  return `${mesAno}-${normalizarData(data)}-${normalizarTexto(descricao)}-${normalizarValor(valor)}`;
}

// =========================================================================
// 🚀 HANDLER PRINCIPAL
// =========================================================================

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
          details: "Nenhum arquivo PDF foi detetado.",
        });
      }

      // =========================================================================
      // 🧠 BUSCA DE PREFERÊNCIAS DO USUÁRIO (APRENDIZADO PARA A IA)
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
      
      // 🔄 Passa a string de preferências como 3º parâmetro
      const resposta = await extrairInformacoes(pdfBuffer, senha, preferenciasFormatadas);

      // =========================================================================
      // 🛠️ REAGRUPAMENTO DETERMINÍSTICO (BLINDADO E FLEXÍVEL)
      // =========================================================================
      const periodosCorrigidosMap = {};

      (resposta.periodos || []).forEach((p) => {
        // 🐛 BUG 1 FIX: Usa a função de normalização limpa
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
      // 🔄 ESTRATÉGIA DE MESCLAGEM INTELIGENTE
      // =========================================================================
      let periodosDoBanco = usuarioAtual?.periodos || [];
      const chavesExistentes = new Set();

      periodosDoBanco.forEach((p) => {
        // Fallback caso mesAno não exista (dados antigos)
        if (!p.mesAno && p.mes && p.ano) {
          p.mesAno = `${p.mes}/${p.ano}`;
        }
        
        // 🐛 BUG 1 FIX: Normalizamos o período direto no array em memória para uso contínuo
        p.mesAno = normalizarMesAno(p.mesAno);
        const periodoChave = p.mesAno;

        (p.transacoes || []).forEach((t) => {
          try {
            if (t.dadosCriptografados) {
              const objDescriptografado = JSON.parse(
                descriptografar(t.dadosCriptografados),
              );
              
              // 🐛 BUG 2 FIX: Utilizando gerarChaveTransacao para padronizar
              chavesExistentes.add(
                gerarChaveTransacao(
                  periodoChave, 
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
              
              // 🐛 BUG 2 FIX: Utilizando gerarChaveTransacao para padronizar  
              chavesExistentes.add(
                gerarChaveTransacao(periodoChave, dataDesc, descDesc, valorDesc)
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
        // Já foi normalizado no bloco REAGRUPAMENTO
        const stringMesAno = periodoNovo.mesAno;

        // 🐛 BUG 1 FIX: Como as propriedades estão devidamente normalizadas em ambos lados, 
        // a comparação simples resolverá 100% dos casos de duplicidade de mês.
        let periodoExistenteNoBanco = periodosDoBanco.find(
          (p) => p.mesAno === stringMesAno
        );

        const transacoesIneditas = (periodoNovo.transacoes || []).filter(
          (t) => {
            // 🐛 BUG 2 FIX: Verificamos contra o Banco usando a mesma chave formatada 
            // livre de case-sensitivity, acentos e espaços não determinísticos
            const chaveNova = gerarChaveTransacao(stringMesAno, t.data, t.descricao, t.valor);
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
            //----------------------------------------------------------------------
            // GERAÇÃO DO UUID
            //----------------------------------------------------------------------
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
            // Atualizamos a string normalizada apenas por segurança
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
              const objDescriptografado = JSON.parse(descriptografar(t.dadosCriptografados));
              
              // 3️⃣ RETORNO DO GET: Garante que o UUID raiz seja passado de volta na listagem
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