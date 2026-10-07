package com.auxano.quita;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.accounts.AccountManagerCallback;
import android.accounts.AccountManagerFuture;
import android.app.Activity;
import android.app.DownloadManager;
import android.provider.Settings;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.view.View;
import android.view.HapticFeedbackConstants;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class MainActivity extends Activity {

    private static final int REQ_FILE = 42;
    private static final String DATA_FILE = "quita-data.json";

    private WebView web;
    private WebView printView;
    private static final int REQ_NOTIF = 7;
    private static final int REQ_ACCOUNT = 4242;
    private static final int REQ_ACC_PERM = 4243;
    private String gPendingPayload = null;
    private String gDono = "";
    private ValueCallback<Uri[]> fileCallback;

    private boolean themeDark = true;

    /** Lê o tema salvo pela interface (escuro / claro / automático) para o tema nativo (calendário, relógio). */
    private boolean wantsDark() {
        String tema = "dark";
        try {
            File f = new File(getFilesDir(), DATA_FILE);
            if (f.exists()) {
                JSONObject o = new JSONObject(readAll(new FileInputStream(f)));
                tema = o.optJSONObject("ajustes") != null ? o.optJSONObject("ajustes").optString("tema", "dark") : "dark";
            }
        } catch (Exception ignored) { }
        if ("light".equals(tema)) return false;
        if ("auto".equals(tema)) {
            return systemDark();
        }
        return true;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        themeDark = wantsDark();
        setTheme(themeDark ? R.style.AppTheme : R.style.AppThemeLight);
        super.onCreate(savedInstanceState);
        boolean themeSwap = false;
        if (savedInstanceState != null) {
            pausedAt = savedInstanceState.getLong("pausedAt", 0);
            themeSwap = savedInstanceState.getBoolean("themeSwap", false);
        }
        Window w = getWindow();
        w.setStatusBarColor(0xFF111113);
        w.setNavigationBarColor(0xFF111113);

        web = new WebView(this);
        web.setBackgroundColor(0xFF111113);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setMediaPlaybackRequiresUserGesture(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file:")) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Escolher backup"), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "Android");
        // limpa a tela guardada em memória quando o app é atualizado
        int vc = 0;
        try { vc = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (Exception ignored) { }
        android.content.SharedPreferences sp = getSharedPreferences("quita_app", MODE_PRIVATE);
        if (sp.getInt("vc", -1) != vc) {
            web.clearCache(true);
            sp.edit().putInt("vc", vc).apply();
        }
        web.loadUrl("file:///android_asset/index.html?v=" + vc + (themeSwap ? "&nolock=1" : ""));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        if (requestCode == REQ_ACCOUNT) {
            if (resultCode == RESULT_OK && data != null) {
                String name = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
                if (name != null) { gEtapa("conta"); gAuthorize(new Account(name, "com.google")); return; }
            }
            gResult(false, "Login cancelado", null, null);
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_ACC_PERM) {
            gChooseAccount();
            return;
        }
        if (requestCode == REQ_NOTIF) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            web.evaluateJavascript("window.quitaNotifPerm && window.quitaNotifPerm(" + ok + ")", null);
        }
    }

    private boolean notifAllowed() {
        if (Build.VERSION.SDK_INT >= 33) {
            return checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
        }
        android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        return nm == null || nm.areNotificationsEnabled();
    }

    /** Renderiza o HTML do relatório numa WebView fora da tela e abre a tela de impressão (Salvar como PDF). */
    private void printHtml(final String html, final String name) {
        printView = new WebView(this);
        printView.getSettings().setJavaScriptEnabled(false);
        printView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter ad = view.createPrintDocumentAdapter(name);
                PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build();
                pm.print(name, ad, attrs);
            }
        });
        printView.loadDataWithBaseURL("file:///android_asset/", html, "text/html", "UTF-8", null);
    }

    private boolean systemDark() {
        int m = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        return m == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (web != null) web.evaluateJavascript("window.quitaSysTheme && window.quitaSysTheme()", null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.quitaBack ? window.quitaBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"true".equals(value)) superBack();
            }
        });
    }

    private void superBack() {
        super.onBackPressed();
    }

    private long pausedAt = 0;
    private Boolean pendingDark = null;

    @Override
    protected void onStop() {
        super.onStop();
        if (pendingDark != null && pendingDark != themeDark) {
            themeDark = pendingDark;
            swapping = true;
            recreate();
        }
    }

    private boolean swapping = false;

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putLong("pausedAt", pausedAt);
        out.putBoolean("themeSwap", swapping);
    }

    @Override
    protected void onPause() {
        super.onPause();
        pausedAt = System.currentTimeMillis();
    }

    @Override
    protected void onResume() {
        super.onResume();
        long away = pausedAt == 0 ? 0 : System.currentTimeMillis() - pausedAt;
        if (web != null) web.evaluateJavascript("window.quitaResume && window.quitaResume(" + away + ")", null);
    }

    private boolean bioAvailableNative() {
        if (Build.VERSION.SDK_INT < 28) return false;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                android.hardware.biometrics.BiometricManager bm = (android.hardware.biometrics.BiometricManager) getSystemService(Context.BIOMETRIC_SERVICE);
                return bm != null && bm.canAuthenticate() == android.hardware.biometrics.BiometricManager.BIOMETRIC_SUCCESS;
            }
            return getPackageManager().hasSystemFeature(PackageManager.FEATURE_FINGERPRINT);
        } catch (Exception e) {
            return false;
        }
    }

    private void showBioPrompt() {
        if (Build.VERSION.SDK_INT < 28) return;
        final java.util.concurrent.Executor ex = getMainExecutor();
        android.hardware.biometrics.BiometricPrompt bp = new android.hardware.biometrics.BiometricPrompt.Builder(this)
                .setTitle("Desbloquear o Quita")
                .setSubtitle("Use sua digital ou rosto")
                .setNegativeButton("Usar PIN", ex, new android.content.DialogInterface.OnClickListener() {
                    @Override public void onClick(android.content.DialogInterface d, int w) { }
                })
                .build();
        bp.authenticate(new android.os.CancellationSignal(), ex, new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult result) {
                web.evaluateJavascript("window.quitaBio && window.quitaBio(true)", null);
            }
        });
    }


    /* ---------- Login com Google + planilha ---------- */
    private android.content.SharedPreferences gPrefs() { return getSharedPreferences("quita_app", MODE_PRIVATE); }

    private void gEmit(final String fn, final JSONObject o) {
        final String js = "window." + fn + " && window." + fn + "(" + o.toString() + ")";
        runOnUiThread(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
    }

    /** avisa a tela de carregamento em que etapa o login está */
    private void gEtapa(String etapa) {
        try { gEmit("quitaGEtapa", new JSONObject().put("etapa", etapa)); } catch (Exception ignored) { }
    }

    private void gResult(boolean ok, String msg, String email, JSONObject sheet) {
        try {
            JSONObject o = new JSONObject().put("ok", ok).put("msg", msg == null ? "" : msg);
            if (email != null) o.put("email", email);
            if (sheet != null) { o.put("id", sheet.optString("id")); o.put("url", sheet.optString("url")); o.put("criada", sheet.optBoolean("criada")); }
            gEmit("quitaGoogle", o);
        } catch (Exception ignored) { }
    }

    @SuppressWarnings("deprecation")
    private void gChooseAccount() {
        try {
            Intent it = AccountManager.newChooseAccountIntent(null, null, new String[]{"com.google"}, false, null, null, null, null);
            startActivityForResult(it, REQ_ACCOUNT);
        } catch (Exception e) {
            gResult(false, "Não foi possível abrir as contas do Google deste celular", null, null);
        }
    }

    private void gAuthorize(final Account acc) {
        AccountManager.get(this).getAuthToken(acc, GoogleSheets.SCOPE, null, this, new AccountManagerCallback<Bundle>() {
            @Override public void run(final AccountManagerFuture<Bundle> future) {
                new Thread(new Runnable() { @Override public void run() {
                    try {
                        Bundle b = future.getResult();
                        String token = b.getString(AccountManager.KEY_AUTHTOKEN);
                        if (token == null) { gResult(false, "O Google não liberou o acesso", null, null); return; }
                        gPrefs().edit().putString("g_account", acc.name).apply();
                        gEtapa("dados");
                        // 1) já existe planilha do Quita nesse Google? traz a cópia para o app decidir
                        try {
                            String sid = gPrefs().getString("g_sheet", "");
                            JSONObject found = null;
                            if (sid.length() > 0) found = new JSONObject().put("id", sid).put("url", "https://docs.google.com/spreadsheets/d/" + sid);
                            else found = GoogleSheets.findSheet(token);
                            if (found != null) {
                                JSONObject bk = null;
                                try { bk = GoogleSheets.readBackup(token, found.getString("id")); } catch (Exception ignored) { }
                                JSONObject o = new JSONObject().put("ok", true).put("msg", "").put("email", acc.name)
                                        .put("id", found.getString("id")).put("url", found.optString("url")).put("existente", true);
                                if (bk != null) { o.put("backup", bk.optString("dados")); o.put("backupEm", bk.optString("em")); }
                                gPendingPayload = null;
                                gEmit("quitaGoogle", o);
                                return;
                            }
                        } catch (Exception ignored) { }
                        // 2) não existe: cria agora
                        JSONObject sheet = null;
                        String msg = "";
                        // os dados deste aparelho são de outra conta: não leva para a planilha nova
                        boolean outraConta = gDono.length() > 0 && !gDono.equalsIgnoreCase(acc.name);
                        if (gPendingPayload != null && !outraConta) {
                            try {
                                JSONObject pl = new JSONObject(gPendingPayload);
                                pl.put("title", "Quita – " + acc.name.split("@")[0]);
                                sheet = gSyncWithRetry(acc, token, "", pl);
                            } catch (Exception se) {
                                msg = "Login feito, mas a planilha não foi criada: " + se.getMessage();
                            }
                        }
                        gPendingPayload = null;
                        gResult(true, msg, acc.name, sheet);
                    } catch (android.accounts.OperationCanceledException ce) {
                        gResult(false, "Login cancelado", null, null);
                    } catch (Exception e) {
                        gResult(false, "Falha no login do Google: " + e.getMessage(), null, null);
                    }
                } }).start();
            }
        }, null);
    }

    private JSONObject acGet(String url, String token) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url + (url.contains("?") ? "&" : "?") + "t=" + java.net.URLEncoder.encode(token, "UTF-8")).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(20000);
        c.setInstanceFollowRedirects(true);
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String body = in == null ? "" : readAll(in);
        c.disconnect();
        if (code >= 400) throw new Exception("HTTP " + code);
        return new JSONObject(body);
    }

    private JSONObject gSyncWithRetry(Account acc, String token, String sheetId, JSONObject payload) throws Exception {
        JSONObject r;
        try {
            r = GoogleSheets.sync(token, sheetId, payload);
        } catch (GoogleSheets.HttpError e) {
            if (e.code != 401) throw e;
            AccountManager am = AccountManager.get(this);
            am.invalidateAuthToken("com.google", token);
            String t2 = am.blockingGetAuthToken(acc, GoogleSheets.SCOPE, true);
            if (t2 == null) throw new Exception("Entre de novo com o Google em Ajustes");
            r = GoogleSheets.sync(t2, sheetId, payload);
        }
        gPrefs().edit().putString("g_sheet", r.optString("id")).apply();
        return r;
    }

    private void callback(final String cbId, final boolean ok, final String msg) {
        final String js = "window.quitaCb && window.quitaCb(" + JSONObject.quote(cbId) + "," + ok + "," + JSONObject.quote(msg == null ? "" : msg) + ")";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(js, null);
            }
        });
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }

    /** POST to Google Apps Script, following the 302 redirect with a GET (Apps Script behaviour). */
    private static String postJson(String urlStr, String body) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(20000);
        c.setReadTimeout(30000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "text/plain;charset=utf-8");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        c.setFixedLengthStreamingMode(bytes.length);
        OutputStream os = c.getOutputStream();
        os.write(bytes);
        os.close();
        int code = c.getResponseCode();
        int hops = 0;
        while ((code == 301 || code == 302 || code == 303 || code == 307 || code == 308) && hops < 6) {
            String loc = c.getHeaderField("Location");
            c.disconnect();
            if (loc == null) throw new Exception("Redirecionamento sem destino");
            URL next = new URL(url, loc);
            url = next;
            c = (HttpURLConnection) next.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setRequestMethod("GET");
            code = c.getResponseCode();
            hops++;
        }
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String resp = in == null ? "" : readAll(in);
        c.disconnect();
        if (code >= 400) throw new Exception("HTTP " + code);
        return resp;
    }

    public class Bridge {

        @JavascriptInterface
        public String load() {
            try {
                File f = new File(getFilesDir(), DATA_FILE);
                if (!f.exists()) return "";
                return readAll(new FileInputStream(f));
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean save(String json) {
            try {
                File tmp = new File(getFilesDir(), DATA_FILE + ".tmp");
                FileOutputStream fo = new FileOutputStream(tmp);
                fo.write(json.getBytes(StandardCharsets.UTF_8));
                fo.getFD().sync();
                fo.close();
                File f = new File(getFilesDir(), DATA_FILE);
                if (!tmp.renameTo(f)) {
                    FileOutputStream fo2 = new FileOutputStream(f);
                    fo2.write(json.getBytes(StandardCharsets.UTF_8));
                    fo2.close();
                    tmp.delete();
                }
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void share(final String text) {
            runOnUiThread(new Runnable() { @Override public void run() {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Compartilhar relatório"));
            }});
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(new Runnable() { @Override public void run() {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("Quita", text));
            }});
        }

        @JavascriptInterface
        public void toast(final String text) {
            runOnUiThread(new Runnable() { @Override public void run() { Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show(); } });
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() { @Override public void run() {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) { }
            }});
        }

        /** Saves a file into Downloads/Quita. Returns a short message. */
        /* ---------- v1.8: backup automático ---------- */
        private File backupDir() {
            File d = new File(getFilesDir(), "backups");
            if (!d.exists()) d.mkdirs();
            return d;
        }

        @JavascriptInterface
        public String autoBackup(String date, String json) {
            String nome = "quita-" + date.replaceAll("[^0-9-]", "") + ".json";
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            try {
                File f = new File(backupDir(), nome);
                FileOutputStream fo = new FileOutputStream(f);
                fo.write(bytes);
                fo.close();
                File[] all = backupDir().listFiles();
                if (all != null && all.length > 8) {
                    String[] ns = new String[all.length];
                    for (int i = 0; i < all.length; i++) ns[i] = all[i].getName();
                    Arrays.sort(ns);
                    for (int i = 0; i < ns.length - 8; i++) new File(backupDir(), ns[i]).delete();
                }
            } catch (Exception e) {
                return "ERRO: " + e.getMessage();
            }
            String ext = "interno";
            if (Build.VERSION.SDK_INT >= 29) {
                try {
                    String disp = "Quita-backup-auto-" + date.replaceAll("[^0-9-]", "") + ".json";
                    String rel = Environment.DIRECTORY_DOWNLOADS + "/Quita/";
                    Uri col = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                    List<String[]> mine = new ArrayList<String[]>();
                    Cursor c = getContentResolver().query(col,
                            new String[]{MediaStore.Downloads._ID, MediaStore.Downloads.DISPLAY_NAME},
                            MediaStore.Downloads.DISPLAY_NAME + " LIKE ?",
                            new String[]{"Quita-backup-auto-%"}, null);
                    if (c != null) {
                        while (c.moveToNext()) mine.add(new String[]{c.getString(1), String.valueOf(c.getLong(0))});
                        c.close();
                    }
                    for (String[] m : mine) {
                        if (m[0].equals(disp)) getContentResolver().delete(Uri.withAppendedPath(col, m[1]), null, null);
                    }
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, disp);
                    v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    v.put(MediaStore.Downloads.RELATIVE_PATH, rel);
                    Uri uri = getContentResolver().insert(col, v);
                    if (uri != null) {
                        OutputStream os = getContentResolver().openOutputStream(uri);
                        os.write(bytes);
                        os.close();
                        ext = "downloads";
                    }
                    List<String> nomes = new ArrayList<String>();
                    for (String[] m : mine) if (!m[0].equals(disp)) nomes.add(m[0] + "|" + m[1]);
                    nomes.add(disp + "|");
                    Collections.sort(nomes);
                    for (int i = 0; i < nomes.size() - 4; i++) {
                        String id = nomes.get(i).substring(nomes.get(i).indexOf('|') + 1);
                        if (id.length() > 0) getContentResolver().delete(Uri.withAppendedPath(col, id), null, null);
                    }
                } catch (Exception ignored) { }
            }
            return "OK " + ext;
        }

        @JavascriptInterface
        public String listBackups() {
            JSONArray a = new JSONArray();
            try {
                File[] all = backupDir().listFiles();
                if (all != null) {
                    String[] ns = new String[all.length];
                    for (int i = 0; i < all.length; i++) ns[i] = all[i].getName();
                    Arrays.sort(ns);
                    for (int i = ns.length - 1; i >= 0; i--) {
                        JSONObject o = new JSONObject();
                        o.put("nome", ns[i]);
                        o.put("tam", new File(backupDir(), ns[i]).length());
                        a.put(o);
                    }
                }
            } catch (Exception ignored) { }
            return a.toString();
        }

        @JavascriptInterface
        public String readBackup(String nome) {
            try {
                if (nome.contains("/") || nome.contains("..")) return "";
                File f = new File(backupDir(), nome);
                FileInputStream in = new FileInputStream(f);
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                in.close();
                return new String(bo.toByteArray(), StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "";
            }
        }

        /* ---------- Google ---------- */
        @JavascriptInterface
        public void gLogin(final String payloadJson, final String dono) {
            gPendingPayload = payloadJson;
            gDono = dono == null ? "" : dono.trim().toLowerCase();
            runOnUiThread(new Runnable() { @Override public void run() {
                if (Build.VERSION.SDK_INT < 26 && checkSelfPermission("android.permission.GET_ACCOUNTS") != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{"android.permission.GET_ACCOUNTS"}, REQ_ACC_PERM);
                } else {
                    gChooseAccount();
                }
            } });
        }

        @JavascriptInterface
        public void gSync(final String payloadJson, final String sheetId) {
            new Thread(new Runnable() { @Override public void run() {
                JSONObject o = new JSONObject();
                try {
                    String name = gPrefs().getString("g_account", "");
                    if (name.length() == 0) throw new Exception("Entre com o Google em Ajustes");
                    Account acc = new Account(name, "com.google");
                    String token = AccountManager.get(MainActivity.this).blockingGetAuthToken(acc, GoogleSheets.SCOPE, true);
                    if (token == null) throw new Exception("O Google pediu para confirmar o acesso. Toque em Entrar com Google em Ajustes");
                    String sid = "NEW".equals(sheetId) ? "" : (sheetId != null && sheetId.length() > 0 ? sheetId : gPrefs().getString("g_sheet", ""));
                    JSONObject r = gSyncWithRetry(acc, token, sid, new JSONObject(payloadJson));
                    o.put("ok", true).put("id", r.optString("id")).put("url", r.optString("url")).put("criada", r.optBoolean("criada"));
                } catch (Exception e) {
                    try { o.put("ok", false).put("msg", e.getMessage() == null ? "erro" : e.getMessage()); } catch (Exception ignored) { }
                }
                gEmit("quitaGSync", o);
            } }).start();
        }

        /** Funções do administrador na planilha (com o login do Google). Responde em window.quitaApi(id, json). */
        @JavascriptInterface
        public void acApi(final String id, final String url) {
            new Thread(new Runnable() { @Override public void run() {
                JSONObject o;
                try {
                    String name = gPrefs().getString("g_account", "");
                    if (name.length() == 0) throw new Exception("sem conta");
                    Account acc = new Account(name, "com.google");
                    AccountManager am = AccountManager.get(MainActivity.this);
                    String token = am.blockingGetAuthToken(acc, GoogleSheets.SCOPE, true);
                    if (token == null) throw new Exception("O Google pediu para confirmar o acesso");
                    o = acGet(url, token);
                    if (!o.optBoolean("ok") && "login".equals(o.optString("erro"))) {
                        am.invalidateAuthToken("com.google", token);
                        String t2 = am.blockingGetAuthToken(acc, GoogleSheets.SCOPE, true);
                        if (t2 != null) o = acGet(url, t2);
                    }
                } catch (Exception e) {
                    o = new JSONObject();
                    try { o.put("ok", false).put("msg", e.getMessage() == null ? "Sem conexão" : e.getMessage()); } catch (Exception ignored) { }
                }
                final String js = "window.quitaApi && window.quitaApi(" + JSONObject.quote(id) + "," + o.toString() + ")";
                runOnUiThread(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
            } }).start();
        }

        /** Confere na planilha "Acessos" se o e-mail da conta Google está liberado. Responde em window.quitaAcesso. */
        @JavascriptInterface
        public void acCheck(final String url) {
            new Thread(new Runnable() { @Override public void run() {
                JSONObject o;
                try {
                    String name = gPrefs().getString("g_account", "");
                    if (name.length() == 0) throw new Exception("sem conta");
                    Account acc = new Account(name, "com.google");
                    AccountManager am = AccountManager.get(MainActivity.this);
                    String token = am.blockingGetAuthToken(acc, GoogleSheets.SCOPE, true);
                    if (token == null) throw new Exception("O Google pediu para confirmar o acesso");
                    o = acGet(url, token);
                    if (!o.optBoolean("ok") && "login".equals(o.optString("erro"))) {
                        am.invalidateAuthToken("com.google", token);
                        String t2 = am.blockingGetAuthToken(acc, GoogleSheets.SCOPE, true);
                        if (t2 != null) o = acGet(url, t2);
                    }
                    o.put("rede", true);
                } catch (Exception e) {
                    o = new JSONObject();
                    try { o.put("ok", false).put("rede", false).put("msg", e.getMessage() == null ? "erro" : e.getMessage()); } catch (Exception ignored) { }
                }
                gEmit("quitaAcesso", o);
            } }).start();
        }

        @JavascriptInterface
        public void gLogout() {
            gPrefs().edit().remove("g_account").remove("g_sheet").apply();
        }

        @JavascriptInterface
        public String gAccount() {
            return gPrefs().getString("g_account", "");
        }

        @JavascriptInterface
        public String exportFile(String name, String mime, String content) {
            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Quita");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("sem acesso");
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    os.write(bytes);
                    os.close();
                    return "Salvo em Downloads/Quita/" + name;
                } else {
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Quita");
                    if (!dir.exists() && !dir.mkdirs()) {
                        dir = getExternalFilesDir(null);
                    }
                    File f = new File(dir, name);
                    FileOutputStream fo = new FileOutputStream(f);
                    fo.write(bytes);
                    fo.close();
                    return "Salvo em " + f.getAbsolutePath();
                }
            } catch (Exception e) {
                return "ERRO: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public void sync(final String url, final String body, final String cbId) {
            new Thread(new Runnable() { @Override public void run() {
                try {
                    String resp = postJson(url, body);
                    boolean ok = false;
                    String msg = resp;
                    try {
                        JSONObject o = new JSONObject(resp);
                        ok = o.optBoolean("ok", false);
                        msg = o.optString("msg", o.optString("error", resp));
                    } catch (Exception je) {
                        if (resp.contains("<html") || resp.contains("<!DOCTYPE")) {
                            msg = "A planilha respondeu com uma página, não com dados. Confira se o App da Web está com acesso \"Qualquer pessoa\".";
                        }
                    }
                    callback(cbId, ok, msg);
                } catch (Exception e) {
                    callback(cbId, false, "Sem conexão com a planilha (" + e.getMessage() + ")");
                }
            }}).start();
        }

        @JavascriptInterface
        public String hash(String s) {
            try {
                java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
                byte[] h = md.digest(s.getBytes(StandardCharsets.UTF_8));
                StringBuilder sb = new StringBuilder();
                for (byte b : h) sb.append(String.format("%02x", b));
                return sb.toString();
            } catch (Exception e) {
                return s;
            }
        }

        @JavascriptInterface
        public boolean bioAvailable() {
            return bioAvailableNative();
        }

        @JavascriptInterface
        public void bioPrompt() {
            runOnUiThread(new Runnable() { @Override public void run() { try { showBioPrompt(); } catch (Exception ignored) { } } });
        }

        @JavascriptInterface
        public long awayMs() {
            return pausedAt == 0 ? 0 : System.currentTimeMillis() - pausedAt;
        }

        @JavascriptInterface
        public boolean systemDark() {
            return MainActivity.this.systemDark();
        }

        @JavascriptInterface
        public void haptic() {
            runOnUiThread(new Runnable() { @Override public void run() {
                int c = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
                web.performHapticFeedback(c, HapticFeedbackConstants.FLAG_IGNORE_VIEW_SETTING);
            }});
        }

        @JavascriptInterface
        public void setBars(final boolean dark) {
            runOnUiThread(new Runnable() { @Override public void run() {
                // o tema nativo (calendário) é trocado quando o app for para segundo plano, sem piscar a tela
                pendingDark = dark;
                final int c = dark ? 0xFF111113 : 0xFFF3F4F6;
                final Window w = getWindow();
                int from = w.getStatusBarColor();
                if (from != c) {
                    android.animation.ValueAnimator va = android.animation.ValueAnimator.ofArgb(from, c);
                    va.setDuration(450);
                    va.addUpdateListener(new android.animation.ValueAnimator.AnimatorUpdateListener() {
                        @Override public void onAnimationUpdate(android.animation.ValueAnimator a) {
                            int v = (Integer) a.getAnimatedValue();
                            w.setStatusBarColor(v);
                            w.setNavigationBarColor(v);
                        }
                    });
                    va.start();
                }
                int flags = 0;
                if (!dark) {
                    flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                    if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
                w.getDecorView().setSystemUiVisibility(flags);
                web.setBackgroundColor(c);
            }});
        }

        @JavascriptInterface
        public void printPdf(final String html, final String name) {
            runOnUiThread(new Runnable() { @Override public void run() { printHtml(html, name); } });
        }

        @JavascriptInterface
        public void setAlerts(String json) {
            AlertReceiver.saveSchedule(MainActivity.this, json);
        }

        @JavascriptInterface
        public String notifStatus() {
            return notifAllowed() ? "granted" : "denied";
        }

        @JavascriptInterface
        public void requestNotif() {
            runOnUiThread(new Runnable() { @Override public void run() {
                if (Build.VERSION.SDK_INT >= 33 && !notifAllowed()) {
                    requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF);
                } else if (!notifAllowed()) {
                    Intent i = new Intent("android.settings.APP_NOTIFICATION_SETTINGS");
                    i.putExtra("android.provider.extra.APP_PACKAGE", getPackageName());
                    try { startActivity(i); } catch (Exception ignored) { }
                } else {
                    web.evaluateJavascript("window.quitaNotifPerm && window.quitaNotifPerm(true)", null);
                }
            }});
        }

        @JavascriptInterface
        public void openNotifSettings() {
            runOnUiThread(new Runnable() { @Override public void run() {
                Intent i = new Intent("android.settings.APP_NOTIFICATION_SETTINGS");
                i.putExtra("android.provider.extra.APP_PACKAGE", getPackageName());
                try { startActivity(i); } catch (Exception ignored) { }
            }});
        }

        @JavascriptInterface
        public void testAlert(String title, String text) {
            AlertReceiver.notify(MainActivity.this, 99999, title, text);
        }

        @JavascriptInterface
        public String version() {
            return "2.0.13";
        }

        /* ---------- atualização dentro do app ---------- */
        @JavascriptInterface
        public String updDownload(String url, String name) {
            try {
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir != null) {
                    File[] olds = dir.listFiles();
                    if (olds != null) for (File f : olds) if (f.getName().endsWith(".apk")) f.delete();
                }
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                r.setTitle("Quita · atualização");
                r.setDescription(name);
                r.setMimeType("application/vnd.android.package-archive");
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
                r.setDestinationInExternalFilesDir(MainActivity.this, Environment.DIRECTORY_DOWNLOADS, name);
                return String.valueOf(dm.enqueue(r));
            } catch (Exception e) {
                return "ERRO:" + e.getMessage();
            }
        }

        @JavascriptInterface
        public String updStatus(String id) {
            try {
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                Cursor c = dm.query(new DownloadManager.Query().setFilterById(Long.parseLong(id)));
                JSONObject o = new JSONObject();
                if (c == null || !c.moveToFirst()) { o.put("st", "fail"); return o.toString(); }
                int st = c.getInt(c.getColumnIndex(DownloadManager.COLUMN_STATUS));
                long done = c.getLong(c.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = c.getLong(c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                c.close();
                o.put("st", st == DownloadManager.STATUS_SUCCESSFUL ? "ok" : st == DownloadManager.STATUS_FAILED ? "fail" : "run");
                o.put("done", done); o.put("total", total);
                return o.toString();
            } catch (Exception e) {
                return "{\"st\":\"fail\"}";
            }
        }

        /** Abre o instalador do Android. Retorna "ok", "perm" (precisa liberar a instalação) ou "ERRO:...". */
        @JavascriptInterface
        public String updInstall(String id) {
            try {
                if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                    Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                    startActivity(s);
                    return "perm";
                }
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                Uri u = dm.getUriForDownloadedFile(Long.parseLong(id));
                if (u == null) return "ERRO:arquivo não encontrado";
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(u, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return "ok";
            } catch (Exception e) {
                return "ERRO:" + e.getMessage();
            }
        }
    }
}
