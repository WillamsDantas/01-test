#!/usr/bin/env bash
# Compila o APK do Quita Acessos (app do administrador) usando só o Android SDK.
set -euo pipefail
cd "$(dirname "$0")/.."
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "Defina ANDROID_HOME"; exit 1; }
BT=$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)
PLAT="$SDK/platforms/android-34"
[ -d "$PLAT" ] || PLAT=$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)
JAR="$PLAT/android.jar"
APP=acessos/src/main
OUT=build-acessos
VERSION=1.0.1
CODE=2
rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" "$OUT/assets/fonts" dist
cp "$APP/assets/index.html" "$OUT/assets/"
cp app/src/main/assets/fonts/Inter-Regular.woff2 app/src/main/assets/fonts/Inter-Medium.woff2 app/src/main/assets/fonts/Inter-SemiBold.woff2 app/src/main/assets/fonts/InterDisplay-SemiBold.woff2 "$OUT/assets/fonts/"

"$BT/aapt2" compile --dir "$APP/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" \
  --manifest "$APP/AndroidManifest.xml" -A "$OUT/assets" \
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
  --out dist/QuitaAcessos-v$VERSION.apk "$OUT/aligned.apk"
"$BT/apksigner" verify dist/QuitaAcessos-v$VERSION.apk && echo "QuitaAcessos OK"
