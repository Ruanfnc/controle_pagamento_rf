// Banco de dados SQLite (arquivo único em DATA_DIR/escolinha.db).
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function abrirBanco(arquivo) {
  if (arquivo !== ":memory:") fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrar(db);
  return db;
}

function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS turmas (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      dias TEXT NOT NULL DEFAULT '',
      idade_max INTEGER,                 -- idade máxima no ano (Sub-9 = 8); usada para sugerir a turma
      valor_centavos INTEGER NOT NULL,
      ativa INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS responsaveis (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      cpf TEXT NOT NULL UNIQUE,          -- só dígitos
      whatsapp TEXT NOT NULL,            -- só dígitos, com DDD
      email TEXT
    );

    CREATE TABLE IF NOT EXISTS alunos (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      nascimento TEXT,
      turma_id INTEGER NOT NULL REFERENCES turmas(id),
      responsavel_id INTEGER NOT NULL REFERENCES responsaveis(id),
      valor_centavos INTEGER NOT NULL,
      dia_vencimento INTEGER NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 28),
      forma_preferida TEXT NOT NULL,     -- 'pix', 'maquininha' ou 'dinheiro'
      desconto_irmao INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      inicio_competencia TEXT NOT NULL,  -- primeiro mês cobrado (AAAA-MM)
      observacoes TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cobrancas (
      id INTEGER PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES alunos(id),
      competencia TEXT NOT NULL,
      valor_centavos INTEGER NOT NULL,
      vencimento TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','isento')),
      forma_pagamento TEXT,              -- Pix, Dinheiro, Débito, Crédito
      pago_em TEXT,
      ultimo_aviso TEXT,                 -- data da última cobrança enviada pelo WhatsApp
      avisos INTEGER NOT NULL DEFAULT 0, -- quantas cobranças já foram enviadas
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (aluno_id, competencia)
    );

    CREATE TABLE IF NOT EXISTS configuracoes (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cobrancas_comp ON cobrancas (competencia);
  `);

  const qtdTurmas = db.prepare("SELECT COUNT(*) AS n FROM turmas").get().n;
  if (qtdTurmas === 0) {
    const ins = db.prepare("INSERT INTO turmas (nome, dias, idade_max, valor_centavos) VALUES (?, ?, ?, ?)");
    [
      ["Sub-7", "Ter/Qui 16h", 6, 13000],
      ["Sub-9", "Ter/Qui 17h", 8, 15000],
      ["Sub-11", "Seg/Qua 17h", 10, 15000],
      ["Sub-13", "Seg/Qua 18h30", 12, 17000],
      ["Sub-15", "Sex 18h + Sáb 9h", 14, 17000],
    ].forEach((t) => ins.run(...t));
  }
}

// Executa uma função dentro de uma transação.
function transacao(db, fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

module.exports = { abrirBanco, transacao };
