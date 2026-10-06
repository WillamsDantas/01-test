package com.auxano.quita.acessos;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.HapticFeedbackConstants;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Quita Acessos — app do administrador para liberar e bloquear quem usa o Quita. */
public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("file:")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.evaluateJavascript("window.aoVoltar && window.aoVoltar()", null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.voltar ? window.voltar() : false", new ValueCallback<String>() {
            @Override public void onReceiveValue(String v) { if (!"true".equals(v)) MainActivity.super.onBackPressed(); }
        });
    }

    private SharedPreferences prefs() { return getSharedPreferences("acessos", MODE_PRIVATE); }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        in.close();
        return new String(b.toByteArray(), StandardCharsets.UTF_8);
    }

    public class Bridge {
        @JavascriptInterface
        public String get(String k) { return prefs().getString(k, ""); }

        @JavascriptInterface
        public void set(String k, String v) { prefs().edit().putString(k, v).apply(); }

        @JavascriptInterface
        public String version() { return "1.0.1"; }

        @JavascriptInterface
        public void haptic() {
            runOnUiThread(new Runnable() { @Override public void run() { web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP); } });
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() { @Override public void run() {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
            } });
        }

        /** GET na planilha; responde em window.apiCb(id, texto). */
        @JavascriptInterface
        public void api(final String id, final String url) {
            new Thread(new Runnable() { @Override public void run() {
                String body;
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(25000);
                    c.setInstanceFollowRedirects(true);
                    int code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    body = in == null ? "" : readAll(in);
                    c.disconnect();
                    if (code >= 400) body = "{\"ok\":false,\"msg\":\"HTTP " + code + "\"}";
                } catch (Exception e) {
                    body = "{\"ok\":false,\"rede\":false,\"msg\":\"Sem conexão\"}";
                }
                final String js = "window.apiCb && window.apiCb(" + JSONObject.quote(id) + "," + JSONObject.quote(body) + ")";
                runOnUiThread(new Runnable() { @Override public void run() { web.evaluateJavascript(js, null); } });
            } }).start();
        }
    }
}
