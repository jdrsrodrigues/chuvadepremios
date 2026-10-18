# Mondilene Catch

Jogo "catch" em HTML5 para tablet (Android e Windows). A Mondilene anda na horizontal empurrando o carrinho e precisa pegar os produtos Mondial que caem, em frente à loja Fujioka.

## Como jogar

- **Toque/arraste** na tela (ou **mouse**): o carrinho segue o dedo.
- **Teclado**: `←` `→` ou `A` `D`. `P`/`Esc` pausa, `Enter` inicia.
- Produtos: cortador (+10), escova rotativa (+15), secador (+10), secador Juliette (+20).
- A cada 5 acertos seguidos, os produtos valem um bônus.
- Bombas caem aleatoriamente junto com os produtos: pegar uma tira **25 pontos** (o placar não fica negativo) e zera a sequência.
- Deixar um produto cair custa 1 das 3 vidas.
- A cada 10 produtos sobe de nível: tudo cai mais rápido e aumenta a chance de bomba (15% no nível 1, até 30%).

## Rodar

**Windows:** abra `index.html` no Edge ou no Chrome. Use o botão de tela cheia no canto superior direito.

**Android:** publique a pasta em qualquer hospedagem HTTPS (GitHub Pages, Netlify, etc.), abra no Chrome do tablet e use **Instalar app** / **Adicionar à tela inicial**. O jogo abre em tela cheia, na horizontal, e funciona offline (service worker em `sw.js`).

Para gerar um APK de verdade (Play Store), dá para empacotar a mesma pasta com Capacitor ou com um TWA (Bubblewrap).

## Imagens

As imagens de `imagens/` ficam embutidas em `assets.js`. Assim o jogo funciona até abrindo o arquivo direto (`file://`), onde o navegador bloquearia o recorte de fundo. **Se trocar alguma imagem, rode:**

```powershell
pwsh ./build-assets.ps1
```

O fundo do sprite da Mondilene e o fundo branco dos produtos e da bomba são removidos automaticamente quando o jogo carrega. Se trocar o sprite `Mondilene-walk.png` por outro com enquadramento diferente, ajuste `WALK_CROP_BOTTOM` e `BASKET` (área do carrinho onde os produtos entram) no início de `game.js`.

## Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | Página, telas (início com `tela_inicial.jpg`, pausa, fim) e estilos |
| `game.js` | Lógica, desenho, controles e sons |
| `assets.js` | Imagens embutidas (gerado) |
| `build-assets.ps1` | Gera `assets.js` e `icon.svg` |
| `manifest.webmanifest`, `sw.js`, `icon.svg` | Instalação como app (PWA) |
