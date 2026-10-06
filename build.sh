#!/usr/bin/env bash
# Compila o APK do Quita usando só o Android SDK (sem Gradle).
set -euo pipefail
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "Defina ANDROID_HOME"; exit 1; }
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
PLAT="$SDK/platforms/android-34"
[ -d "$PLAT" ] || PLAT=$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)
JAR="$PLAT/android.jar"
echo "build-tools: $BT"; echo "platform: $PLAT"
APP=app/src/main
VERSION=2.0.4
CODE=38
OUT=build
rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" dist

"$BT/aapt2" compile --dir "$APP/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" \
  --manifest "$APP/AndroidManifest.xml" -A "$APP/assets" \
  --java "$OUT/gen" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code $CODE --version-name $VERSION "$OUT/res.zip"

javac -encoding UTF-8 -source 1.8 -target 1.8 -nowarn -Xlint:-options \
  -bootclasspath "$JAR" -d "$OUT/classes" \
  $(find "$APP/java" "$OUT/gen" -name '*.java')

"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -qj ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
if [ -z "${QUITA_KS_PASS:-}" ]; then echo "ERRO: segredo QUITA_KS_PASS não configurado no GitHub"; exit 1; fi
"$BT/apksigner" sign --ks keystore/quita-release.p12 --ks-type PKCS12 --ks-key-alias quita \
  --ks-pass env:QUITA_KS_PASS --key-pass env:QUITA_KS_PASS \
  --out dist/Quita-v$VERSION.apk "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs dist/Quita-v$VERSION.apk | head -3
ls -la dist
# aviso de nova versão: o app lê este arquivo para saber se há atualização
python3 - "$VERSION" "$CODE" <<'PY'
import json,sys
v,c=sys.argv[1],int(sys.argv[2])
try: nov=[l.strip() for l in open('novidades.txt',encoding='utf-8') if l.strip() and not l.startswith('#')]
except Exception: nov=[]
json.dump({"versao":v,"codigo":c,"apk":"https://github.com/WillamsDantas/01-test/raw/quita-app/dist/Quita-v%s.apk"%v,"novidades":nov},open('dist/latest.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
PY
cat dist/latest.json
