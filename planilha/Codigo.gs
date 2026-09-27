/**
 * Quita — script da planilha online
 * 1) Crie uma planilha em branco no Google Sheets.
 * 2) Extensões → Apps Script → apague o que houver e cole este código → Salvar.
 * 3) Implantar → Nova implantação → tipo "App da Web"
 *      Executar como: Eu | Quem pode acessar: Qualquer pessoa → Implantar → Autorizar.
 * 4) Copie o link do App da Web (termina em /exec) e cole no app Quita (Ajustes).
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (data.action === 'ping') {
      return out({ ok: true, msg: 'Conectado à planilha "' + ss.getName() + '"' });
    }

    if (data.action === 'sync') {
      var sheets = data.sheets || {};
      var order = data.order || Object.keys(sheets);
      order.forEach(function (name) {
        writeSheet(ss, name, sheets[name] || []);
      });
      if (data.historico) appendHistorico(ss, data.historico);
      return out({ ok: true, msg: 'Planilha atualizada' });
    }

    return out({ ok: false, msg: 'Ação desconhecida' });
  } catch (err) {
    return out({ ok: false, msg: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet() {
  return out({ ok: true, msg: 'Quita: script ativo' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function writeSheet(ss, name, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  if (!rows.length) return;
  var width = rows[0].length;
  rows = rows.map(function (r) {
    r = r.slice(0, width);
    while (r.length < width) r.push('');
    return r;
  });
  sh.getRange(1, 1, rows.length, width).setValues(rows);
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#0F5C4D').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
}

/** Uma linha por dia: se já existe linha de hoje, ela é atualizada. */
function appendHistorico(ss, h) {
  var name = 'Histórico';
  var sh = ss.getSheetByName(name);
  var header = ['Data', 'Total devido', 'Receitas do mês', 'Despesas do mês', 'Parcelas do mês', '% comprometido', 'Parcelas pagas no mês', 'Dívidas em aberto'];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header])
      .setFontWeight('bold').setBackground('#0F5C4D').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
  }
  var row = [h.data, h.totalDevido, h.receitaMes, h.despesasMes || 0, h.parcelasMes, h.comprometido, h.pagoMes, h.abertas];
  var last = sh.getLastRow();
  if (last >= 2 && String(sh.getRange(last, 1).getDisplayValue()) === String(h.data)) {
    sh.getRange(last, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
}
