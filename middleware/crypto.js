import crypto from "crypto";

const SECRET_KEY = process.env.ENCRYPTION_KEY; 
const ALGORITHM = "aes-256-gcm";

export function criptografar(texto) {
  // Se o texto for vazio, nulo ou se já parecer criptografado (evita dupla criptografia)
  if (!texto || typeof texto !== "string") return texto;
  if (texto.includes(":")) {
    const partes = texto.split(":");
    if (partes.length === 3) return texto; // Já está no formato iv:tag:cipher
  }

  // Verifica se a chave existe
  if (!SECRET_KEY) {
    console.error("ERRO CRÍTICO: ENCRYPTION_KEY não está definida nas variáveis de ambiente!");
    return texto; // Retorna o texto original para não derrubar o servidor
  }

  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(SECRET_KEY, "utf-8"), iv);

    let encrypted = cipher.update(texto, "utf-8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");

    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error("Falha ao criptografar dado:", err);
    return texto;
  }
}

export function descriptografar(textoCriptografado) {
  if (!textoCriptografado || typeof textoCriptografado !== "string") return textoCriptografado;

  // CORREÇÃO DA CAUSA 1: Se o texto NÃO tiver os dois pontos separadores, 
  // significa que é um dado antigo do banco (não criptografado). Retorna ele puro!
  if (!textoCriptografado.includes(":")) {
    return textoCriptografado; 
  }

  const partes = textoCriptografado.split(":");
  if (partes.length !== 3) {
    return textoCriptografado; // Dados corrompidos ou fora do padrão, retorna o original
  }

  if (!SECRET_KEY) {
    console.error("ERRO CRÍTICO: ENCRYPTION_KEY está faltando no servidor.");
    return textoCriptografado;
  }

  try {
    const [ivHex, authTagHex, encryptedText] = partes;
    
    // Garante que nenhuma das strings extraídas seja inválida ou vazia
    if (!ivHex || !authTagHex || !encryptedText) {
      return textoCriptografado;
    }

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(SECRET_KEY, "utf-8"), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf-8");
    decrypted += decipher.final("utf-8");

    return decrypted;
  } catch (error) {
    console.error("Erro ao descriptografar dado (Chave incorreta ou formato inválido):", error.message);
    return textoCriptografado; // Retorna o texto original seguro como fallback em vez de quebrar a API
  }
}