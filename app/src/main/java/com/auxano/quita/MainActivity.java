package com.auxano.quita;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

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

public class MainActivity extends Activity {

    private static final int REQ_FILE = 42;
    private static final String DATA_FILE = "quita-data.json";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(0xFF0F5C4D);

        web = new WebView(this);
        web.setBackgroundColor(0xFFF4F6F5);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
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
        web.loadUrl("file:///android_asset/index.html");
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
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.quitaBack ? window.quitaBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.quitaResume && window.quitaResume()", null);
    }

    private void callback(final String cbId, final boolean ok, final String msg) {
        final String js = "window.quitaCb && window.quitaCb(" + JSONObject.quote(cbId) + "," + ok + "," + JSONObject.quote(msg == null ? "" : msg) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
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
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, "Compartilhar relatório"));
            });
        }

        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("Quita", text));
            });
        }

        @JavascriptInterface
        public void toast(final String text) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) { }
            });
        }

        /** Saves a file into Downloads/Quita. Returns a short message. */
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
            new Thread(() -> {
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
            }).start();
        }

        @JavascriptInterface
        public String version() {
            return "1.0.0";
        }
    }
}
