# Caça-Prismas · servidor multiplayer

Servidor em Node.js puro (sem nenhuma dependência). Ele entrega o jogo e repassa
posição, aparência, habilidades, domínios e chat entre os jogadores.
Cada jogador roda o próprio jogo no próprio aparelho: sem atraso de comando.

## Colocar no Render (plano grátis)

1. Crie um repositório no GitHub e envie **estes 5 arquivos na raiz do repositório**:
   `server.js`, `package.json`, `render.yaml`, `caca-prismas.html` e este `README.md`.
   (Se preferir deixar dentro de uma pasta, no Render preencha **Root Directory** com o nome da pasta.)
2. No Render: **New → Web Service** → escolha o repositório.
3. Preencha:
   - **Runtime:** Node
   - **Build Command:** `echo "sem dependencias"`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free
4. Clique em **Create Web Service** e espere aparecer "Live".
5. Abra o endereço que o Render der (algo como `https://caca-prismas.onrender.com`).
   Todo mundo joga por esse endereço e toca em **Online → Entrar no mundo aberto**,
   ou cria uma sala privada e passa o código de 5 letras.

## Bom saber

- No plano grátis o servidor dorme depois de 15 minutos sem ninguém; o primeiro acesso
  leva cerca de 1 minuto para acordar.
- O save fica no navegador de cada endereço. Para levar o progresso da página do Claude
  para o Render: Ajustes → **Copiar código** lá, e Ajustes → **Carregar save** aqui.
- Para atualizar o jogo, troque o `caca-prismas.html` no repositório; o Render publica sozinho.
- Testar no seu computador: `node server.js` e abra `http://localhost:8790`.
