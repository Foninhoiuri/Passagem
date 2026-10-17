# Conferência de segurança — 16/10/2026

Escopo: sala privada, salas por link, transferências retomáveis, miniaturas e PWA.

- Autenticação: senha processada com scrypt; sessões aleatórias de 256 bits, oito horas de validade, cookie HttpOnly/Secure/SameSite Strict em HTTPS, revogação no logout e reinício. Sem senha no URL ou localStorage.
- Exceção autorizada: PIN curto escolhido expressamente pelo proprietário. Não equivale a uma senha forte. Compensações: cinco falhas por origem e vinte por conta em quinze minutos, persistência do bloqueio e validação de proxy confiável.
- Autorização: sala 1 protegida; criação/fechamento de salas somente pelo proprietário; CSRF e validação de origem nas mutações. Convidados recebem acesso pelo link aleatório de alta entropia; links antigos compatíveis conservam sua entropia original.
- Transporte: HTTPS público, HSTS, CSP, nosniff, bloqueio de frames, política de referência e permissões restritas. Porta do host em loopback e proxy confiável explícito.
- Entradas: validação estrita de campos, limites de corpo, nomes normalizados, IDs gerados no servidor e bloqueio de caminhos internos. Tipos permitidos e assinaturas conhecidas verificadas; isto não constitui varredura antivírus. Originais nunca executados nem servidos inline.
- Armazenamento: partes persistentes e offsets verificados; conclusão atômica e idempotente, quotas com reservas e disco livre. Exclusão remove original, metadados e thumbnail. Expiração individual em 24 horas; transferência incompleta expira em seis horas. Sem banco de dados.
- Miniaturas: raster limitado a 50 MB/40 megapixels, saída WebP sem metadados, timeout e concorrência limitados. SVG não é processado.
- Logs: eventos sem senhas, nomes de arquivos, texto, URLs de salas ou IP bruto. Encadeamento de hashes permite identificar alterações, mas não torna o arquivo imutável contra administrador do host. Proteção por permissões do volume.
- PWA: cache restrito a recursos públicos; nenhuma resposta de API, arquivo ou endereço de sala no cache do service worker. Sem promessa de uso offline dos dados.
- Runtime: usuário não privilegiado, capacidades removidas, no-new-privileges, raiz somente leitura, tmpfs e limite de memória. Dependências travadas em lockfiles.

Validação local: teste integrado do servidor, build TypeScript/Vite e navegação real em WebKit. Cobertura de login/bloqueio persistente/CSRF, papéis, retomada após reinício e recarga, offsets, quotas, Range/HEAD, expiração, exclusão e miniaturas. Auditoria npm: nenhuma vulnerabilidade alta ou crítica; duas moderadas no frontend, nenhuma no runtime da raiz.

A publicação deve ainda confirmar CI com build Docker, backup com restauração e hashes conferidos, versão pública correspondente ao commit e fluxo pelo Cloudflare. Não há alegação de auditoria externa ou certificação.
