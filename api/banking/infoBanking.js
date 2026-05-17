import clientPromise from "../../lib/mongodb.js";
import { extrairInformacoes } from "../../src/service/index.js";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ status: "Erro", message: "Método não permitido" });
  }

  try {
    const client = await clientPromise;
    await client.db("admin").command({ ping: 1 });

    const form = formidable({});

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    const senha = Array.isArray(fields.senha) ? fields.senha[0] : fields.senha;
    const arquivoForm = Array.isArray(files.arquivo)
      ? files.arquivo[0]
      : files.arquivo;

    if (!arquivoForm || !arquivoForm.filepath) {
      return res.status(400).json({
        status: "Erro",
        details: "Nenhum arquivo PDF foi detectado pelo servidor.",
      });
    }

    // Lê os bytes do arquivo (ele vai protegido por senha mesmo)
    const pdfBuffer = fs.readFileSync(arquivoForm.filepath);

    // Envia o buffer do PDF E a senha diretamente para a função do serviço da IA
    const resposta = await extrairInformacoes(pdfBuffer, senha);

    return res.status(200).json({
      status: "Sucesso",
      message: "Arquivo processado com sucesso pelo Gemini!",
      resposta: resposta,
    });
  } catch (e) {
    return res.status(500).json({
      status: "Erro",
      details: e.message,
    });
  } finally {
    // Limpar quaisquer arquivos temporários criados pelo formidable
    fs.unlinkSync(arquivoForm.filepath);
  }
}
