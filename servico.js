// Regras do negócio: alunos, mensalidades, baixas, cobranças pelo WhatsApp e Pix da escola.
const datas = require("./datas");
const { transacao } = require("./db");
const { gerarPixCopiaECola, normalizarChave, TIPOS_CHAVE } = require("./pix");

const FORMAS_PREFERIDAS = ["pix", "maquininha", "dinheiro"];
const FORMAS_PAGAMENTO = ["Pix", "Dinheiro", "Débito", "Crédito"];

class ErroValidacao extends Error {
  constructor(mensagem, campos = {}) {
    super(mensagem);
    this.campos = campos;
    this.status = 400;
  }
}

const soDigitos = (s) => String(s || "").replace(/\D/g, "");

function cpfValido(cpf) {
  const c = soDigitos(cpf);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(c[i]) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}

function statusExibicao(c, hoje = datas.hoje()) {
  if (c.status !== "pendente") return c.status;
  return c.vencimento < hoje ? "atrasado" : "pendente";
}

function criarServico({ db, config }) {
  const q = (sql) => db.prepare(sql);

  // ---------- configurações da escola ----------
  function configuracoes() {
    const linhas = Object.fromEntries(q("SELECT chave, valor FROM configuracoes").all().map((r) => [r.chave, r.valor]));
    const c = {
      escola_nome: linhas.escola_nome || config.nomeEscola,
      pix_tipo: linhas.pix_tipo || "",
      pix_chave: linhas.pix_chave || "",
      pix_nome: linhas.pix_nome || "",
      pix_cidade: linhas.pix_cidade || "",
      msg_extra: linhas.msg_extra ?? "Depois de pagar, mande o comprovante por aqui. Obrigado!",
    };
    c.pix_pronto = !!(c.pix_chave && c.pix_nome && c.pix_cidade);
    return c;
  }

  function salvarConfiguracoes(d) {
    const campos = {};
    const escola = String(d.escola_nome || "").trim();
    if (!escola) campos.escola_nome = "Informe o nome da escola.";
    let chave = "";
    const tipo = String(d.pix_tipo || "");
    if (String(d.pix_chave || "").trim()) {
      if (!TIPOS_CHAVE.includes(tipo)) campos.pix_tipo = "Escolha o tipo da chave Pix.";
      else {
        chave = normalizarChave(tipo, d.pix_chave);
        if (!chave) campos.pix_chave = "Chave Pix inválida para o tipo escolhido.";
        if (tipo === "cpf" && chave && !cpfValido(chave)) campos.pix_chave = "CPF da chave Pix inválido.";
      }
      if (!String(d.pix_nome || "").trim()) campos.pix_nome = "Informe o nome do titular da conta.";
      if (!String(d.pix_cidade || "").trim()) campos.pix_cidade = "Informe a cidade do titular da conta.";
    }
    if (Object.keys(campos).length) throw new ErroValidacao(Object.values(campos).join(" "), campos);
    const ins = q("INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor");
    transacao(db, () => {
      ins.run("escola_nome", escola);
      ins.run("pix_tipo", chave ? tipo : "");
      ins.run("pix_chave", chave);
      ins.run("pix_nome", chave ? String(d.pix_nome).trim().slice(0, 25) : "");
      ins.run("pix_cidade", chave ? String(d.pix_cidade).trim().slice(0, 15) : "");
      ins.run("msg_extra", String(d.msg_extra || "").trim().slice(0, 300));
    });
    return configuracoes();
  }

  // Pix copia e cola para um valor (null se a chave ainda não foi cadastrada).
  function pix(valorCentavos, identificador) {
    const c = configuracoes();
    if (!c.pix_pronto) return null;
    return gerarPixCopiaECola({ chave: c.pix_chave, nome: c.pix_nome, cidade: c.pix_cidade, valorCentavos, identificador });
  }

  // ---------- turmas ----------
  function listarTurmas() {
    return q("SELECT * FROM turmas ORDER BY ativa DESC, idade_max, nome").all();
  }

  function salvarTurma(id, dados) {
    const nome = String(dados.nome || "").trim();
    const valor = Math.round(Number(dados.valor) * 100);
    if (!nome) throw new ErroValidacao("Informe o nome da turma.", { nome: true });
    if (!(valor > 0)) throw new ErroValidacao("Informe um valor de mensalidade maior que zero.", { valor: true });
    const idade = dados.idade_max === "" || dados.idade_max == null ? null : Number(dados.idade_max);
    const ativa = dados.ativa === false ? 0 : 1;
    if (id) {
      q("UPDATE turmas SET nome=?, dias=?, idade_max=?, valor_centavos=?, ativa=? WHERE id=?")
        .run(nome, String(dados.dias || ""), idade, valor, ativa, id);
      return Number(id);
    }
    return Number(q("INSERT INTO turmas (nome, dias, idade_max, valor_centavos, ativa) VALUES (?,?,?,?,?)")
      .run(nome, String(dados.dias || ""), idade, valor, ativa).lastInsertRowid);
  }

  // ---------- responsáveis e alunos ----------
  function buscarResponsavelPorCpf(cpf) {
    const r = q("SELECT * FROM responsaveis WHERE cpf = ?").get(soDigitos(cpf));
    if (!r) return null;
    const filhos = q("SELECT id, nome FROM alunos WHERE responsavel_id = ? AND ativo = 1").all(r.id);
    return { ...r, filhos };
  }

  function validarAluno(d) {
    const campos = {};
    const nome = String(d.nome || "").trim().replace(/\s+/g, " ");
    if (nome.split(" ").length < 2) campos.nome = "Informe nome e sobrenome do aluno.";
    if (d.nascimento && !/^\d{4}-\d{2}-\d{2}$/.test(d.nascimento)) campos.nascimento = "Data de nascimento inválida.";
    const turma = q("SELECT * FROM turmas WHERE id = ?").get(Number(d.turma_id));
    if (!turma) campos.turma_id = "Escolha uma turma.";
    const resp = d.responsavel || {};
    const respNome = String(resp.nome || "").trim();
    if (respNome.length < 3) campos.resp_nome = "Informe o nome do responsável.";
    const cpf = soDigitos(resp.cpf);
    if (!cpfValido(cpf)) campos.resp_cpf = "CPF inválido.";
    const whatsapp = soDigitos(resp.whatsapp);
    if (whatsapp.length < 10 || whatsapp.length > 11) campos.resp_whatsapp = "WhatsApp precisa ter DDD + número.";
    const email = String(resp.email || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) campos.resp_email = "E-mail inválido.";
    const valor = Math.round(Number(d.valor) * 100);
    if (!(valor > 0)) campos.valor = "Informe o valor da mensalidade.";
    const dia = Number(d.dia_vencimento);
    if (!(dia >= 1 && dia <= 28)) campos.dia_vencimento = "Escolha um dia de vencimento entre 1 e 28.";
    if (!FORMAS_PREFERIDAS.includes(d.forma_preferida)) campos.forma_preferida = "Escolha como vai pagar.";
    if (Object.keys(campos).length) throw new ErroValidacao(Object.values(campos).join(" "), campos);
    return {
      nome, nascimento: d.nascimento || null, turma_id: turma.id, valor, dia,
      forma: d.forma_preferida, desconto: d.desconto_irmao ? 1 : 0,
      observacoes: String(d.observacoes || "").trim() || null,
      resp: { nome: respNome, cpf, whatsapp, email: email || null },
    };
  }

  function salvarResponsavel(r) {
    const existente = q("SELECT id FROM responsaveis WHERE cpf = ?").get(r.cpf);
    if (existente) {
      q("UPDATE responsaveis SET nome=?, whatsapp=?, email=? WHERE id=?").run(r.nome, r.whatsapp, r.email, existente.id);
      return existente.id;
    }
    return Number(q("INSERT INTO responsaveis (nome, cpf, whatsapp, email) VALUES (?,?,?,?)").run(r.nome, r.cpf, r.whatsapp, r.email).lastInsertRowid);
  }

  function criarAluno(dados) {
    const v = validarAluno(dados);
    const inicio = datas.primeiraCompetencia(v.dia);
    const alunoId = transacao(db, () => {
      const respId = salvarResponsavel(v.resp);
      return Number(q(`INSERT INTO alunos (nome, nascimento, turma_id, responsavel_id, valor_centavos, dia_vencimento,
        forma_preferida, desconto_irmao, inicio_competencia, observacoes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(v.nome, v.nascimento, v.turma_id, respId, v.valor, v.dia, v.forma, v.desconto, inicio, v.observacoes).lastInsertRowid);
    });
    for (const comp of competenciasAbertas()) if (comp >= inicio) gerarCobranca(alunoId, comp);
    return alunoId;
  }

  function editarAluno(id, dados) {
    if (!q("SELECT id FROM alunos WHERE id = ?").get(id)) throw new ErroValidacao("Aluno não encontrado.");
    const v = validarAluno(dados);
    transacao(db, () => {
      const respId = salvarResponsavel(v.resp);
      q(`UPDATE alunos SET nome=?, nascimento=?, turma_id=?, responsavel_id=?, valor_centavos=?, dia_vencimento=?,
         forma_preferida=?, desconto_irmao=?, observacoes=? WHERE id=?`)
        .run(v.nome, v.nascimento, v.turma_id, respId, v.valor, v.dia, v.forma, v.desconto, v.observacoes, id);
    });
    return id; // valor e vencimento novos valem a partir das próximas mensalidades
  }

  function definirAtivo(id, ativo) {
    q("UPDATE alunos SET ativo = ? WHERE id = ?").run(ativo ? 1 : 0, id);
    if (ativo) for (const comp of competenciasAbertas()) gerarCobranca(id, comp);
  }

  function detalheAluno(id) {
    const a = q(`SELECT a.*, t.nome AS turma_nome, t.dias AS turma_dias,
        r.nome AS resp_nome, r.cpf AS resp_cpf, r.whatsapp AS resp_whatsapp, r.email AS resp_email
      FROM alunos a JOIN turmas t ON t.id = a.turma_id JOIN responsaveis r ON r.id = a.responsavel_id WHERE a.id = ?`).get(id);
    if (!a) return null;
    const hoje = datas.hoje();
    const cobrancas = q("SELECT * FROM cobrancas WHERE aluno_id = ? ORDER BY competencia DESC").all(id)
      .map((c) => ({ ...c, situacao: statusExibicao(c, hoje), pix: c.status === "pendente" ? pix(c.valor_centavos, `MENS${c.id}`) : null }));
    const irmaos = q("SELECT id, nome FROM alunos WHERE responsavel_id = ? AND id <> ? AND ativo = 1").all(a.responsavel_id, id);
    return { ...a, cobrancas, irmaos };
  }

  function listarAlunos({ incluirInativos = false } = {}) {
    return q(`SELECT a.id, a.nome, a.ativo, a.valor_centavos, a.dia_vencimento, a.forma_preferida, t.nome AS turma_nome, r.nome AS resp_nome
      FROM alunos a JOIN turmas t ON t.id = a.turma_id JOIN responsaveis r ON r.id = a.responsavel_id
      ${incluirInativos ? "" : "WHERE a.ativo = 1"} ORDER BY a.nome COLLATE NOCASE`).all();
  }

  function alunosAguardandoPrimeiraMensalidade() {
    return q(`SELECT a.id, a.nome, a.inicio_competencia FROM alunos a
      WHERE a.ativo = 1 AND NOT EXISTS (SELECT 1 FROM cobrancas c WHERE c.aluno_id = a.id) ORDER BY a.nome`).all();
  }

  // ---------- mensalidades ----------
  function competenciasAbertas(dataHoje = datas.hoje()) {
    const atual = datas.competenciaDe(dataHoje);
    return Number(dataHoje.slice(8, 10)) >= config.diaGerarProximoMes ? [atual, datas.somarMeses(atual, 1)] : [atual];
  }

  function gerarCobranca(alunoId, competencia) {
    const a = q("SELECT * FROM alunos WHERE id = ?").get(alunoId);
    if (!a || !a.ativo || competencia < a.inicio_competencia) return null;
    const r = q("INSERT OR IGNORE INTO cobrancas (aluno_id, competencia, valor_centavos, vencimento) VALUES (?,?,?,?)")
      .run(alunoId, competencia, a.valor_centavos, datas.vencimento(competencia, a.dia_vencimento));
    return r.changes ? Number(r.lastInsertRowid) : null;
  }

  function gerarCobrancasDoMes(competencia) {
    let geradas = 0;
    for (const { id } of q("SELECT id FROM alunos WHERE ativo = 1 AND inicio_competencia <= ?").all(competencia))
      if (gerarCobranca(id, competencia)) geradas++;
    return geradas;
  }

  function obterCobranca(id) {
    const c = q("SELECT * FROM cobrancas WHERE id = ?").get(id);
    if (!c) throw new ErroValidacao("Mensalidade não encontrada.");
    return c;
  }

  function registrarPagamento(id, { forma, data }) {
    const c = obterCobranca(id);
    if (!FORMAS_PAGAMENTO.includes(forma)) throw new ErroValidacao("Forma de pagamento inválida.");
    if (c.status === "pago") throw new ErroValidacao("Esta mensalidade já está paga.");
    if (c.status === "isento") throw new ErroValidacao("Esta mensalidade está isenta.");
    const dataPg = /^\d{4}-\d{2}-\d{2}$/.test(data || "") ? data : datas.hoje();
    if (dataPg > datas.hoje()) throw new ErroValidacao("A data do pagamento não pode ser no futuro.");
    q("UPDATE cobrancas SET status='pago', forma_pagamento=?, pago_em=?, atualizado_em=datetime('now') WHERE id=?").run(forma, dataPg, id);
  }

  function desfazerPagamento(id) {
    const c = obterCobranca(id);
    if (c.status !== "pago") throw new ErroValidacao("Esta mensalidade não está paga.");
    q("UPDATE cobrancas SET status='pendente', forma_pagamento=NULL, pago_em=NULL, atualizado_em=datetime('now') WHERE id=?").run(id);
  }

  function isentar(id, isento) {
    const c = obterCobranca(id);
    if (isento && c.status !== "pendente") throw new ErroValidacao("Só dá para isentar uma mensalidade em aberto.");
    if (!isento && c.status !== "isento") throw new ErroValidacao("Esta mensalidade não está isenta.");
    q("UPDATE cobrancas SET status=?, atualizado_em=datetime('now') WHERE id=?").run(isento ? "isento" : "pendente", id);
  }

  // ---------- cobrança pelo WhatsApp ----------
  // Agrupa por responsável tudo o que está em aberto (irmãos e meses atrasados numa mensagem só).
  function filaDeCobranca() {
    const hoje = datas.hoje();
    const linhas = q(`SELECT c.id, c.competencia, c.valor_centavos, c.vencimento, c.status, c.ultimo_aviso, c.avisos,
        a.id AS aluno_id, a.nome AS aluno_nome, t.nome AS turma_nome,
        r.id AS resp_id, r.nome AS resp_nome, r.whatsapp AS resp_whatsapp
      FROM cobrancas c JOIN alunos a ON a.id = c.aluno_id JOIN turmas t ON t.id = a.turma_id JOIN responsaveis r ON r.id = a.responsavel_id
      WHERE c.status = 'pendente' ORDER BY r.nome COLLATE NOCASE, c.competencia, a.nome`).all();
    const grupos = new Map();
    for (const l of linhas) {
      if (!grupos.has(l.resp_id)) grupos.set(l.resp_id, { resp_id: l.resp_id, resp_nome: l.resp_nome, resp_whatsapp: l.resp_whatsapp, itens: [] });
      grupos.get(l.resp_id).itens.push({ ...l, situacao: statusExibicao(l, hoje) });
    }
    return [...grupos.values()].map((g) => {
      const total = g.itens.reduce((s, i) => s + i.valor_centavos, 0);
      const avisos = g.itens.map((i) => i.ultimo_aviso).filter(Boolean).sort();
      return {
        ...g, total,
        atrasado: g.itens.some((i) => i.situacao === "atrasado"),
        vence_primeiro: g.itens.map((i) => i.vencimento).sort()[0],
        ultimo_aviso: avisos[avisos.length - 1] || null,
        pix: pix(total, `MENS${g.itens.map((i) => i.id).join("x")}`.slice(0, 25)),
      };
    });
  }

  function marcarAvisado(ids) {
    const lista = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => n > 0);
    if (!lista.length) throw new ErroValidacao("Nenhuma mensalidade informada.");
    const up = q("UPDATE cobrancas SET ultimo_aviso = ?, avisos = avisos + 1 WHERE id = ? AND status = 'pendente'");
    const hoje = datas.hoje();
    transacao(db, () => lista.forEach((id) => up.run(hoje, id)));
    return { ultimo_aviso: hoje };
  }

  // ---------- painel ----------
  function painel(competencia) {
    const hoje = datas.hoje();
    const linhas = q(`SELECT c.*, a.nome AS aluno_nome, t.nome AS turma_nome, t.id AS turma_id, r.nome AS resp_nome
      FROM cobrancas c JOIN alunos a ON a.id = c.aluno_id JOIN turmas t ON t.id = a.turma_id JOIN responsaveis r ON r.id = a.responsavel_id
      WHERE c.competencia = ? ORDER BY a.nome COLLATE NOCASE`).all(competencia)
      .map((c) => ({ ...c, situacao: statusExibicao(c, hoje) }));
    const resumo = { pago: [0, 0], pendente: [0, 0], atrasado: [0, 0], isento: [0, 0] };
    for (const l of linhas) { resumo[l.situacao][0]++; resumo[l.situacao][1] += l.valor_centavos; }
    const ativosSemCobranca = q(`SELECT COUNT(*) AS n FROM alunos a WHERE a.ativo = 1 AND a.inicio_competencia <= ?
      AND NOT EXISTS (SELECT 1 FROM cobrancas c WHERE c.aluno_id = a.id AND c.competencia = ?)`).get(competencia, competencia).n;
    const comps = new Set(q("SELECT DISTINCT competencia FROM cobrancas").all().map((r) => r.competencia));
    competenciasAbertas().forEach((c) => comps.add(c));
    const emAberto = q("SELECT COUNT(DISTINCT a.responsavel_id) AS n FROM cobrancas c JOIN alunos a ON a.id = c.aluno_id WHERE c.status = 'pendente' AND c.vencimento < ?").get(hoje).n;
    return {
      competencia, hoje, linhas, resumo, ativosSemCobranca, familiasAtrasadas: emAberto,
      competencias: [...comps].sort().reverse(),
      totalAlunos: q("SELECT COUNT(*) AS n FROM alunos WHERE ativo = 1").get().n,
    };
  }

  function dadosRecibo(id) {
    return q(`SELECT c.*, a.nome AS aluno_nome, t.nome AS turma_nome, r.nome AS resp_nome, r.cpf AS resp_cpf
      FROM cobrancas c JOIN alunos a ON a.id = c.aluno_id JOIN turmas t ON t.id = a.turma_id JOIN responsaveis r ON r.id = a.responsavel_id
      WHERE c.id = ?`).get(id);
  }

  // Roda de hora em hora: cria as mensalidades do mês (e do próximo, a partir do dia configurado).
  function rotina() {
    let geradas = 0;
    for (const comp of competenciasAbertas()) geradas += gerarCobrancasDoMes(comp);
    return { geradas };
  }

  return {
    configuracoes, salvarConfiguracoes, pix, listarTurmas, salvarTurma, buscarResponsavelPorCpf, criarAluno, editarAluno,
    definirAtivo, detalheAluno, listarAlunos, alunosAguardandoPrimeiraMensalidade, competenciasAbertas, gerarCobranca,
    gerarCobrancasDoMes, registrarPagamento, desfazerPagamento, isentar, filaDeCobranca, marcarAvisado, painel, dadosRecibo, rotina,
  };
}

module.exports = { criarServico, ErroValidacao, cpfValido, soDigitos, statusExibicao };
