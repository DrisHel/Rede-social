# Rede-social

## Decisões técnicas

Curtidas e comentários ficam em módulos próprios (`likes/` e `comments/`) com `PrismaClient` injetado, mantendo alta coesão e evitando concentrar regras de interação no `PostController`. As relações compartilhadas são acessadas pelo Prisma, sem dependência de estado interno de outro controller.

A migration cria `PostImage`, copia para ela cada `Post.imageUrl` existente e só então remove a coluna antiga. Em produção, a migração incremental com cópia de dados é necessária; reiniciar o banco só é aceitável em desenvolvimento descartável.

As ações de curtir e comentar usam `fetch` para atualizar a interface sem navegação. O cliente representa carregamento e erro, desativa o botão durante a requisição e reverte a curtida otimista em caso de falha.

Os eventos são delegados a `document`, portanto também atendem os cards e comentários inseridos depois via scroll infinito. O endpoint do feed usa cursor por id e limite de página.
