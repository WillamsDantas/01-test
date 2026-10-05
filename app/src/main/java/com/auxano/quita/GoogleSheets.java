package com.auxano.quita;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Cria e atualiza a planilha do Quita no Google Drive do usuário
 * usando a Sheets API v4 com escopo drive.file (só arquivos criados pelo app).
 */
public class GoogleSheets {

    public static final String SCOPE = "oauth2:https://www.googleapis.com/auth/drive.file";
    private static final String API = "https://sheets.googleapis.com/v4/spreadsheets";
    private static final String HIST = "Histórico";

    public static class HttpError extends Exception {
        public final int code;
        HttpError(int code, String msg) { super(msg); this.code = code; }
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }

    private static JSONObject http(String method, String url, String token, JSONObject body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(40000);
        c.setRequestMethod(method);
        c.setRequestProperty("Authorization", "Bearer " + token);
        c.setRequestProperty("Accept", "application/json");
        if (body != null) {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setFixedLengthStreamingMode(bytes.length);
            OutputStream os = c.getOutputStream();
            os.write(bytes);
            os.close();
        }
        int code = c.getResponseCode();
        String resp = readAll(code >= 400 ? c.getErrorStream() : c.getInputStream());
        c.disconnect();
        if (code >= 400) {
            String msg = "HTTP " + code;
            try { msg = new JSONObject(resp).getJSONObject("error").optString("message", msg); } catch (Exception ignored) { }
            throw new HttpError(code, msg);
        }
        if (resp.length() == 0) return new JSONObject();
        return new JSONObject(resp);
    }

    private static String enc(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8").replace("+", "%20");
    }

    private static String q(String sheet) { return "'" + sheet.replace("'", "''") + "'"; }

    private static JSONObject sheetProps(String title) throws Exception {
        JSONObject grid = new JSONObject().put("frozenRowCount", 1);
        return new JSONObject().put("title", title).put("gridProperties", grid);
    }

    private static JSONObject headerFormat(int sheetId) throws Exception {
        JSONObject range = new JSONObject().put("sheetId", sheetId).put("startRowIndex", 0).put("endRowIndex", 1);
        JSONObject bg = new JSONObject().put("red", 0.067).put("green", 0.067).put("blue", 0.075);
        JSONObject fg = new JSONObject().put("red", 1).put("green", 1).put("blue", 1);
        JSONObject fmt = new JSONObject()
                .put("backgroundColor", bg)
                .put("textFormat", new JSONObject().put("bold", true).put("foregroundColor", fg));
        return new JSONObject().put("repeatCell", new JSONObject()
                .put("range", range)
                .put("cell", new JSONObject().put("userEnteredFormat", fmt))
                .put("fields", "userEnteredFormat(backgroundColor,textFormat)"));
    }

    /** Cria a planilha com todas as abas. Devolve o JSON da API (spreadsheetId, spreadsheetUrl, sheets). */
    private static JSONObject create(String token, String title, JSONArray order) throws Exception {
        JSONArray sheets = new JSONArray();
        for (int i = 0; i < order.length(); i++) sheets.put(new JSONObject().put("properties", sheetProps(order.getString(i))));
        sheets.put(new JSONObject().put("properties", sheetProps(HIST)));
        JSONObject props = new JSONObject().put("title", title).put("locale", "pt_BR").put("timeZone", "America/Sao_Paulo");
        JSONObject r = http("POST", API, token, new JSONObject().put("properties", props).put("sheets", sheets));
        JSONArray reqs = new JSONArray();
        JSONArray made = r.optJSONArray("sheets");
        if (made != null) for (int i = 0; i < made.length(); i++) reqs.put(headerFormat(made.getJSONObject(i).getJSONObject("properties").getInt("sheetId")));
        if (reqs.length() > 0) {
            try { http("POST", API + "/" + r.getString("spreadsheetId") + ":batchUpdate", token, new JSONObject().put("requests", reqs)); } catch (Exception ignored) { }
        }
        return r;
    }

    /**
     * Garante a planilha e escreve todos os dados.
     * payload = { title, order:[abas], sheets:{aba:[[...]]}, historico:{...} }
     * Devolve { id, url, criada }.
     */
    public static JSONObject sync(String token, String sheetId, JSONObject payload) throws Exception {
        JSONArray order = payload.getJSONArray("order");
        JSONObject data = payload.getJSONObject("sheets");
        String title = payload.optString("title", "Quita");
        boolean criada = false;
        String url;
        Map<String, Integer> existing = new HashMap<String, Integer>();

        JSONObject info = null;
        if (sheetId != null && sheetId.length() > 0) {
            try {
                info = http("GET", API + "/" + sheetId + "?fields=spreadsheetUrl,sheets.properties(sheetId,title)", token, null);
            } catch (HttpError e) {
                if (e.code != 404 && e.code != 403) throw e;
                info = null; // apagada ou sem acesso: cria outra
            }
        }
        if (info == null) {
            info = create(token, title, order);
            sheetId = info.getString("spreadsheetId");
            criada = true;
        }
        url = info.optString("spreadsheetUrl", "https://docs.google.com/spreadsheets/d/" + sheetId);
        JSONArray sh = info.optJSONArray("sheets");
        if (sh != null) for (int i = 0; i < sh.length(); i++) {
            JSONObject p = sh.getJSONObject(i).getJSONObject("properties");
            existing.put(p.getString("title"), p.getInt("sheetId"));
        }

        // abas que faltam (ex.: usuário apagou uma)
        JSONArray add = new JSONArray();
        for (int i = 0; i < order.length(); i++) {
            String t = order.getString(i);
            if (!existing.containsKey(t)) add.put(new JSONObject().put("addSheet", new JSONObject().put("properties", sheetProps(t))));
        }
        if (!existing.containsKey(HIST)) add.put(new JSONObject().put("addSheet", new JSONObject().put("properties", sheetProps(HIST))));
        if (add.length() > 0) {
            JSONObject r = http("POST", API + "/" + sheetId + ":batchUpdate", token, new JSONObject().put("requests", add));
            JSONArray replies = r.optJSONArray("replies");
            JSONArray fmt = new JSONArray();
            if (replies != null) for (int i = 0; i < replies.length(); i++) {
                JSONObject as = replies.getJSONObject(i).optJSONObject("addSheet");
                if (as != null) {
                    JSONObject ap = as.getJSONObject("properties");
                    existing.put(ap.getString("title"), ap.getInt("sheetId"));
                    fmt.put(headerFormat(ap.getInt("sheetId")));
                }
            }
            if (fmt.length() > 0) {
                try { http("POST", API + "/" + sheetId + ":batchUpdate", token, new JSONObject().put("requests", fmt)); } catch (Exception ignored) { }
            }
        }

        // grade do tamanho exato dos dados (sem 26 colunas vazias)
        JSONArray grid = new JSONArray();
        Map<String, int[]> dims = new HashMap<String, int[]>();
        for (int i = 0; i < order.length(); i++) {
            String t = order.getString(i);
            if (!existing.containsKey(t)) continue;
            JSONArray rows = data.optJSONArray(t);
            int nr = rows == null ? 0 : rows.length(), nc = 1;
            for (int r = 0; r < nr; r++) { JSONArray row = rows.optJSONArray(r); if (row != null && row.length() > nc) nc = row.length(); }
            dims.put(t, new int[]{nr, nc});
            grid.put(gridReq(existing.get(t), Math.max(nr, 2), nc));
        }
        if (existing.containsKey(HIST)) {
            grid.put(new JSONObject().put("updateSheetProperties", new JSONObject()
                    .put("properties", new JSONObject().put("sheetId", existing.get(HIST))
                            .put("gridProperties", new JSONObject().put("columnCount", 8).put("frozenRowCount", 1)))
                    .put("fields", "gridProperties(columnCount,frozenRowCount)")));
        }
        if (grid.length() > 0) {
            try { http("POST", API + "/" + sheetId + ":batchUpdate", token, new JSONObject().put("requests", grid)); } catch (Exception ignored) { }
        }

        // limpa e escreve as abas de dados
        JSONArray ranges = new JSONArray();
        JSONArray values = new JSONArray();
        for (int i = 0; i < order.length(); i++) {
            String t = order.getString(i);
            ranges.put(q(t));
            JSONArray rows = data.optJSONArray(t);
            if (rows == null || rows.length() == 0) continue;
            values.put(new JSONObject().put("range", q(t) + "!A1").put("values", rows));
        }
        http("POST", API + "/" + sheetId + "/values:batchClear", token, new JSONObject().put("ranges", ranges));
        if (values.length() > 0) {
            http("POST", API + "/" + sheetId + "/values:batchUpdate", token,
                    new JSONObject().put("valueInputOption", "RAW").put("data", values));
        }

        // histórico: uma linha por dia
        JSONObject h = payload.optJSONObject("historico");
        if (h != null) {
            JSONArray row = new JSONArray()
                    .put(h.optString("data")).put(h.opt("totalDevido")).put(h.opt("receitaMes")).put(h.opt("despesasMes"))
                    .put(h.opt("parcelasMes")).put(h.opt("comprometido")).put(h.opt("pagoMes")).put(h.opt("abertas"));
            JSONObject col = http("GET", API + "/" + sheetId + "/values/" + enc(q(HIST) + "!A:A"), token, null);
            JSONArray colv = col.optJSONArray("values");
            int n = colv == null ? 0 : colv.length();
            if (n == 0) {
                JSONArray header = new JSONArray().put("Data").put("Total devido").put("Receitas do mês").put("Despesas do mês")
                        .put("Parcelas do mês").put("% comprometido").put("Parcelas pagas no mês").put("Dívidas em aberto");
                http("PUT", API + "/" + sheetId + "/values/" + enc(q(HIST) + "!A1") + "?valueInputOption=RAW", token,
                        new JSONObject().put("values", new JSONArray().put(header).put(row)));
            } else {
                JSONArray last = colv.getJSONArray(n - 1);
                String lastDate = last.length() > 0 ? last.getString(0) : "";
                if (lastDate.equals(h.optString("data")) && n > 1) {
                    http("PUT", API + "/" + sheetId + "/values/" + enc(q(HIST) + "!A" + n) + "?valueInputOption=RAW", token,
                            new JSONObject().put("values", new JSONArray().put(row)));
                } else {
                    http("POST", API + "/" + sheetId + "/values/" + enc(q(HIST) + "!A1") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", token,
                            new JSONObject().put("values", new JSONArray().put(row)));
                }
            }
        }

        // acabamento: cabeçalho, R$ e %, largura das colunas
        try {
            JSONObject fmts = payload.optJSONObject("fmt");
            JSONArray reqs = new JSONArray();
            for (Map.Entry<String, int[]> e : dims.entrySet()) {
                int sid = existing.get(e.getKey()), nr = e.getValue()[0], nc = e.getValue()[1];
                reqs.put(headerFormatCols(sid, nc));
                JSONObject f = fmts == null ? null : fmts.optJSONObject(e.getKey());
                if (f != null && nr > 1) {
                    JSONArray brl = f.optJSONArray("brl"), pct = f.optJSONArray("pct");
                    if (brl != null) for (int i = 0; i < brl.length(); i++) reqs.put(numFmt(sid, 1, nr, brl.getInt(i), BRL_FMT));
                    if (pct != null) for (int i = 0; i < pct.length(); i++) reqs.put(numFmt(sid, 1, nr, pct.getInt(i), PCT_FMT));
                    JSONArray br = f.optJSONArray("brlRows"), pr = f.optJSONArray("pctRows");
                    if (br != null) for (int i = 0; i < br.length(); i++) reqs.put(numFmt(sid, br.getInt(i), br.getInt(i) + 1, 1, BRL_FMT));
                    if (pr != null) for (int i = 0; i < pr.length(); i++) reqs.put(numFmt(sid, pr.getInt(i), pr.getInt(i) + 1, 1, PCT_FMT));
                }
                reqs.put(autoResize(sid, nc));
            }
            if (existing.containsKey(HIST)) {
                int hs = existing.get(HIST);
                for (int c = 1; c <= 4; c++) reqs.put(numFmt(hs, 1, -1, c, BRL_FMT));
                reqs.put(numFmt(hs, 1, -1, 5, PCT_FMT));
                reqs.put(numFmt(hs, 1, -1, 6, BRL_FMT));
                reqs.put(headerFormatCols(hs, 8));
                reqs.put(autoResize(hs, 8));
            }
            if (reqs.length() > 0) http("POST", API + "/" + sheetId + ":batchUpdate", token, new JSONObject().put("requests", reqs));
        } catch (Exception ignored) { }

        return new JSONObject().put("id", sheetId).put("url", url).put("criada", criada);
    }

    private static final String BRL_FMT = "\"R$\" #,##0.00";
    private static final String PCT_FMT = "0.0\"%\"";

    private static JSONObject gridReq(int sid, int rows, int cols) throws Exception {
        return new JSONObject().put("updateSheetProperties", new JSONObject()
                .put("properties", new JSONObject().put("sheetId", sid)
                        .put("gridProperties", new JSONObject().put("rowCount", rows).put("columnCount", cols).put("frozenRowCount", 1)))
                .put("fields", "gridProperties(rowCount,columnCount,frozenRowCount)"));
    }

    private static JSONObject numFmt(int sid, int r0, int r1, int col, String pattern) throws Exception {
        JSONObject range = new JSONObject().put("sheetId", sid).put("startRowIndex", r0)
                .put("startColumnIndex", col).put("endColumnIndex", col + 1);
        if (r1 > 0) range.put("endRowIndex", r1);
        JSONObject nf = new JSONObject().put("type", "NUMBER").put("pattern", pattern);
        return new JSONObject().put("repeatCell", new JSONObject().put("range", range)
                .put("cell", new JSONObject().put("userEnteredFormat", new JSONObject().put("numberFormat", nf)))
                .put("fields", "userEnteredFormat.numberFormat"));
    }

    private static JSONObject headerFormatCols(int sid, int cols) throws Exception {
        JSONObject h = headerFormat(sid);
        h.getJSONObject("repeatCell").getJSONObject("range").put("startColumnIndex", 0).put("endColumnIndex", cols);
        return h;
    }

    private static JSONObject autoResize(int sid, int cols) throws Exception {
        return new JSONObject().put("autoResizeDimensions", new JSONObject().put("dimensions", new JSONObject()
                .put("sheetId", sid).put("dimension", "COLUMNS").put("startIndex", 0).put("endIndex", cols)));
    }
}
