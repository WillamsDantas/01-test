# Tonalize — color grade e LUTs no Android

App Android (APK) para criar color grades, copiar o look de uma foto ou vídeo de referência, aplicar a cor e exportar:

- **LUT .cube** (33×33×33) → `Downloads/Tonalize` — para CapCut desktop, Premiere, DaVinci, Lightroom
- **Foto tratada** (JPG) → `Pictures/Tonalize`
- **Vídeo tratado** (MP4, com áudio) → `Movies/Tonalize`

## Estrutura
- `app/src/main/assets/` — interface e motor de cor (HTML/JS/WebGL)
  - `app.js` — editor manual, extração de look (Lab + casamento de histograma), geração do LUT, prévia na GPU, biblioteca, exportações
- `app/src/main/java/.../MainActivity.java` — WebView, seletor de arquivos, gravação na galeria/Downloads, biblioteca interna
- `build.sh` — compila com o Android SDK (sem Gradle)
- `.github/workflows/build-apk.yml` — compila no GitHub a cada push no branch `tonalize-app` e salva o APK em `dist/`

## Testar a interface no computador
Sirva a pasta `app/src/main/assets` (ex.: `python3 -m http.server -d app/src/main/assets`) e abra no Chrome.
