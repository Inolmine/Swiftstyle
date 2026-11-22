var SHEET_NAME = 'Marques';

var HEADERS = [
  'Date',
  'Marque',
  'Site web',
  'Nom',
  'Email',
  'Message',
  'Page source',
  'Référent',
  'Plateforme',
  'Commandes par mois'
];

var EMAIL_COL = 5;

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    var email = String(data.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
      return json({ ok: false, error: 'email invalide' });
    }

    var sheet = getSheet_();

    if (emailExists_(sheet, email)) {
      return json({ ok: true, duplicate: true });
    }

    sheet.appendRow([
      new Date(),
      clean_(data.marque, 120),
      clean_(data.siteWeb, 200),
      clean_(data.nom, 120),
      email,
      clean_(data.message, 2000),
      clean_(data.source, 300),
      clean_(data.referrer, 300),
      clean_(data.plateforme, 80),
      clean_(data.volume, 80)
    ]);

    notify_(data, email);

    return json({ ok: true });

  } catch (err) {
    console.error(err);
    return json({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json({ ok: true, service: 'SwiftStyle pilotes' });
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
         .setFontWeight('bold')
         .setBackground('#f2ede2');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160);
    sheet.setColumnWidth(3, 200);
    sheet.setColumnWidth(EMAIL_COL, 230);
    sheet.setColumnWidth(6, 320);
  }

  if (sheet.getLastColumn() < HEADERS.length) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  }

  return sheet;
}

function emailExists_(sheet, email) {
  var last = sheet.getLastRow();
  if (last < 2) return false;

  var values = sheet.getRange(2, EMAIL_COL, last - 1, 1).getValues();
  var needle = email.toLowerCase();

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === needle) return true;
  }
  return false;
}

function clean_(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function notify_(data, email) {
  var DESTINATAIRE = '';
  if (!DESTINATAIRE) return;

  var corps =
    'Nouvelle demande de pilote SwiftStyle\n\n' +
    'Marque   : ' + clean_(data.marque, 120) + '\n' +
    'Site web : ' + clean_(data.siteWeb, 200) + '\n' +
    'Plateforme : ' + clean_(data.plateforme, 80) + '\n' +
    'Volume   : ' + clean_(data.volume, 80) + '\n' +
    'Contact  : ' + clean_(data.nom, 120) + '\n' +
    'Email    : ' + email + '\n' +
    'Message  : ' + clean_(data.message, 2000) + '\n';

  MailApp.sendEmail(DESTINATAIRE, 'SwiftStyle : demande de pilote', corps);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
