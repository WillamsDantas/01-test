/**
 * Quita · Controle de acesso (versão 4 — pedidos de acesso e de desbloqueio pelo app)
 * Planilha "Acessos": E-mail | Status | Nome | Observação | Último acesso | Pedido em | Solicitação
 * Status: ativo (entra), inativo (bloqueado), pendente (pediu acesso, aguardando você)
 *
 * Como atualizar:
 * 1. Extensões → Apps Script. Apague tudo, cole este código e salve.
 * 2. Escolha a função "configurar" e clique em Executar (cria a coluna nova "Solicitação").
 * 3. Implementar → Gerir implementações → lápis ✏️ → Versão: Nova versão → Implementar.
 *    (o link /exec continua o mesmo)
 */
var ADMIN = 'willamsdanttas@gmail.com';
var ABA = 'Acessos';

/* ---------- configuração ---------- */
function configurar() {
  aba_();
  var p = PropertiesService.getScriptProperties();
  var k = p.getProperty('ADMIN_KEY');
  if (!k) { k = Utilities.getUuid().replace(/-/g, '').slice(0, 24); p.setProperty('ADMIN_KEY', k); }
  MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch('https://www.googleapis.com/discovery/v1/apis', { muteHttpExceptions: true });
  Logger.log('CHAVE DO ADMINISTRADOR (cole no app Quita Acessos): ' + k);
}

/** Gera uma chave nova (use se a chave vazar). Depois cole a nova no app. */
function trocarChave() {
  var k = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', k);
  Logger.log('NOVA CHAVE DO ADMINISTRADOR: ' + k);
}

/* ---------- entrada ---------- */
function doGet(e) {
  var q = (e && e.parameter) || {};
  try {
    if (q.k) return json_(admin_(q));
    if (q.acao === 'pedir' && q.t) return json_(pedir_(q));
    if (q.acao && q.t) return json_(adminLogin_(q));
    return json_(cliente_(q.t));
  } catch (err) {
    return json_({ ok: false, msg: String(err) });
  }
}

/* ---------- app Quita (cliente) ---------- */
function cliente_(t) {
  if (!t) return { ok: false, erro: 'login', msg: 'sem login' };
  // Confirma quem é a pessoa pelo login real do Google (não dá para inventar e-mail)
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
    headers: { Authorization: 'Bearer ' + t }, muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) return { ok: false, erro: 'login', msg: 'login inválido' };
  var u = JSON.parse(r.getContentText()).user || {};
  var email = String(u.emailAddress || '').trim().toLowerCase();
  if (!email) return { ok: false, erro: 'login', msg: 'sem e-mail' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var novo = false, res;
  try {
    var sh = aba_();
    var v = sh.getDataRange().getValues();
    var achou = false;
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][0]).trim().toLowerCase() === email) {
        var st = String(v[i][1]).trim().toLowerCase() || 'pendente';
        sh.getRange(i + 1, 5).setValue(new Date());
        if (!v[i][2] && u.displayName) sh.getRange(i + 1, 3).setValue(u.displayName);
        res = { ok: true, email: email, status: st, ativo: st === 'ativo' || email === ADMIN };
        achou = true;
        break;
      }
    }
    if (!achou) {
      // Não está na lista: entra como "pendente" para você liberar
      var stNovo = email === ADMIN ? 'ativo' : 'pendente';
      sh.appendRow([email, stNovo, u.displayName || '', '', new Date(), new Date()]);
      res = { ok: true, email: email, status: stNovo, ativo: email === ADMIN };
      novo = stNovo === 'pendente';
    }
  } finally {
    lock.releaseLock();
  }
  if (novo) avisar_(email, u.displayName || '');
  return res;
}

/* ---------- botão "Solicitar acesso / desbloqueio" no app ---------- */
function pedir_(q) {
  var u = quem_(q.t);
  if (!u) return { ok: false, erro: 'login', msg: 'login inválido' };
  var email = u.email, tipo = q.tipo === 'desbloqueio' ? 'desbloqueio' : 'acesso';
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var avisar = true;
  try {
    var sh = aba_();
    var v = sh.getDataRange().getValues(), achou = false;
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][0]).trim().toLowerCase() === email) {
        var antes = v[i][5] instanceof Date ? v[i][5].getTime() : 0;
        // pediu de novo em menos de 1 hora: não manda outro e-mail
        if (String(v[i][6]) === tipo && Date.now() - antes < 3600000) avisar = false;
        sh.getRange(i + 1, 6).setValue(new Date());
        sh.getRange(i + 1, 7).setValue(tipo);
        if (!v[i][2] && u.nome) sh.getRange(i + 1, 3).setValue(u.nome);
        achou = true;
        break;
      }
    }
    if (!achou) sh.appendRow([email, 'pendente', u.nome || '', '', new Date(), new Date(), tipo]);
  } finally {
    lock.releaseLock();
  }
  if (avisar) avisar_(email, u.nome || '', tipo);
  return { ok: true };
}
function quem_(t) {
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
    headers: { Authorization: 'Bearer ' + t }, muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) return null;
  var u = JSON.parse(r.getContentText()).user || {};
  var email = String(u.emailAddress || '').trim().toLowerCase();
  return email ? { email: email, nome: u.displayName || '' } : null;
}

/* ---------- administrador ---------- */
// pelo app Quita: só o login real do administrador (sem chave)
function adminLogin_(q) {
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {
    headers: { Authorization: 'Bearer ' + q.t }, muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) return { ok: false, erro: 'login', msg: 'login inválido' };
  var email = String((JSON.parse(r.getContentText()).user || {}).emailAddress || '').toLowerCase();
  if (email !== ADMIN) return { ok: false, erro: 'admin', msg: 'apenas o administrador' };
  return adminOps_(q);
}
// pelo app Quita Acessos (chave)
function admin_(q) {
  var k = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!k || q.k !== k) return { ok: false, erro: 'chave', msg: 'chave inválida' };
  return adminOps_(q);
}
function adminOps_(q) {
  var sh = aba_();
  if (q.acao === 'status') {
    var email = String(q.email || '').trim().toLowerCase();
    var st = String(q.status || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, msg: 'e-mail inválido' };
    if (['ativo', 'inativo', 'pendente'].indexOf(st) < 0) return { ok: false, msg: 'status inválido' };
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) {
        if (String(v[i][0]).trim().toLowerCase() === email) {
          sh.getRange(i + 1, 2).setValue(st);
          sh.getRange(i + 1, 7).setValue(''); // pedido resolvido
          if (q.nome) sh.getRange(i + 1, 3).setValue(q.nome);
          if (q.obs) sh.getRange(i + 1, 4).setValue(q.obs);
          return { ok: true, lista: lista_(sh) };
        }
      }
      sh.appendRow([email, st, q.nome || '', q.obs || '', '', new Date(), '']);
    } finally {
      lock.releaseLock();
    }
  }
  return { ok: true, lista: lista_(sh) };
}

function lista_(sh) {
  var v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) {
    var em = String(v[i][0]).trim().toLowerCase();
    if (!em) continue;
    out.push({
      email: em,
      status: String(v[i][1]).trim().toLowerCase() || 'pendente',
      nome: String(v[i][2] || ''),
      obs: String(v[i][3] || ''),
      ultimo: v[i][4] instanceof Date ? v[i][4].toISOString() : '',
      pedido: v[i][5] instanceof Date ? v[i][5].toISOString() : '',
      solicitacao: String(v[i][6] || '')
    });
  }
  return out;
}

/* ---------- e-mail na hora de cada pedido ---------- */
function avisar_(email, nome, tipo) {
  var desb = tipo === 'desbloqueio';
  try {
    var quando = Utilities.formatDate(new Date(), 'America/Sao_Paulo', "dd/MM/yyyy 'às' HH:mm");
    var html =
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:8px">' +
      '<div style="border:1px solid #e6e6e6;border-radius:14px;padding:22px">' +
      '<div style="font-size:19px;font-weight:bold;color:#111;margin-bottom:6px">' + (desb ? 'Pedido de desbloqueio no Quita' : 'Alguém quer usar o Quita') + '</div>' +
      '<div style="font-size:14px;color:#555;line-height:1.5;margin-bottom:16px">Abra o Quita em <b>Ajustes → Acessos</b> para ' + (desb ? 'desbloquear ou recusar' : 'liberar ou recusar') + '.</div>' +
      '<table style="width:100%;font-size:14px;border-collapse:collapse">' +
      linha_('E-mail', email) + linha_('Nome', nome || '—') + linha_('Quando', quando) +
      '</table>' +
      '<div style="margin-top:16px;padding:12px;border-radius:10px;background:#f5f6f7;font-size:13px;color:#555">' +
      'Você também pode ' + (desb ? 'desbloquear' : 'liberar') + ' direto na planilha: mude o status para <b>ativo</b>.</div>' +
      '</div></div>';
    MailApp.sendEmail({ to: ADMIN, subject: (desb ? 'Pedido de desbloqueio no Quita · ' : 'Novo pedido de acesso ao Quita · ') + email, htmlBody: html, name: 'Quita Acessos' });
  } catch (err) { }
}
function linha_(a, b) {
  return '<tr><td style="padding:9px 0;border-top:1px solid #f0f0f0;color:#777">' + a +
    '</td><td style="padding:9px 0;border-top:1px solid #f0f0f0;color:#111;font-weight:bold;text-align:right">' + b + '</td></tr>';
}

/* ---------- planilha ---------- */
function aba_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ABA);
  if (!sh) {
    sh = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(ABA) : ss.insertSheet(ABA);
    sh.appendRow(['E-mail', 'Status', 'Nome', 'Observação', 'Último acesso', 'Pedido em', 'Solicitação']);
    sh.appendRow([ADMIN, 'ativo', 'Willams Dantas', 'Administrador', '', '', '']);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 180); sh.setColumnWidth(4, 220); sh.setColumnWidth(5, 160);
    var regra = SpreadsheetApp.newDataValidation().requireValueInList(['ativo', 'inativo', 'pendente'], true).setAllowInvalid(false).build();
    sh.getRange('B2:B').setDataValidation(regra);
    var cf = sh.getConditionalFormatRules();
    var faixa = sh.getRange('B2:B');
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ativo').setBackground('#D7F5E3').setFontColor('#1E7A4B').setRanges([faixa]).build());
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('pendente').setBackground('#FBEFD5').setFontColor('#8A6416').setRanges([faixa]).build());
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('inativo').setBackground('#FADDDB').setFontColor('#A83A33').setRanges([faixa]).build());
    sh.setConditionalFormatRules(cf);
  }
  // colunas novas "Pedido em" (versão 2) e "Solicitação" (versão 4)
  if (String(sh.getRange(1, 6).getValue()) !== 'Pedido em') sh.getRange(1, 6).setValue('Pedido em');
  if (String(sh.getRange(1, 7).getValue()) !== 'Solicitação') sh.getRange(1, 7).setValue('Solicitação');
  sh.setColumnWidth(7, 130);
  sh.getRange('A1:G1').setFontWeight('bold').setBackground('#18181B').setFontColor('#F4F4F5');
  sh.setColumnWidth(6, 160);
  sh.getRange('E2:F').setNumberFormat('dd/MM/yyyy HH:mm');
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
