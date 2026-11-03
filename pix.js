// Gera o "Pix copia e cola" (BR Code estático) com valor, seguindo o padrão do Banco Central.
// Não depende de banco nem de intermediário: o dinheiro cai direto na chave Pix da escola.

const TIPOS_CHAVE = ["cpf", "cnpj", "celular", "email", "aleatoria"];

function campo(id, valor) {
  return id + String(valor.length).padStart(2, "0") + valor;
}

function crc16(txt) {
  let crc = 0xffff;
  for (const ch of Buffer.from(txt, "utf8")) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Nome e cidade: sem acentos, maiúsculas, só caracteres simples.
const limpar = (s, max) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, max);

// Deixa a chave no formato que o Pix espera para cada tipo.
function normalizarChave(tipo, chave) {
  const c = String(chave || "").trim();
  const dig = c.replace(/\D/g, "");
  switch (tipo) {
    case "cpf": return dig.length === 11 ? dig : null;
    case "cnpj": return dig.length === 14 ? dig : null;
    case "celular": {
      const n = dig.startsWith("55") && dig.length >= 12 ? dig.slice(2) : dig;
      return n.length === 10 || n.length === 11 ? "+55" + n : null;
    }
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c.toLowerCase() : null;
    case "aleatoria": return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c) ? c.toLowerCase() : null;
    default: return null;
  }
}

/**
 * @param {object} p
 * @param {string} p.chave      chave já normalizada
 * @param {string} p.nome       nome de quem recebe (até 25 caracteres)
 * @param {string} p.cidade     cidade de quem recebe (até 15 caracteres)
 * @param {number} [p.valorCentavos]
 * @param {string} [p.identificador]  até 25 letras/números (aparece no extrato de alguns bancos)
 */
function gerarPixCopiaECola({ chave, nome, cidade, valorCentavos, identificador }) {
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", chave);
  const txid = String(identificador || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  let s = campo("00", "01") + campo("26", conta) + campo("52", "0000") + campo("53", "986");
  if (valorCentavos) s += campo("54", (valorCentavos / 100).toFixed(2));
  s += campo("58", "BR") + campo("59", limpar(nome, 25) || "RECEBEDOR") + campo("60", limpar(cidade, 15) || "BRASIL");
  s += campo("62", campo("05", txid));
  s += "6304";
  return s + crc16(s);
}

module.exports = { gerarPixCopiaECola, normalizarChave, crc16, TIPOS_CHAVE };
