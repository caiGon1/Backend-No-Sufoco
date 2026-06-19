import crypto from "crypto";

const SECRET_KEY = process.env.ENCRYPTION_KEY; 
const ALGORITHM = "aes-256-gcm";

export function criptografar(texto) {
  if (!texto) return texto;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(SECRET_KEY, "utf-8"), iv);

  let encrypted = cipher.update(texto, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function descriptografar(textoCriptografado) {
  if (!textoCriptografado) return textoCriptografado;

  try {
    const [ivHex, authTagHex, encryptedText] = textoCriptografado.split(":");
    
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(SECRET_KEY, "utf-8"), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf-8");
    decrypted += decipher.final("utf-8");

    return decrypted;
  } catch (error) {
    console.error("Erro ao descriptografar dado. Chave incorreta ou dado corrompido.");
    return null; 
  }
}