/**
 * Quita · Controle de acesso
 * Planilha "Acessos": E-mail | Status | Nome | Observação | Último acesso
 * Status: ativo (entra), inativo (bloqueado), pendente (pediu acesso, aguardando você)
 *
 * Como instalar (uma vez só):
 * 1. Crie uma planilha em branco no Google Sheets (ex.: "Quita – Acessos").
 * 2. Menu Extensões → Apps Script. Apague o que houver, cole este código e salve.
 * 3. No topo, escolha a função "configurar" e clique em Executar. Autorize.
 * 4. Implantar → Nova implantação → tipo "App da Web".
 *    Executar como: Eu  ·  Quem pode acessar: Qualquer pessoa  → Implantar.
 * 5. Copie o link que termina em /exec e mande para o Willams/Claude.
 */
var ADMIN = 'willamsdanttas@gmail.com';
var ABA = 'Acessos';

function configurar() {
  aba_();
  UrlFetchApp.fetch('https://www.googleapis.com/discovery/v1/apis', { muteHttpExceptions: true });
}

function doGet(e) {
  try {
    var t = e && e.parameter && e.parameter.t;
    if (!t) return json_({ ok: false, erro: 'login', msg: 'sem login' });
    // Confirma quem é a pessoa pelo login real do Google (não dá para inventar e-mail)
    var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
      headers: { Authorization: 'Bearer ' + t }, muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) return json_({ ok: false, erro: 'login', msg: 'login inválido' });
    var u = JSON.parse(r.getContentText()).user || {};
    var email = String(u.emailAddress || '').trim().toLowerCase();
    if (!email) return json_({ ok: false, erro: 'login', msg: 'sem e-mail' });

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sh = aba_();
      var v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) {
        if (String(v[i][0]).trim().toLowerCase() === email) {
          var st = String(v[i][1]).trim().toLowerCase() || 'pendente';
          sh.getRange(i + 1, 5).setValue(new Date());
          if (!v[i][2] && u.displayName) sh.getRange(i + 1, 3).setValue(u.displayName);
          return json_({ ok: true, email: email, status: st, ativo: st === 'ativo' || email === ADMIN });
        }
      }
      // Não está na lista: entra como "pendente" para você liberar
      sh.appendRow([email, email === ADMIN ? 'ativo' : 'pendente', u.displayName || '', '', new Date()]);
      return json_({ ok: true, email: email, status: email === ADMIN ? 'ativo' : 'pendente', ativo: email === ADMIN });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, msg: String(err) });
  }
}

function aba_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ABA);
  if (!sh) {
    sh = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(ABA) : ss.insertSheet(ABA);
    sh.appendRow(['E-mail', 'Status', 'Nome', 'Observação', 'Último acesso']);
    sh.appendRow([ADMIN, 'ativo', 'Willams Dantas', 'Administrador', '']);
    sh.setFrozenRows(1);
    sh.getRange('A1:E1').setFontWeight('bold').setBackground('#18181B').setFontColor('#F4F4F5');
    sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 180); sh.setColumnWidth(4, 220); sh.setColumnWidth(5, 160);
    var regra = SpreadsheetApp.newDataValidation().requireValueInList(['ativo', 'inativo', 'pendente'], true).setAllowInvalid(false).build();
    sh.getRange('B2:B').setDataValidation(regra);
    sh.getRange('E2:E').setNumberFormat('dd/MM/yyyy HH:mm');
    var cf = sh.getConditionalFormatRules();
    var faixa = sh.getRange('B2:B');
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('ativo').setBackground('#D7F5E3').setFontColor('#1E7A4B').setRanges([faixa]).build());
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('pendente').setBackground('#FBEFD5').setFontColor('#8A6416').setRanges([faixa]).build());
    cf.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('inativo').setBackground('#FADDDB').setFontColor('#A83A33').setRanges([faixa]).build());
    sh.setConditionalFormatRules(cf);
  }
  return sh;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
