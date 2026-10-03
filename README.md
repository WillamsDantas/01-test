# Mural

Organizador de referências visuais para Android, no espírito do PureRef: uma lousa infinita onde você solta imagens e arruma do seu jeito. Marca Auxano.

## O que faz
- Lousa infinita com arrastar e pinça para zoom, com inércia ao soltar.
- Imagens da galeria (várias de uma vez), da área de transferência (print, imagem ou link copiado) e por link (páginas como Pinterest usam a imagem principal).
- Compartilhar de qualquer app → Mural.
- Toque para selecionar, arraste para mover, pinça com a imagem selecionada (pelo menos um dedo sobre ela) para redimensionar.
- Toque duplo numa imagem aproxima nela; num espaço vazio enquadra tudo.
- Segurar num espaço vazio abre o menu de adicionar naquele ponto.
- Frente, espelhar, duplicar, enviar e excluir.
- Desfazer e refazer (botões no canto inferior esquerdo) para mover, redimensionar, excluir, espelhar, duplicar, organizar e adicionar.
- Guias inteligentes: ao mover, linhas cinza-claro mostram bordas e centros alinhados; ao redimensionar, encaixa na mesma largura, altura ou tamanho de outra referência. Cada encaixe dá uma vibração leve.
- Vários quadros, organizar em fileiras, tudo salvo no aparelho.
- Exportar (ícone no topo) o quadro como uma imagem só (fundo carvão ou branco): salva em Imagens/Mural ou envia direto.

## Técnica
- Android nativo em Java (minSdk 24), interface em HTML/JS dentro de uma WebView (`app/src/main/assets/index.html`), sem bibliotecas externas.
- Imagens grandes são reduzidas para 2400 px e salvas em `files/img/`; os dados ficam em `files/mural-data.json`.
- Compilação sem Gradle (`build.sh`) via GitHub Actions; o APK vai para `dist/`.
- Chave de assinatura: `keystore/mural.jks` (alias `mural`, senha `mural123`). Guarde: as próximas versões precisam dela para instalar por cima.
- Sem lambdas no Java (o build não faz desugaring).
