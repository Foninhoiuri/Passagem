# Passagem

Servidor Node nativo em `server/`, Sharp para miniaturas, frontend React/Vite em `web/`. Leia README.md e docs/seguranca-2026-10-16.md antes de alterar autenticação, armazenamento ou publicação.

- Nunca versionar `.env`, PIN, credenciais, dados enviados ou backups. Segredos somente nas variáveis da stack.
- Sala 1 privada e permanente; apenas proprietário autenticado cria salas compartilhadas sem senha. Links compartilhados concedem leitura, envio e exclusão.
- Expiração é por item, não por atividade da sala. Remover sala compartilhada somente vazia e sem transferências pendentes.
- Downloads de originais sempre como attachment; previews somente miniaturas raster geradas pelo servidor.
- Não fazer push ou deploy sem pedido do usuário. Nunca force push.
- Produção usa Cloudflare Tunnel e rede Docker proxy, não Tailscale Funnel. Preservar as demais rotas do tunnel.
- Executar testes/build e preservar backup restaurável antes de publicar.
