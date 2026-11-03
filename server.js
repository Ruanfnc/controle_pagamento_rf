// Ponto de entrada: sobe o servidor e a rotina que cria as mensalidades de cada mês.
const http = require("node:http");
const path = require("node:path");
const { config, validar } = require("./config");
const { abrirBanco } = require("./db");
const { criarApp } = require("./app");
const { criarServico } = require("./servico");

const erros = validar();
if (erros.length) {
  console.error("Configuração incompleta:\n- " + erros.join("\n- ") + "\nVeja o arquivo .env.example e o README.");
  process.exit(1);
}

const db = abrirBanco(path.join(config.pastaDados, "escolinha.db"));
const servico = criarServico({ db, config });
const servidor = http.createServer(criarApp({ config, db }));

function rodarRotina() {
  try {
    const { geradas } = servico.rotina();
    if (geradas) console.log(`Rotina: ${geradas} mensalidade(s) criada(s).`);
  } catch (e) { console.error("Erro na rotina:", e); }
}

servidor.listen(config.porta, () => {
  console.log(`Mensalidades rodando na porta ${config.porta}.`);
  rodarRotina();
  setInterval(rodarRotina, 60 * 60 * 1000); // a cada hora
});

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => servidor.close(() => { db.close(); process.exit(0); }));
}
