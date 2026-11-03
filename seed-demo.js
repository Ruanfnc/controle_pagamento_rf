// Preenche um banco vazio com alunos fictícios para demonstração.
// Uso: npm run seed:demo
const path = require("node:path");
const { config } = require("./config");
const { abrirBanco } = require("./db");
const { criarServico } = require("./servico");
const datas = require("./datas");

const db = abrirBanco(path.join(config.pastaDados, "escolinha.db"));
if (db.prepare("SELECT COUNT(*) AS n FROM alunos").get().n > 0) {
  console.error("Recusado: o banco já tem alunos. Os dados fictícios só podem ser criados num banco vazio.");
  process.exit(1);
}

let s = 11;
const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const nomes = ["Arthur", "Miguel", "Heitor", "Theo", "Davi", "Gabriel", "Bernardo", "Samuel", "Pedro", "Lucas", "Enzo", "Rafael", "Gael", "Matheus", "Lorenzo", "João", "Isaac", "Nicolas", "Caio", "Vicente", "Lívia", "Helena", "Alice", "Laura", "Valentina", "Sofia", "Júlia", "Cecília"];
const sobrenomes = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes", "Costa", "Ribeiro", "Martins", "Carvalho", "Rocha", "Almeida", "Araújo", "Barbosa"];
const pais = ["Ana", "Carla", "Fernanda", "Patrícia", "Juliana", "Renata", "Marcos", "Paulo", "Ricardo", "Rodrigo", "Fábio", "Cláudia", "André", "Daniela"];

function cpfAleatorio() {
  const d = Array.from({ length: 9 }, () => Math.floor(rnd() * 10));
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += d[i] * (t + 1 - i);
    d.push(((soma * 10) % 11) % 10);
  }
  return d.join("");
}

const hoje = datas.hoje();
const atual = datas.competenciaDe(hoje);
const anterior = datas.somarMeses(atual, -1);
datas.fixarHoje(`${anterior}-01`); // cadastra no começo do mês anterior, para ter histórico
const servico = criarServico({ db, config });
servico.salvarConfiguracoes({
  escola_nome: config.nomeEscola, pix_tipo: "email", pix_chave: "financeiro@escolinha-exemplo.com.br",
  pix_nome: "Escolinha Exemplo", pix_cidade: "Sao Paulo", msg_extra: "Depois de pagar, mande o comprovante por aqui. Obrigado!",
});
const turmas = servico.listarTurmas();
let anteriorResp = null;
for (let i = 0; i < 40; i++) {
  const t = turmas[i % turmas.length];
  const irmao = anteriorResp && rnd() < 0.12;
  const sob = irmao ? anteriorResp.sobrenome : pick(sobrenomes);
  const resp = irmao ? anteriorResp : { nome: `${pick(pais)} ${sob}`, cpf: cpfAleatorio(), whatsapp: "119" + String(Math.floor(rnd() * 1e8)).padStart(8, "0"), sobrenome: sob };
  servico.criarAluno({
    nome: `${pick(nomes)} ${sob}`, nascimento: `${2026 - (t.idade_max - 1)}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}`, turma_id: t.id,
    responsavel: resp, valor: (t.valor_centavos - (irmao ? config.descontoIrmao * 100 : 0)) / 100,
    dia_vencimento: pick([1, 1, 5, 10, 10]), forma_preferida: rnd() < 0.7 ? "pix" : rnd() < 0.6 ? "maquininha" : "dinheiro", desconto_irmao: irmao,
  });
  anteriorResp = resp;
}
const pagar = db.prepare("UPDATE cobrancas SET status='pago', forma_pagamento=?, pago_em=? WHERE id=?");
for (const c of db.prepare("SELECT * FROM cobrancas WHERE competencia = ?").all(anterior))
  if (rnd() < 0.9) pagar.run(pick(["Pix", "Pix", "Pix", "Dinheiro", "Débito"]), c.vencimento, c.id);
datas.fixarHoje(hoje);
servico.gerarCobrancasDoMes(atual);
for (const c of db.prepare("SELECT * FROM cobrancas WHERE competencia = ?").all(atual))
  if (c.vencimento < hoje ? rnd() < 0.6 : rnd() < 0.2) pagar.run(pick(["Pix", "Pix", "Dinheiro"]), c.vencimento < hoje ? c.vencimento : hoje, c.id);
console.log("Pronto: 40 alunos fictícios criados.");
