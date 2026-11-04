# Verificação manual: o painel de trajetória numa sessão real do Claude Code

[English](trajectory-pane.md) | Português (Brasil) | [Español](trajectory-pane.es.md)

`claude plugin test` desenha o painel de trajetória (`/fm trajectory`) como Raster no terminal e como Svg de 900 pixels de largura no Desktop e no VS Code, nos temas claro e escuro (`test/mod/trajectory.test.ts`, `test/trajectory-view.test.ts`). Ele não reproduz como cada host dimensiona, aplica tema e colore o que desenha. Este checklist cobre essa parte. Uma pessoa o executa à mão, numa sessão real, com o plugin instalado pelo canal `next`. Nenhuma verificação abaixo foi executada ainda: toda linha de [Resultados](#resultados) começa como `not run`.

## Antes de começar

1. Instale o plugin pelo marketplace `next` no Claude Code:

   ```
   /plugin marketplace add gabrielvieiraf/finitemonkey#next
   /plugin install finitemonkey@finitemonkey-next
   ```

   Ative só este plugin chamado `fm`, não o estável junto.

2. Num clone deste repositório, crie um projeto descartável com uma trajetória conhecida:

   ```
   npm ci
   npm run manual:trajectory -- --dir ../fm-trajectory-check
   cd ../fm-trajectory-check && git init -q
   ```

   O script recusa uma pasta que já tem `.fm/`, então nunca mexe num registro real. Ele grava três arquivos, com datas relativas a hoje:
   - `.fm/policy.yml` liga o recurso `trajectory` (`guards: trajectory: active`), para a faixa mostrar o segmento de trajetória.
   - `.fm/conceitos-events.jsonl` tem 13 eventos. O domínio `backend` tem evidência suficiente para desenhar: semanas sem evidência (hachuradas), um ricochete em `webhook` na semana passada (✕) e uma marca de "segurou" em `idempotency` nesta semana (◉). `infrastructure` tem um evento com peso, então aparece como "no data".
   - `.fm/log.jsonl` tem cinco ajudas de horizonte em `backend`, algumas sem critério, para a faixa cega ser desenhada e a faixa também mostrar o segmento da faixa cega ao lado da trajetória.

   `test/manual-trajectory.test.ts` mantém esse fixture honesto: ele falha se o seed deixar de produzir as duas marcas em semanas diferentes, as semanas hachuradas, a linha "no data" ou os segmentos da faixa.

3. Antes de cada superfície, anote:
   - a versão do Claude Code (`claude --version`, ou o item Sobre no Desktop e na extensão do VS Code);
   - a versão do plugin Finite Monkey (mostrada por `/plugin`);
   - o sistema operacional e a versão dele;
   - a superfície (Desktop, VS Code, terminal e o nome do app de terminal).

4. Abra uma sessão do Claude Code em `../fm-trajectory-check` nessa superfície e rode `/fm trajectory`. Salve uma captura de tela por linha em `docs/manual-checks/screenshots/trajectory-pane/`, com o nome `<versao-do-claude-code>-<superficie>-<tema>-<verificacao>.png`.

Nunca cole um segredo, um token ou um caminho privado numa captura de tela ou numa linha de resultado.

## Verificações

Cada verificação tem um ID usado na tabela de resultados. Uma verificação só passa se todos os itens valerem.

### Desktop

- **D1 claro** e **D2 escuro**: ponha o tema do Claude Code em claro, depois em escuro, e rode `/fm trajectory` a cada vez.
  - O gráfico ocupa a largura do painel. Nada é cortado à direita ou embaixo, e o painel não mostra barra de rolagem horizontal nem vertical para o gráfico.
  - Estreite e alargue a janela: o gráfico acompanha o painel e mantém as proporções (o texto não fica esticado).
  - O fundo e as faixas seguem o tema escolhido.

### VS Code

- **V1 claro** e **V2 escuro**: os mesmos itens de D1 e D2, no painel do Claude Code no VS Code, com o tema de cores do VS Code em um tema claro e depois em um escuro.

### Tema automático

- **A1 Desktop** e **A2 VS Code**: ponha o tema do Claude Code num valor que não comece com `light` nem `dark` (como automático, se a versão oferecer). O Finite Monkey então desenha o Svg com a regra `prefers-color-scheme: dark`.
  - Com o sistema em modo claro, o gráfico usa a paleta clara.
  - Mude o sistema para o modo escuro sem fechar o painel e rode `/fm trajectory` de novo: o gráfico usa a paleta escura.
  - Anote se a paleta mudou sem rodar o comando de novo.

### Dicas ao passar o mouse

- **T1 Desktop** e **T2 VS Code**: o Svg é desenhado com `isInteractive` ligado.
  - Passar o mouse sobre o ✕ da semana passada mostra uma dica que começa com `ricochet · webhook ·` e lista a evidência.
  - Passar o mouse sobre o ◉ desta semana mostra uma dica que começa com `held · idempotency ·`.
  - Passar o mouse sobre uma semana hachurada mostra `<semana>: no evidence`.

### Terminal

Rode estas num app de terminal, com o Claude Code nesse terminal.

- **R1 truecolor, fundo escuro**: um terminal com `COLORTERM=truecolor`, tema do Claude Code escuro.
- **R2 256 cores, fundo escuro**: o mesmo terminal sem `COLORTERM` e com `TERM=xterm-256color`, ou um terminal que só tem 256 cores.
- **R3 truecolor, fundo claro** e **R4 256 cores, fundo claro**: um perfil de terminal claro, tema do Claude Code claro.

Em cada uma:
- As faixas no Raster do painel têm as mesmas cores, na mesma ordem, da paleta das faixas. A referência é o gráfico que `npx finitemonkey@next trajectory --domain backend` imprime no mesmo terminal a partir da pasta criada, que nomeia cada faixa ao lado da cor. Em fundo claro, rode como `COLORFGBG='0;15' npx finitemonkey@next trajectory --domain backend` para o comando escolher a paleta clara.
- As marcas ✕ e ◉ e os rótulos ficam legíveis sobre todas as faixas e sobre o fundo do terminal.
- Em fundo claro, nenhum texto ou marca some no fundo.

### Faixa

- **B1 80 colunas** e **B2 120 colunas**: redimensione o terminal para exatamente 80 e depois 120 colunas (`tput cols` mostra a largura) e envie um prompt para a faixa atualizar.
  - A linha da faixa que começa com `FM` mostra o segmento de trajetória (domínio `backend`, a faixa desta semana e o ricochete em `webhook`) ao lado do segmento da faixa cega e dos outros segmentos.
  - Nenhum segmento é cortado no meio de uma palavra, e a faixa não quebra para uma segunda linha.
  - Anote quais segmentos apareceram e quais, se algum, sumiram.

## Quando uma verificação falha

Abra uma issue por verificação que falhou, com o ID da verificação, a versão do Claude Code, o sistema operacional, a superfície e a captura de tela. Ponha o número da issue na linha do resultado. Nenhuma mudança de código, a menos que uma verificação falhe.

## Resultados

Os resultados ficam só no arquivo em inglês, [trajectory-pane.md](trajectory-pane.md#results), para haver um registro único: uma linha por verificação e execução, com data, versão do Claude Code, versão do plugin, sistema operacional, superfície, tema, ID, resultado (`pass`, `fail` ou `not run`), captura de tela e issue. As linhas antigas ficam, porque o resultado pode mudar entre versões do Claude Code. As traduções trazem os mesmos passos.
