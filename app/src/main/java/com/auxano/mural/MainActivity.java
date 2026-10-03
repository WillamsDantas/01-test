package com.auxano.mural;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {

    private static final int REQ_FILE = 42;
    private static final String DATA_FILE = "mural-data.json";
    private static final int MAX_BYTES = 30 * 1024 * 1024;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private final Handler main = new Handler(Looper.getMainLooper());

    /** Imagens/links compartilhados por outros apps, aguardando o JS buscar. */
    private final ArrayList<String> pendingImages = new ArrayList<String>();
    private final ArrayList<String> pendingLinks = new ArrayList<String>();
    private boolean pageReady = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(0xFF141518);
        w.setNavigationBarColor(0xFF141518);
        w.getDecorView().setSystemUiVisibility(0);

        web = new WebView(this);
        web.setBackgroundColor(0xFF141518);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(true);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

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
                i.setType("image/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "Adicionar referências"), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "Android");
        collectShared(getIntent());
        web.loadUrl("file:///android_asset/index.html");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        collectShared(intent);
        if (pageReady) js("window.muralIncoming && window.muralIncoming()");
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Ao voltar para o app (ex.: depois de tirar um print), o JS confere a área de transferência.
        if (hasFocus && pageReady) js("window.muralFocus && window.muralFocus()");
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.muralBack ? window.muralBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"true".equals(value)) finish();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData cd = data.getClipData();
                if (cd != null && cd.getItemCount() > 0) {
                    result = new Uri[cd.getItemCount()];
                    for (int i = 0; i < cd.getItemCount(); i++) result[i] = cd.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void js(final String code) {
        main.post(new Runnable() {
            @Override
            public void run() {
                web.evaluateJavascript(code, null);
            }
        });
    }

    private static String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    /* ---------- Compartilhar de outros apps ---------- */

    private void collectShared(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();
        if (action == null || type == null) return;
        try {
            if (Intent.ACTION_SEND.equals(action)) {
                if (type.startsWith("image/")) {
                    Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                    addPendingUri(u);
                } else if (type.startsWith("text/")) {
                    String t = intent.getStringExtra(Intent.EXTRA_TEXT);
                    String link = firstUrl(t);
                    if (link != null) synchronized (pendingLinks) { pendingLinks.add(link); }
                }
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(action) && type.startsWith("image/")) {
                ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) for (Uri u : list) addPendingUri(u);
            }
        } catch (Exception ignored) { }
        intent.setAction(null);
    }

    private void addPendingUri(Uri u) {
        if (u == null) return;
        String d = uriToDataUrl(u);
        if (d != null) synchronized (pendingImages) { pendingImages.add(d); }
    }

    private static String firstUrl(String t) {
        if (t == null) return null;
        Matcher m = Pattern.compile("https?://\\S+").matcher(t);
        return m.find() ? m.group() : null;
    }

    /* ---------- Utilidades de arquivo ---------- */

    private byte[] readAll(InputStream in, int limit) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n, total = 0;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > limit) throw new Exception("arquivo grande demais");
            bos.write(buf, 0, n);
        }
        in.close();
        return bos.toByteArray();
    }

    private String uriToDataUrl(Uri u) {
        try {
            String mime = getContentResolver().getType(u);
            if (mime == null || !mime.startsWith("image/")) mime = "image/png";
            InputStream in = getContentResolver().openInputStream(u);
            if (in == null) return null;
            byte[] b = readAll(in, MAX_BYTES);
            return "data:" + mime + ";base64," + Base64.encodeToString(b, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    private File imgDir() {
        File d = new File(getFilesDir(), "img");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** Baixa um link. Se for página (Pinterest, Behance...), tenta a imagem principal (og:image). */
    private String fetchAsDataUrl(String link, int depth) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(link);
            c = (HttpURLConnection) url.openConnection();
            c.setInstanceFollowRedirects(true);
            c.setConnectTimeout(12000);
            c.setReadTimeout(20000);
            c.setRequestProperty("User-Agent",
                    "Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && depth < 5) {
                String loc = c.getHeaderField("Location");
                if (loc != null) return fetchAsDataUrl(new URL(url, loc).toString(), depth + 1);
            }
            if (code != 200) return null;
            String ct = c.getContentType();
            byte[] b = readAll(c.getInputStream(), MAX_BYTES);
            if (ct != null && ct.startsWith("image/")) {
                String mime = ct.split(";")[0].trim();
                return "data:" + mime + ";base64," + Base64.encodeToString(b, Base64.NO_WRAP);
            }
            if (depth < 3) {
                String html = new String(b, StandardCharsets.UTF_8);
                Matcher m = Pattern.compile(
                        "<meta[^>]+(?:property|name)=[\"'](?:og:image(?::url)?|twitter:image)[\"'][^>]*content=[\"']([^\"']+)[\"']",
                        Pattern.CASE_INSENSITIVE).matcher(html);
                String img = null;
                if (m.find()) img = m.group(1);
                if (img == null) {
                    Matcher m2 = Pattern.compile(
                            "<meta[^>]+content=[\"']([^\"']+)[\"'][^>]*(?:property|name)=[\"'](?:og:image(?::url)?|twitter:image)[\"']",
                            Pattern.CASE_INSENSITIVE).matcher(html);
                    if (m2.find()) img = m2.group(1);
                }
                if (img != null) {
                    img = img.replace("&amp;", "&");
                    return fetchAsDataUrl(new URL(url, img).toString(), depth + 1);
                }
            }
            return null;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /* ---------- Ponte com o JavaScript ---------- */

    public class Bridge {

        @JavascriptInterface
        public void ready() {
            pageReady = true;
        }

        @JavascriptInterface
        public String readData() {
            try {
                File f = new File(getFilesDir(), DATA_FILE);
                if (!f.exists()) return "";
                return new String(readAll(new FileInputStream(f), 50 * 1024 * 1024), StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean writeData(String json) {
            try {
                File tmp = new File(getFilesDir(), DATA_FILE + ".tmp");
                FileOutputStream o = new FileOutputStream(tmp);
                o.write(json.getBytes(StandardCharsets.UTF_8));
                o.getFD().sync();
                o.close();
                return tmp.renameTo(new File(getFilesDir(), DATA_FILE));
            } catch (Exception e) {
                return false;
            }
        }

        /** Endereço base onde as imagens ficam salvas (o JS monta base + id). */
        @JavascriptInterface
        public String imgBase() {
            return Uri.fromFile(imgDir()).toString() + "/";
        }

        /** Salva uma imagem (data URL) e devolve o nome do arquivo. */
        @JavascriptInterface
        public String saveImage(String name, String dataUrl) {
            try {
                int comma = dataUrl.indexOf(',');
                byte[] b = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                File f = new File(imgDir(), name);
                FileOutputStream o = new FileOutputStream(f);
                o.write(b);
                o.close();
                return name;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void deleteImage(String name) {
            try {
                if (name.contains("/") || name.contains("..")) return;
                new File(imgDir(), name).delete();
            } catch (Exception ignored) { }
        }

        /** Remove arquivos de imagem que não estão mais em nenhum quadro. keepJson = ["a.webp", ...] */
        @JavascriptInterface
        public void cleanImages(String keepJson) {
            try {
                org.json.JSONArray a = new org.json.JSONArray(keepJson);
                java.util.HashSet<String> keep = new java.util.HashSet<String>();
                for (int i = 0; i < a.length(); i++) keep.add(a.getString(i));
                File[] fs = imgDir().listFiles();
                if (fs == null) return;
                for (File f : fs) if (!keep.contains(f.getName())) f.delete();
            } catch (Exception ignored) { }
        }

        /** O que há na área de transferência: {"kind":"image|url|text|","ts":123} — sem ler o conteúdo. */
        @JavascriptInterface
        public String clipInfo() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null || !cm.hasPrimaryClip()) return "{\"kind\":\"\",\"ts\":0}";
                ClipDescription d = cm.getPrimaryClipDescription();
                long ts = (d != null && Build.VERSION.SDK_INT >= 26) ? d.getTimestamp() : 0;
                String kind = "";
                if (d != null) {
                    if (d.hasMimeType("image/*")) kind = "image";
                    else if (d.hasMimeType("text/*")) kind = "text";
                }
                return "{\"kind\":\"" + kind + "\",\"ts\":" + ts + "}";
            } catch (Exception e) {
                return "{\"kind\":\"\",\"ts\":0}";
            }
        }

        /** Lê a área de transferência: {"type":"image","data":"data:..."} ou {"type":"url","data":"https://..."} */
        @JavascriptInterface
        public String readClip() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null || !cm.hasPrimaryClip()) return "{\"type\":\"\"}";
                ClipData clip = cm.getPrimaryClip();
                if (clip == null || clip.getItemCount() == 0) return "{\"type\":\"\"}";
                ClipData.Item it = clip.getItemAt(0);
                Uri u = it.getUri();
                if (u != null) {
                    String d = uriToDataUrl(u);
                    if (d != null) return "{\"type\":\"image\",\"data\":" + q(d) + "}";
                }
                CharSequence t = it.getText();
                if (t == null) t = it.coerceToText(MainActivity.this);
                String link = firstUrl(t == null ? null : t.toString());
                if (link != null) return "{\"type\":\"url\",\"data\":" + q(link) + "}";
                return "{\"type\":\"text\"}";
            } catch (Exception e) {
                return "{\"type\":\"\"}";
            }
        }

        /** Baixa a imagem de um link em segundo plano; responde em window.muralFetched(id, dataUrl). */
        @JavascriptInterface
        public void fetchImage(final String reqId, final String link) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    String d = fetchAsDataUrl(link, 0);
                    js("window.muralFetched && window.muralFetched(" + q(reqId) + "," + q(d) + ")");
                }
            }).start();
        }

        @JavascriptInterface
        public int pendingCount() {
            synchronized (pendingImages) { return pendingImages.size(); }
        }

        @JavascriptInterface
        public String pendingImage(int i) {
            synchronized (pendingImages) {
                return (i >= 0 && i < pendingImages.size()) ? pendingImages.get(i) : "";
            }
        }

        @JavascriptInterface
        public String pendingLinks() {
            synchronized (pendingLinks) {
                org.json.JSONArray a = new org.json.JSONArray(pendingLinks);
                pendingLinks.clear();
                return a.toString();
            }
        }

        @JavascriptInterface
        public void clearPending() {
            synchronized (pendingImages) { pendingImages.clear(); }
        }

        @JavascriptInterface
        public void haptic(final String kind) {
            main.post(new Runnable() {
                @Override
                public void run() {
                    int k = HapticFeedbackConstants.CLOCK_TICK;
                    if ("long".equals(kind)) k = HapticFeedbackConstants.LONG_PRESS;
                    else if ("confirm".equals(kind)) k = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
                    else if ("reject".equals(kind)) k = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
                    web.performHapticFeedback(k);
                }
            });
        }

        @JavascriptInterface
        public void shareImage(String name) {
            try {
                Uri u = Uri.parse("content://" + ImageProvider.AUTH + "/" + name);
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("image/*");
                i.putExtra(Intent.EXTRA_STREAM, u);
                i.setClipData(ClipData.newRawUri("", u));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(i, "Compartilhar referência"));
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void setBars(final String hex) {
            main.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        int c = Color.parseColor(hex);
                        getWindow().setStatusBarColor(c);
                        getWindow().setNavigationBarColor(c);
                    } catch (Exception ignored) { }
                }
            });
        }
    }
}
