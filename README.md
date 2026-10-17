# Passagem

Transferência de textos, Markdown, código, comandos e arquivos entre aparelhos: https://sync.iia.api.br.

A sala `/1` é privada e permanente. Entre com a senha para acessar seus itens e criar salas compartilhadas. Os convidados entram pelo link, sem senha, e podem enviar e apagar itens dessa sala. O link concede acesso: compartilhe apenas com as pessoas desejadas.

Cada item expira 24 horas após o envio, mesmo se outros itens forem adicionados. Uma sala compartilhada é removida quando fica sem itens e sem transferências pendentes. Salas novas vazias têm uma tolerância de 24 horas. A sala privada permanece vazia.

## Transferências e instalação

Até 5 GiB por arquivo, 8 GiB por sala e 12 GiB no total, com reserva de 2 GiB livres no disco. Envios usam partes de 8 MiB e não carregam o arquivo inteiro na memória do servidor. Após uma interrupção ou recarga, selecione novamente o mesmo arquivo para retomar; transferências pendentes expiram em seis horas. Downloads aceitam Range. Fotos compatíveis recebem miniaturas WebP; os originais são baixados como anexos.

O PWA pode ser instalado pelo navegador. Seu cache contém apenas recursos públicos de instalação e a página sem conexão; arquivos, textos e respostas das salas exigem conexão e não são armazenados pelo service worker.

## Executar

Requer Node 24. Instale as dependências na raiz e em `web` com `npm ci`. Configure as variáveis de `.env.example` sem versionar segredos. Em desenvolvimento, use `PUBLIC_ORIGIN=http://localhost:5173`, uma senha de teste e `node server/index.js`; em `web`, execute `npm run dev`. Produção exige `PUBLIC_ORIGIN` HTTPS e a rede confiável do proxy.

Validação: `npm test`, `npm --prefix web run build` e `docker build -t passagem .`. O runtime usa Sharp/libvips para miniaturas raster e heif-thumbnailer/libheif para HEIC/HEIF de iPhone. O decoder HEIC roda em processo separado, sem shell, com timeout e limites de 384 MiB de memória virtual e dez segundos de CPU via prlimit, com saída PNG reduzida convertida para WebP. Desenvolvimento macOS usa o decoder nativo. Execute também `node server/thumbnail.test.js`; o CI repete esse teste dentro da imagem Linux.

## Publicação

Docker Compose no Portainer, volume persistente `passagem-data`, usuário sem privilégios, sistema de arquivos somente leitura, limite de memória de 512 MiB. A rede externa `proxy` precisa existir. O Cloudflare Tunnel encaminha para `http://passagem:3000`; a porta 8090 fica restrita ao loopback do host. Configure `TRUST_PROXY_CIDRS` com a rede real do tunnel. Nunca exponha diretamente uma interface que aceite cabeçalhos de proxy confiável.

`APP_VERSION` é o SHA aprovado no build e fica disponível em `/version`. Preserve o volume e faça backup com teste de restauração antes de atualizar. As sessões são revogadas ao reiniciar.

A API usa `/api/session`, `/api/login`, `/api/logout`, `/api/rooms` e `/api/{sala}`. As operações privadas exigem cookie de sessão e CSRF; salas compartilhadas usam códigos aleatórios. Não coloque senha no URL ou no armazenamento do navegador. Veja [a conferência de segurança](docs/seguranca-2026-10-16.md) e [a marca](brand/README.md).
