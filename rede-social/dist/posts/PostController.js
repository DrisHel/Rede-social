import { PostNotFoundError, TagNotFoundError, UserNotFoundError, ValidationError } from '../shared/errors.js';
export class PostController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    // `authorId` vem da SESSÃO (ver src/webRoutes.ts), nunca do corpo da
    // requisição: é a autorização "você só pode postar como você mesmo" em
    // código — antes da Aula 05 (sem login), qualquer chamador podia mandar
    // qualquer `authorId` no body.
    //
    // 1:N (author) + N:N (tags) na mesma escrita: `connect` liga o post a um
    // autor existente, `connectOrCreate` reaproveita tags já cadastradas ou
    // cria as que ainda não existem — tudo em uma única operação do Prisma.
    async create(authorId, body, imageUrls = []) {
        const { content, tags } = (body ?? {});
        if (typeof content !== 'string' || content.trim().length === 0) {
            throw new ValidationError('"content" é obrigatório');
        }
        if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string'))) {
            throw new ValidationError('"tags", quando informado, deve ser uma lista de strings');
        }
        const author = await this.prisma.user.findUnique({ where: { id: authorId } });
        if (!author) {
            throw new UserNotFoundError(authorId);
        }
        const tagNames = tags ?? [];
        return this.prisma.post.create({
            data: {
                content,
                author: { connect: { id: authorId } },
                images: {
                    create: imageUrls.map((url, order) => ({ url, order })),
                },
                tags: {
                    connectOrCreate: tagNames.map((name) => ({
                        where: { name },
                        create: { name },
                    })),
                },
            },
            include: { author: true, tags: true, images: { orderBy: { order: 'asc' } } },
        });
    }
    async get(id, userId) {
        const post = await this.prisma.post.findUnique({
            where: { id },
            include: {
                author: true,
                tags: true,
                images: { orderBy: { order: 'asc' } },
                likes: userId === undefined ? false : { where: { userId }, select: { userId: true } },
                _count: { select: { likes: true, comments: true } },
            },
        });
        if (!post) {
            throw new PostNotFoundError(id);
        }
        return {
            ...post,
            likedByMe: Array.isArray(post.likes) && post.likes.length > 0,
        };
    }
    async listByTag(name) {
        const tag = await this.prisma.tag.findUnique({
            where: { name },
            include: { posts: { include: { author: true, images: { orderBy: { order: 'asc' } } }, orderBy: { createdAt: 'desc' } } },
        });
        if (!tag) {
            throw new TagNotFoundError(name);
        }
        return tag.posts;
    }
    // A checagem "é dono do post?" já aconteceu no middleware
    // `requireOwnPost` (src/auth/middleware.ts) antes desta rota ser
    // chamada — aqui só falta apagar.
    async remove(id) {
        await this.prisma.post.delete({ where: { id } });
    }
}
