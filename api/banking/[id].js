import clientPromise from "../../lib/mongodb.js";
import { ObjectId } from "mongodb";
import { extrairInformacoes } from "../../src/service/index.js";
import { analiseDeTransacoes } from "../../src/service/index.js";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const client = await clientPromise;
  const db = client.db("NoSufocoDB"); // Inicializa o banco de dados
  if (req.method === "POST") {
    const { id } = req.query; // Obtendo o ID do usuário a partir dos parâmetros da URL

    // Validando se o ID foi enviado e se é um formato válido de ObjectId antes de prosseguir
    if (!id || !ObjectId.isValid(id)) {
      return res.status(400).json({
        status: "Erro",
        message: "ID de usuário inválido ou não fornecido.",
      });
    }

    let arquivoForm = null; // Declarada fora para ser acessível no finally

    try {
      const form = formidable({});
      const [fields, files] = await new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          resolve([fields, files]);
        });
      });

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

      // Lê os bytes do arquivo
      const pdfBuffer = fs.readFileSync(arquivoForm.filepath);

      // Envia o buffer do PDF E a senha diretamente para a função da IA
      const resposta = await extrairInformacoes(pdfBuffer, senha);

      // --- ATUALIZAÇÃO NO BANCO DE DADOS ---
      // Fazemos o update AQUI, logo após obter o JSON de resposta com sucesso.
      // Usamos o await para garantir que o banco salvou antes de responder ao cliente.
      await db.collection("users").updateOne(
        { _id: new ObjectId(id) },
        { $push: { transacoes: resposta } }, // Cria/atualiza o campo 'transacoes' com o JSON
      );

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
      // O finally serve APENAS para limpar o arquivo temporário com segurança
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
    const { id } = req.query;

    // 1. Validação do ID para evitar que o código quebre
    if (!id || !ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ status: "Erro", message: "ID inválido ou não fornecido." });
    }

    try {
      const client = await clientPromise;
      const db = client.db("NoSufocoDB");

      // 2. Busca o usuário trazendo APENAS o campo 'transacoes' e excluindo o '_id'
      const usuario = await db
        .collection("users")
        .findOne(
          { _id: new ObjectId(id) },
          { projection: { transacoes: 1, _id: 0} },
        );

      // 3. Se o usuário não for encontrado
      if (!usuario) {
        return res
          .status(404)
          .json({ status: "Erro", message: "Usuário não encontrado." });
      }

      const transacoes = usuario.transacoes || [];

      // 4. Se não houver transações, avisa o frontend sem chamar a IA à toa
      if (transacoes.length === 0) {
        return res.status(200).json({
          transacoes: [],
          analise:
            "Nenhuma transação encontrada para analisar. Envie um extrato primeiro.",
        });
      }

      // 5. CHAMA A IA: Passa as transações do banco para a função do Gemini
      const analiseTexto = await analiseDeTransacoes(transacoes);

      // 6. Retorna o objeto completo com a lista de transações e o texto da análise
      return res.status(200).json({
        analise: analiseTexto,
      });
    } catch (e) {
      return res.status(500).json({ status: "Erro", details: e.message });
    }
  }
}
