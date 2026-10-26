## O que muda

O `secrets scan` passa a ler o baseline antes de varrer o histórico. Antes, um achado já aceito voltava como novo em cada execução com `--history`, e o comando saía com código 1 num repositório limpo.

## Como testei

Rodei `npm run check` e o caso novo em `test/secrets-commands.test.ts`, que planta um token falso num commit antigo, aceita o achado e confere que a segunda varredura sai com 0.

## O que não foi verificado

Repositórios com mais de 50 mil commits. O tempo da varredura nesse caso fica para a bancada.
