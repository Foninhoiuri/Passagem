# Passagem

Área de transferência de mão dupla por link (texto, arquivos, fotos) para PCs de terceiros. Servidor Node sem
dependências (`server/index.js`) + front React/Vite com Untitled UI (`web/`). Publicada via Tailscale Funnel.

## Regras de segurança (Igor)

1. Nunca versionar `.env`, PIN, chaves ou arquivos enviados (`data/`). Segredos só nas variáveis da Stack no Portainer.
2. `ADMIN_PIN` é lido do ambiente; sem ele o servidor não sobe. Documentado em `.env.example` sem valor.
3. Não fazer `git push` sem Igor pedir. Nunca `--force` nem `git add -f`.
4. Autenticação de Git/GitHub é feita por Igor (`gh auth login`).

## Sensível neste projeto

- O Funnel é público: a única barreira de uma sala é o código de 8 caracteres no link e o PIN para criar salas.
- Salas expiram por inatividade (`ROOM_TTL_HOURS`); uploads limitados por `MAX_FILE_MB` e `MAX_ROOM_MB`.
- Conteúdo enviado por terceiros é baixado sempre como `attachment` (nunca renderizado no domínio).

## Comandos

- Teste do servidor: `node server/smoke.test.js`
- Dev: `ADMIN_PIN=x node server/index.js` e, em `web/`, `npm run dev` (proxy para :3000)
- Build: `docker build -t passagem .`
