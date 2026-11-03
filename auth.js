// Login com uma senha de administrador e sessão em cookie assinado.
const crypto = require("node:crypto");

const DURACAO_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const NOME_COOKIE = "sessao";

function criarAuth({ senha, segredo }) {
  const assinar = (txt) => crypto.createHmac("sha256", segredo).update(txt).digest("base64url");
  const tentativas = new Map(); // ip -> { n, desde }

  function iguais(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  function bloqueado(ip) {
    const t = tentativas.get(ip);
    if (!t) return false;
    if (Date.now() - t.desde > 15 * 60 * 1000) { tentativas.delete(ip); return false; }
    return t.n >= 10;
  }

  function login(ip, senhaDigitada) {
    if (bloqueado(ip)) return { ok: false, erro: "Muitas tentativas. Espere 15 minutos e tente de novo." };
    if (!iguais(senhaDigitada || "", senha)) {
      const t = tentativas.get(ip) || { n: 0, desde: Date.now() };
      t.n++;
      tentativas.set(ip, t);
      return { ok: false, erro: "Senha incorreta." };
    }
    tentativas.delete(ip);
    const exp = String(Date.now() + DURACAO_MS);
    return { ok: true, token: `${exp}.${assinar(exp)}` };
  }

  function valido(token) {
    if (!token) return false;
    const [exp, assinatura] = token.split(".");
    if (!exp || !assinatura || Number(exp) < Date.now()) return false;
    return iguais(assinatura, assinar(exp));
  }

  function cookie(token, seguro) {
    const base = `${NOME_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${seguro ? "; Secure" : ""}`;
    return token ? `${base}; Max-Age=${DURACAO_MS / 1000}` : `${base}; Max-Age=0`;
  }

  function lerCookie(req) {
    const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${NOME_COOKIE}=([^;]+)`));
    return m ? m[1] : null;
  }

  return { login, valido, cookie, lerCookie };
}

module.exports = { criarAuth };
