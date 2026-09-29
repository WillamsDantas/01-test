package com.auxano.tonalize;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/index.html";
    private static final int REQ_FILE = 42;
    private static final int REQ_STORAGE = 43;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String lastError = "";

    /** Arquivos sendo gravados em partes (vídeo, foto, .cube). */
    private static class Out {
        OutputStream os;
        Uri uri;
        File file;
        String where;
    }
    private final Map<String, Out> outs = new HashMap<>();
    private int seq = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setStatusBarColor(0xFF16181D);
        w.setNavigationBarColor(0xFF16181D);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0E0F12);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || !path.startsWith("/assets/")) return null;
                String name = path.substring("/assets/".length());
                try {
                    InputStream in = getAssets().open(name);
                    WebResourceResponse r = new WebResourceResponse(mime(name), "UTF-8", in);
                    Map<String, String> h = new HashMap<>();
                    h.put("Cache-Control", "no-cache");
                    r.setResponseHeaders(h);
                    return r;
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                List<String> mimes = new ArrayList<>();
                boolean any = false;
                String[] acc = params.getAcceptTypes();
                if (acc != null) for (String a : acc) {
                    if (a == null) continue;
                    for (String t : a.split(",")) {
                        t = t.trim().toLowerCase();
                        if (t.isEmpty()) continue;
                        if (t.contains("/")) mimes.add(t); else any = true;
                    }
                }
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                if (any || mimes.isEmpty()) {
                    i.setType("*/*");
                } else if (mimes.size() == 1) {
                    i.setType(mimes.get(0));
                } else {
                    i.setType("*/*");
                    i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
                }
                try {
                    startActivityForResult(Intent.createChooser(i, "Escolher arquivo"), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl(START);

        if (Build.VERSION.SDK_INT < 29 &&
                checkSelfPermission("android.permission.WRITE_EXTERNAL_STORAGE") != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.WRITE_EXTERNAL_STORAGE"}, REQ_STORAGE);
        }
    }

    private static String mime(String name) {
        String n = name.toLowerCase();
        if (n.endsWith(".html")) return "text/html";
        if (n.endsWith(".js")) return "application/javascript";
        if (n.endsWith(".css")) return "text/css";
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".svg")) return "image/svg+xml";
        if (n.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.appBack ? window.appBack() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!"true".equals(value)) superBack();
            }
        });
    }

    private void superBack() {
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (web != null) web.evaluateJavascript("window.appPause && window.appPause()", null);
        super.onPause();
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }

    private static void writeAtomic(File f, String text) throws Exception {
        File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
        FileOutputStream fo = new FileOutputStream(tmp);
        fo.write(text.getBytes(StandardCharsets.UTF_8));
        fo.getFD().sync();
        fo.close();
        if (!tmp.renameTo(f)) {
            FileOutputStream fo2 = new FileOutputStream(f);
            fo2.write(text.getBytes(StandardCharsets.UTF_8));
            fo2.close();
            tmp.delete();
        }
    }

    private File lutDir() {
        File d = new File(getFilesDir(), "luts");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static boolean safeId(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,64}");
    }

    private static File unique(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 2; i < 1000; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    public class Bridge {

        @JavascriptInterface
        public String lastError() {
            return lastError;
        }

        @JavascriptInterface
        public int sdk() {
            return Build.VERSION.SDK_INT;
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        /* ---------- biblioteca de LUTs (armazenamento interno) ---------- */

        @JavascriptInterface
        public String lutList() {
            JSONArray arr = new JSONArray();
            try {
                File[] files = lutDir().listFiles();
                if (files == null) return "[]";
                List<JSONObject> metas = new ArrayList<>();
                for (File f : files) {
                    if (!f.getName().endsWith(".meta.json")) continue;
                    try { metas.add(new JSONObject(readAll(new FileInputStream(f)))); } catch (Exception ignored) { }
                }
                Collections.sort(metas, new Comparator<JSONObject>() {
                    @Override
                    public int compare(JSONObject a, JSONObject b) {
                        return Long.compare(b.optLong("date"), a.optLong("date"));
                    }
                });
                for (JSONObject m : metas) arr.put(m);
            } catch (Exception e) {
                lastError = e.toString();
            }
            return arr.toString();
        }

        @JavascriptInterface
        public boolean lutSave(String id, String meta, String data) {
            try {
                if (!safeId(id)) throw new Exception("id inválido");
                writeAtomic(new File(lutDir(), id + ".json"), data);
                writeAtomic(new File(lutDir(), id + ".meta.json"), meta);
                return true;
            } catch (Exception e) {
                lastError = e.toString();
                return false;
            }
        }

        @JavascriptInterface
        public String lutLoad(String id) {
            try {
                if (!safeId(id)) return "";
                File f = new File(lutDir(), id + ".json");
                if (!f.exists()) return "";
                return readAll(new FileInputStream(f));
            } catch (Exception e) {
                lastError = e.toString();
                return "";
            }
        }

        @JavascriptInterface
        public boolean lutDelete(String id) {
            if (!safeId(id)) return false;
            boolean a = new File(lutDir(), id + ".json").delete();
            boolean b = new File(lutDir(), id + ".meta.json").delete();
            return a || b;
        }

        /* ---------- arquivos exportados (galeria / Downloads) ---------- */

        @JavascriptInterface
        public String fileBegin(String name, String mime, String kind) {
            try {
                name = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                String dir;
                Uri coll;
                if ("image".equals(kind)) {
                    dir = Environment.DIRECTORY_PICTURES;
                    coll = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                } else if ("video".equals(kind)) {
                    dir = Environment.DIRECTORY_MOVIES;
                    coll = MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
                } else {
                    dir = Environment.DIRECTORY_DOWNLOADS;
                    coll = null;
                }
                Out o = new Out();
                if (Build.VERSION.SDK_INT >= 29) {
                    if (coll == null) coll = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    cv.put(MediaStore.MediaColumns.RELATIVE_PATH, dir + "/Tonalize");
                    cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    ContentResolver cr = getContentResolver();
                    o.uri = cr.insert(coll, cv);
                    if (o.uri == null) throw new Exception("não foi possível criar o arquivo");
                    o.os = cr.openOutputStream(o.uri);
                    o.where = dir + "/Tonalize/" + name;
                } else {
                    File d = new File(Environment.getExternalStoragePublicDirectory(dir), "Tonalize");
                    if (!d.exists() && !d.mkdirs()) throw new Exception("sem permissão para salvar (libere o armazenamento)");
                    o.file = unique(d, name);
                    o.os = new FileOutputStream(o.file);
                    o.where = dir + "/Tonalize/" + o.file.getName();
                }
                if (o.os == null) throw new Exception("não foi possível abrir o arquivo");
                String tok;
                synchronized (outs) {
                    tok = "f" + (++seq);
                    outs.put(tok, o);
                }
                return tok;
            } catch (Exception e) {
                lastError = e.getMessage() != null ? e.getMessage() : e.toString();
                return "";
            }
        }

        @JavascriptInterface
        public boolean fileAppend(String tok, String b64) {
            Out o;
            synchronized (outs) { o = outs.get(tok); }
            if (o == null) { lastError = "arquivo não está aberto"; return false; }
            try {
                o.os.write(Base64.decode(b64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                lastError = e.toString();
                return false;
            }
        }

        @JavascriptInterface
        public String fileEnd(String tok) {
            Out o;
            synchronized (outs) { o = outs.remove(tok); }
            if (o == null) { lastError = "arquivo não está aberto"; return ""; }
            try {
                o.os.flush();
                o.os.close();
                if (o.uri != null) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(o.uri, cv, null, null);
                } else if (o.file != null) {
                    MediaScannerConnection.scanFile(MainActivity.this, new String[]{o.file.getAbsolutePath()}, null, null);
                }
                return o.where;
            } catch (Exception e) {
                lastError = e.toString();
                return "";
            }
        }

        @JavascriptInterface
        public void fileAbort(String tok) {
            Out o;
            synchronized (outs) { o = outs.remove(tok); }
            if (o == null) return;
            try { o.os.close(); } catch (Exception ignored) { }
            try {
                if (o.uri != null) getContentResolver().delete(o.uri, null, null);
                if (o.file != null) o.file.delete();
            } catch (Exception ignored) { }
        }
    }
}
