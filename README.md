# Kerygma — organizador de sermões (v1.0.0)

App Android (pensado para tablet) para montar o esboço do sermão por seções e pregar com ele.

- **Biblioteca**: busca por título, texto-base, série e conteúdo; filtro por série.
- **Editor**: modelo pronto (Introdução, Leitura do texto, Contexto imediato, Contexto remoto, Proposição, Pontos, Aplicação, Conclusão) — renomeie, reordene, adicione ou exclua seções. O modelo padrão é editável em Ajustes.
- **Formatação**: `- tópico`, `    - subtópico`, `1. lista`, `> versículo`, `## subtítulo`, `**negrito**`, `==destaque==`. Referências bíblicas (Rm 8.28, Jo 3:16, Salmo 23…) são destacadas automaticamente.
- **Modo púlpito**: tela sempre acesa, letra ajustável, navegação por tópicos (deslizar, setas, chips no topo, teclado/pedal Bluetooth), uma seção por tela ou rolagem contínua.
- **PDF** do esboço, **compartilhar como texto**, **backup** em JSON (Downloads/Kerygma) e importação.
- **Tema** claro, escuro ou automático.

Estrutura:
- `app/src/main/assets/index.html` — interface e lógica (HTML/JS)
- `app/src/main/java/com/auxano/kerygma/MainActivity.java` — WebView + ponte nativa (salvar, PDF, tela acesa, barras do sistema)
- `build.sh` — compila o APK só com o Android SDK (`ANDROID_HOME` definido)
- `.github/workflows/build-kerygma.yml` — compila no GitHub Actions a cada push
- `keystore/kerygma.jks` — chave de assinatura (senha kerygma123). Use sempre a mesma para conseguir atualizar o app sem desinstalar.
