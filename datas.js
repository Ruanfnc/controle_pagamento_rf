// Datas sempre no fuso de São Paulo, no formato "AAAA-MM-DD".
// "Competência" é o mês de referência da mensalidade, no formato "AAAA-MM".

let hojeFixo = process.env.HOJE_FIXO || null; // usado em testes e demonstrações

function hoje() {
  if (hojeFixo) return hojeFixo;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function fixarHoje(data) {
  hojeFixo = data;
}

const competenciaDe = (data) => data.slice(0, 7);

function somarMeses(competencia, n) {
  const [a, m] = competencia.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function diasNoMes(competencia) {
  const [a, m] = competencia.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

// Vencimento da mensalidade de uma competência. Dia 31 em fevereiro vira dia 28/29.
function vencimento(competencia, dia) {
  return `${competencia}-${String(Math.min(dia, diasNoMes(competencia))).padStart(2, "0")}`;
}

// Primeiro mês cobrado de um aluno novo: se o vencimento deste mês já passou,
// a primeira cobrança fica para o mês seguinte.
function primeiraCompetencia(diaVencimento, dataHoje = hoje()) {
  const atual = competenciaDe(dataHoje);
  return vencimento(atual, diaVencimento) >= dataHoje ? atual : somarMeses(atual, 1);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function nomeCompetencia(competencia) {
  const [a, m] = competencia.split("-").map(Number);
  return `${MESES[m - 1]}/${a}`;
}

const dataBR = (data) => (data ? data.split("-").reverse().join("/") : "");

module.exports = { hoje, fixarHoje, competenciaDe, somarMeses, vencimento, primeiraCompetencia, nomeCompetencia, dataBR };
