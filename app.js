// Rotas HTTP: API do painel, recibo, exportação e backup.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const datas = require("./datas");
const { criarServico, ErroValidacao } = require("./servico");
const { criarAuth } = require("./auth");

const PASTA_PUBLICA = path.join(__dirname, "..", "public");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
const SEGURANCA = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self'",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reais = (centavos) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function criarApp({ config, db, log = console }) {
  const servico = criarServico({ db, config });
  const auth = criarAuth({ senha: config.senhaAdmin, segredo: config.segredoSessao });
  const rotas = [];
  const rota = (metodo, padrao, opcoes, fn) => {
    if (typeof opcoes === "function") { fn = opcoes; opcoes = {}; }
    const nomes = [];
    const re = new RegExp("^" + padrao.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return "([^/]+)"; }) + "$");
    rotas.push({ metodo, re, nomes, fn, publica: !!opcoes.publica });
  };

  function enviar(res, status, corpo, tipo = "application/json; charset=utf-8", extras = {}) {
    const dados = typeof corpo === "string" || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo);
    res.writeHead(status, { "Content-Type": tipo, "Cache-Control": "no-store", ...SEGURANCA, ...extras });
    res.end(dados);
  }
  const json = (res, corpo, status = 200) => enviar(res, status, corpo);
  const html = (res, corpo, status = 200) => enviar(res, status, corpo, "text/html; charset=utf-8");

  function lerCorpo(req, limite = 256 * 1024) {
    return new Promise((ok, falha) => {
      let tam = 0;
      const partes = [];
      req.on("data", (p) => {
        tam += p.length;
        if (tam > limite) { falha(new ErroValidacao("Requisição grande demais.")); req.destroy(); return; }
        partes.push(p);
      });
      req.on("end", () => {
        const txt = Buffer.concat(partes).toString("utf8");
        if (!txt) return ok({});
        try { ok(JSON.parse(txt)); } catch { falha(new ErroValidacao("JSON inválido.")); }
      });
      req.on("error", falha);
    });
  }

  const ipDe = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
  const https = (req) => req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted;
  const competenciaValida = (c) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(c || "") ? c : datas.competenciaDe(datas.hoje()));

  // ---------- sessão ----------
  rota("GET", "/api/estado", { publica: true }, (req, res) => {
    const logado = auth.valido(auth.lerCookie(req));
    const cfg = servico.configuracoes();
    json(res, { logado, escola: cfg.escola_nome, hoje: datas.hoje(), descontoIrmao: config.descontoIrmao, ...(logado ? { config: cfg } : {}) });
  });
  rota("POST", "/api/login", { publica: true }, (req, res, { corpo }) => {
    const r = auth.login(ipDe(req), corpo.senha);
    if (!r.ok) return json(res, { erro: r.erro }, 401);
    enviar(res, 200, { ok: true }, undefined, { "Set-Cookie": auth.cookie(r.token, https(req)) });
  });
  rota("POST", "/api/logout", { publica: true }, (req, res) => {
    enviar(res, 200, { ok: true }, undefined, { "Set-Cookie": auth.cookie("", https(req)) });
  });

  // ---------- configurações ----------
  rota("PUT", "/api/configuracoes", (req, res, { corpo }) => json(res, servico.salvarConfiguracoes(corpo)));
  rota("POST", "/api/configuracoes/teste-pix", (req, res, { corpo }) => {
    const p = servico.pix(Math.round(Number(corpo.valor || 1) * 100), "TESTE");
    p ? json(res, { pix: p }) : json(res, { erro: "Cadastre e salve a chave Pix primeiro." }, 400);
  });

  // ---------- turmas ----------
  rota("GET", "/api/turmas", (req, res) => json(res, servico.listarTurmas()));
  rota("POST", "/api/turmas", (req, res, { corpo }) => json(res, { id: servico.salvarTurma(null, corpo) }, 201));
  rota("PUT", "/api/turmas/:id", (req, res, { params, corpo }) => json(res, { id: servico.salvarTurma(Number(params.id), corpo) }));

  // ---------- painel ----------
  rota("GET", "/api/painel", (req, res, { url }) => json(res, servico.painel(competenciaValida(url.searchParams.get("competencia")))));
  rota("POST", "/api/gerar-mensalidades", (req, res, { corpo }) => {
    const comp = competenciaValida(corpo.competencia);
    if (!servico.competenciasAbertas().includes(comp)) throw new ErroValidacao(`Só dá para gerar mensalidades do mês atual (ou do próximo, a partir do dia ${config.diaGerarProximoMes}).`);
    json(res, { geradas: servico.gerarCobrancasDoMes(comp) });
  });

  // ---------- alunos ----------
  rota("GET", "/api/alunos", (req, res, { url }) => json(res, { alunos: servico.listarAlunos({ incluirInativos: url.searchParams.get("inativos") === "1" }), aguardando: servico.alunosAguardandoPrimeiraMensalidade() }));
  rota("GET", "/api/alunos/:id", (req, res, { params }) => {
    const a = servico.detalheAluno(Number(params.id));
    a ? json(res, a) : json(res, { erro: "Aluno não encontrado." }, 404);
  });
  rota("POST", "/api/alunos", (req, res, { corpo }) => json(res, { id: servico.criarAluno(corpo) }, 201));
  rota("PUT", "/api/alunos/:id", (req, res, { params, corpo }) => json(res, { id: servico.editarAluno(Number(params.id), corpo) }));
  rota("POST", "/api/alunos/:id/desativar", (req, res, { params }) => { servico.definirAtivo(Number(params.id), false); json(res, { ok: true }); });
  rota("POST", "/api/alunos/:id/reativar", (req, res, { params }) => { servico.definirAtivo(Number(params.id), true); json(res, { ok: true }); });
  rota("GET", "/api/responsaveis", (req, res, { url }) => json(res, servico.buscarResponsavelPorCpf(url.searchParams.get("cpf")) || null));

  // ---------- mensalidades e cobrança ----------
  rota("POST", "/api/cobrancas/:id/pagar", (req, res, { params, corpo }) => { servico.registrarPagamento(Number(params.id), corpo); json(res, { ok: true }); });
  rota("POST", "/api/cobrancas/:id/desfazer", (req, res, { params }) => { servico.desfazerPagamento(Number(params.id)); json(res, { ok: true }); });
  rota("POST", "/api/cobrancas/:id/isentar", (req, res, { params, corpo }) => { servico.isentar(Number(params.id), corpo.isento !== false); json(res, { ok: true }); });
  rota("GET", "/api/cobrar", (req, res) => json(res, { hoje: datas.hoje(), grupos: servico.filaDeCobranca() }));
  rota("POST", "/api/cobrancas/avisado", (req, res, { corpo }) => json(res, servico.marcarAvisado(corpo.ids)));

  // ---------- exportação e backup ----------
  rota("GET", "/api/exportar.csv", (req, res, { url }) => {
    const p = servico.painel(competenciaValida(url.searchParams.get("competencia")));
    const cel = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = [["Aluno", "Turma", "Responsável", "Mês", "Vencimento", "Valor", "Situação", "Forma", "Pago em", "Cobranças enviadas"].map(cel).join(";")];
    for (const l of p.linhas) linhas.push([l.aluno_nome, l.turma_nome, l.resp_nome, l.competencia, datas.dataBR(l.vencimento),
      (l.valor_centavos / 100).toFixed(2).replace(".", ","), l.situacao, l.forma_pagamento, datas.dataBR(l.pago_em), l.avisos].map(cel).join(";"));
    enviar(res, 200, "﻿" + linhas.join("\r\n"), "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="mensalidades-${p.competencia}.csv"` });
  });
  rota("GET", "/api/backup", (req, res) => {
    const tmp = path.join(os.tmpdir(), `backup-${crypto.randomBytes(6).toString("hex")}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const dados = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    enviar(res, 200, dados, "application/octet-stream", { "Content-Disposition": `attachment; filename="mensalidades-backup-${datas.hoje()}.db"` });
  });

  // ---------- recibo ----------
  rota("GET", "/recibo/:id", (req, res, { params }) => {
    const c = servico.dadosRecibo(Number(params.id));
    if (!c || c.status !== "pago") return html(res, "<p>Recibo disponível só para mensalidades pagas.</p>", 404);
    const escola = servico.configuracoes().escola_nome;
    const cpf = c.resp_cpf.replace(/^(\d{3})\d{6}(\d{2})$/, "$1.***.***-$2");
    html(res, `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recibo ${esc(c.aluno_nome)} ${esc(c.competencia)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#17201a}
.r{border:2px solid #17201a;border-radius:12px;padding:24px}h1{font-size:22px;margin:0 0 4px}.n{color:#5f6b62;font-size:13px}
.v{font-size:28px;font-weight:700;margin:16px 0}dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px}dt{color:#5f6b62}dd{margin:0}
.a{margin-top:40px;border-top:1px solid #17201a;padding-top:6px;text-align:center;font-size:13px}button{margin-top:16px;font:inherit;padding:8px 14px}
@media print{button{display:none}}</style>
<div class="r"><h1>Recibo de mensalidade</h1><div class="n">Nº ${String(c.id).padStart(6, "0")} · ${esc(escola)}</div>
<div class="v">${reais(c.valor_centavos)}</div>
<p>Recebemos de <b>${esc(c.resp_nome)}</b> (CPF ${cpf}) o valor acima, referente à mensalidade de <b>${datas.nomeCompetencia(c.competencia)}</b> do(a) aluno(a) <b>${esc(c.aluno_nome)}</b>.</p>
<dl><dt>Turma</dt><dd>${esc(c.turma_nome)}</dd><dt>Forma</dt><dd>${esc(c.forma_pagamento)}</dd><dt>Data</dt><dd>${datas.dataBR(c.pago_em)}</dd></dl>
<div class="a">${esc(escola)}</div></div>
<button onclick="print()">Imprimir ou salvar PDF</button></html>`);
  });

  // ---------- arquivos estáticos ----------
  function estatico(req, res, caminho) {
    const rel = caminho === "/" ? "index.html" : decodeURIComponent(caminho).replace(/^\/+/, "");
    const arq = path.resolve(PASTA_PUBLICA, rel);
    if (!arq.startsWith(PASTA_PUBLICA + path.sep) || !fs.existsSync(arq) || !fs.statSync(arq).isFile()) return false;
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream", "Cache-Control": rel === "index.html" ? "no-cache" : "public, max-age=300", ...SEGURANCA });
    fs.createReadStream(arq).pipe(res);
    return true;
  }

  return async function handler(req, res) {
    const url = new URL(req.url, "http://local");
    try {
      for (const r of rotas) {
        if (r.metodo !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.nomes.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        if (!r.publica && !auth.valido(auth.lerCookie(req))) {
          return url.pathname.startsWith("/api/") ? json(res, { erro: "Faça login de novo." }, 401) : (res.writeHead(302, { Location: "/" }), res.end());
        }
        let corpo = {};
        if (["POST", "PUT"].includes(req.method)) {
          // Exigir JSON impede que outros sites enviem formulários usando a sessão (CSRF).
          if (!(req.headers["content-type"] || "").startsWith("application/json")) return json(res, { erro: "Envie JSON." }, 415);
          corpo = await lerCorpo(req);
        }
        return await r.fn(req, res, { params, corpo, url });
      }
      if (req.method === "GET" && estatico(req, res, url.pathname)) return;
      json(res, { erro: "Não encontrado." }, 404);
    } catch (e) {
      if (e instanceof ErroValidacao) return json(res, { erro: e.message, campos: e.campos }, 400);
      if (/UNIQUE constraint failed/.test(e.message)) return json(res, { erro: "Registro duplicado." }, 409);
      log.error(e);
      if (!res.headersSent) json(res, { erro: "Erro inesperado no servidor. Tente de novo." }, 500);
    }
  };
}

module.exports = { criarApp };
