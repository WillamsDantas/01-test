# Videira — mapas mentais (v1.0.0)

App Android (celular e tablet) para organizar ideias em mapa mental: esboço de pregação, estudo bíblico, aula de EBD e validação de ofertas.

- **Três layouts**: Radial (ramos em volta da ideia central), Árvore (em ordem, para a direita) e Livre (você arrasta cada tópico). Troque a qualquer momento.
- **Tópicos**: toque para selecionar, toque de novo para editar. Barra inferior: Filho, Irmão, Editar, Nota, Estilo, Mais, Excluir. Arraste um tópico e solte sobre outro para mudá-lo de lugar.
- **Nota dentro do tópico**: para versículos, explicações e ideias mais longas (indicador no canto do tópico).
- **Estilo**: a cor segue o ramo (subtópicos herdam), com cor própria opcional por tópico; ícones/emoji; negrito.
- **Recolher/expandir ramos** (contador de subtópicos no ramo recolhido).
- **Vários mapas** na biblioteca, com busca por título e conteúdo, duplicar e excluir. Modelos prontos: Em branco, Pregação, Estudo bíblico, Aula de EBD, Validar oferta.
- **Esboço**: o mapa como lista numerada (I., 1., a)) com as notas e letra ajustável; compartilhar como texto.
- **Desfazer/refazer**, zoom com pinça, tema claro/escuro/automático, backup em JSON (Downloads/Videira) e restauração.
- Teclado físico: Tab = filho, Enter = irmão, F2/Espaço = editar, Delete = excluir, Ctrl+Z / Ctrl+Y.

Fica para a v2: exportar como imagem/PDF.

Estrutura:
- `app/src/main/assets/index.html` — interface e lógica (HTML/JS/SVG)
- `app/src/main/java/com/auxano/videira/MainActivity.java` — WebView + ponte nativa (salvar, backup, compartilhar, tema)
- `build.sh` — compila o APK só com o Android SDK (`ANDROID_HOME` definido)
- `.github/workflows/build-videira.yml` — compila no GitHub Actions a cada push neste branch
- `keystore/videira.jks` — chave de assinatura (senha videira123). Use sempre a mesma para atualizar o app sem desinstalar.
