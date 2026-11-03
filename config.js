// Configuração lida das variáveis de ambiente (veja .env.example).
const fs = require("node:fs");
const path = require("node:path");

// Carrega um arquivo .env simples, se existir (sem dependências externas).
const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) {
  for (const linha of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const env = process.env;

const config = {
  porta: Number(env.PORT || 3000),
  pastaDados: env.DATA_DIR || path.join(__dirname, "..", "data"),
  nomeEscola: env.ESCOLA_NOME || "Escolinha de Futebol",
  senhaAdmin: env.ADMIN_PASSWORD || "",
  segredoSessao: env.SESSION_SECRET || "",
  // A partir deste dia do mês, as mensalidades do mês seguinte já aparecem no painel.
  diaGerarProximoMes: Number(env.DIA_GERAR_PROXIMO_MES || 25),
  // Desconto padrão para irmãos, em reais.
  descontoIrmao: Number(env.DESCONTO_IRMAO || 20),
};

function validar() {
  const erros = [];
  if (config.senhaAdmin.length < 8) erros.push("ADMIN_PASSWORD precisa ter pelo menos 8 caracteres.");
  if (config.segredoSessao.length < 32) erros.push("SESSION_SECRET precisa ter pelo menos 32 caracteres.");
  return erros;
}

module.exports = { config, validar };
