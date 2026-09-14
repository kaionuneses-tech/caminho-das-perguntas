# Caminho das Perguntas — quiz de matemática em VR (Meta Quest, WebXR)

27 questões de matemática (PAEBES / descritores) num caminho de casas. Acertou, avança; errou, volta uma casa.

## Estrutura

```
index.html      cena A-Frame (chão, caminho, painel, jogador, controles)
game.js         lógica: carrega perguntas.json, gera casas, avança/recua, tela final
perguntas.json  banco de questões (imagem + nº de alternativas + gabarito)
img/q01..q27    cada questão como PNG (enunciado + alternativas)
```

## Rodar local e testar no Quest

1. No PC, dentro da pasta: `npx serve .` (ou `python -m http.server 8080`).
2. Descubra o IP do PC na rede (`ipconfig` / `ip a`), ex. `192.168.0.15`.
3. No Quest, abra o navegador e acesse `http://192.168.0.15:3000`.
4. Clique em "Enter VR" no canto.

Aviso: WebXR só entra em modo VR de verdade em **HTTPS ou localhost**. Em `http://IP` o Quest abre a cena mas o botão VR pode não aparecer. Pra testar imersivo na rede local, o caminho mais rápido é publicar (abaixo) — ou usar `npx serve --ssl-cert`/ngrok.

## Site publicado (pra usar em qualquer Quest)

O jogo está no ar em:

**https://kaionuneses-tech.github.io/caminho-das-perguntas/**

No Quest, abra esse endereço no navegador e clique no botão de óculos (Enter VR). Não precisa instalar nada, nem conta de desenvolvedor.

Pra atualizar o site depois de mexer no código: `git add -A`, `git commit -m "mudança"`, `git push` — o GitHub Pages republica sozinho em ~1 minuto.

## Gabarito — CONFERIR antes de usar em sala

O gabarito em `perguntas.json` foi resolvido por mim, não veio do documento. Confira principalmente a questão 23 (pirâmide hexagonal: alternativas B e D são quase iguais na imagem; marquei D por ter 6 triângulos).

## Brief pro Claude Code

Este projeto é uma base funcional. O que falta, em ordem de prioridade:

1. **Legibilidade no headset.** Testar se as imagens ficam legíveis a 2,2 m. Se não: aumentar o painel, aproximar, ou permitir "puxar" o painel com o gatilho.
2. **Feedback sonoro** (acerto/erro/chegada) com `<a-sound>`.
3. **Transição de movimento** suave entre casas (`animation` do A-Frame no `#rig`) em vez de teleporte seco — cuidado com enjoo; se enjoar, manter teleporte.
4. **Tela inicial** com botão "Começar" e opção de embaralhar as questões.
5. **Timer por pergunta** (opcional) e placar final com tempo.
6. **Cenário**: algo além do chão azul — céu, colunas ao lado do caminho, iluminação. Manter leve: Quest 2 sofre acima de ~100k triângulos.
7. **Modo turma**: gravar resultado (nome + acertos) via `localStorage` ou exportar CSV.

Restrições que o Claude Code deve respeitar:
- Manter WebXR/A-Frame puro, sem build step, sem framework. Tem que abrir direto no GitHub Pages.
- Não converter as questões pra texto: várias têm gráficos e frações; a imagem é a fonte da verdade.
- `perguntas.json` é o único lugar onde se mexe em questões.
- Testar sempre com `raycaster` em `.clicavel` — botões novos precisam dessa classe.
