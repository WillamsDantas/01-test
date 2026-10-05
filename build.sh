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
OUT=build
rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex" dist

"$BT/aapt2" compile --dir "$APP/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" \
  --manifest "$APP/AndroidManifest.xml" -A "$APP/assets" \
  --java "$OUT/gen" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 15 --version-name 1.6.4 "$OUT/res.zip"

javac -encoding UTF-8 -source 1.8 -target 1.8 -nowarn -Xlint:-options \
  -bootclasspath "$JAR" -d "$OUT/classes" \
  $(find "$APP/java" "$OUT/gen" -name '*.java')

"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -qj ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks keystore/quita.jks --ks-key-alias quita \
  --ks-pass pass:quita123 --key-pass pass:quita123 \
  --out dist/Quita-v1.6.4.apk "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs dist/Quita-v1.6.4.apk | head -3
ls -la dist
