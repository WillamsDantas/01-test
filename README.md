# Quita — controle e quitação de dívidas (v1)

App Android para cadastrar receitas recorrentes, despesas fixas e avulsas, dívidas por parcelas (valor × quantidade), marcar cada conta como paga, alertas de vencimento, relatório em PDF e receitas,
ver o painel de comprometimento da renda, gerar relatório e espelhar tudo numa planilha do Google.

- `app/` — código do app (Java nativo + interface HTML/JS em `app/src/main/assets/index.html`)
- `planilha/Codigo.gs` — script para colar no Google Apps Script da planilha
- `build.sh` — compila o APK só com o Android SDK (`ANDROID_HOME` definido)
- `.github/workflows/build-apk.yml` — compila no GitHub Actions a cada push
- `dist/` — APK pronto

Obs.: `keystore/quita.jks` é a chave de assinatura (senha quita123). Mantenha-a para que as
próximas versões instalem por cima da atual sem apagar os dados.
