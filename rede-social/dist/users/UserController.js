import { Prisma } from '@prisma/client';
import { DuplicateFollowError, SelfFollowError, UserNotFoundError, ValidationError } from '../shared/errors.js';
// Criar usuário agora é responsabilidade só do AuthController#register
// (precisa de senha/hash) — não existe mais um "criar usuário sem senha"
// aqui, de propósito.
export class UserController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async get(id) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            include: {
                _count: { select: { posts: true, followers: true, following: true } },
            },
        });
        if (!user) {
            throw new UserNotFoundError(id);
        }
        return user;
    }
    // Autorrelação N:N em ação: um User segue outro User através da tabela
    // de junção explícita `Follow`.
    async follow(followerId, body) {
        const { targetId } = (body ?? {});
        if (typeof targetId !== 'number' || !Number.isInteger(targetId)) {
            throw new ValidationError('"targetId" é obrigatório e deve ser um número inteiro');
        }
        if (targetId === followerId) {
            throw new SelfFollowError();
        }
        const [follower, target] = await Promise.all([
            this.prisma.user.findUnique({ where: { id: followerId } }),
            this.prisma.user.findUnique({ where: { id: targetId } }),
        ]);
        if (!follower) {
            throw new UserNotFoundError(followerId);
        }
        if (!target) {
            throw new UserNotFoundError(targetId);
        }
        try {
            return await this.prisma.follow.create({
                data: { followerId, followingId: targetId },
            });
        }
        catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw new DuplicateFollowError();
            }
            throw err;
        }
    }
    // Feed = posts de quem eu sigo. Mostra um filtro relacional aninhado:
    // "posts cujo autor tem, entre seus seguidores, um Follow onde eu sou o
    // follower" — sem precisar buscar a lista de ids manualmente antes.
    async feed(userId) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new UserNotFoundError(userId);
        }
        const posts = await this.prisma.post.findMany({
            where: { author: { followers: { some: { followerId: userId } } } },
            include: {
                author: true,
                tags: true,
                images: { orderBy: { order: 'asc' } },
                likes: { where: { userId }, select: { userId: true } },
                comments: {
                    take: 3,
                    orderBy: [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }],
                    include: {
                        author: true,
                        likes: { where: { userId }, select: { userId: true } },
                        _count: { select: { likes: true } },
                    },
                },
                _count: { select: { likes: true, comments: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return posts.map(({ likes, comments, ...post }) => ({
            ...post,
            likedByMe: likes.length > 0,
            comments: comments.map(({ likes: commentLikes, ...comment }) => ({
                ...comment,
                likedByMe: commentLikes.length > 0,
            })),
        }));
    }
    async feedPage(userId, cursor, limit) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            throw new UserNotFoundError(userId);
        }
        const results = await this.prisma.post.findMany({
            where: { author: { followers: { some: { followerId: userId } } } },
            include: {
                author: true,
                tags: true,
                images: { orderBy: { order: 'asc' } },
                likes: { where: { userId }, select: { userId: true } },
                comments: {
                    take: 3,
                    orderBy: [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }],
                    include: {
                        author: true,
                        likes: { where: { userId }, select: { userId: true } },
                        _count: { select: { likes: true } },
                    },
                },
                _count: { select: { likes: true, comments: true } },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
            take: limit + 1,
        });
        const hasMore = results.length > limit;
        const page = results.slice(0, limit);
        const posts = page.map(({ likes, comments, ...post }) => ({
            ...post,
            likedByMe: likes.length > 0,
            comments: comments.map(({ likes: commentLikes, ...comment }) => ({
                ...comment,
                likedByMe: commentLikes.length > 0,
            })),
        }));
        return {
            posts,
            nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        };
    }
    // Lista para a tela inicial sugerir quem seguir: todo mundo, exceto eu
    // mesmo, marcando quem eu já sigo (`isFollowing`) para a view decidir
    // entre mostrar o botão "Seguir" ou "Já segue".
    async listOthers(currentUserId) {
        const users = await this.prisma.user.findMany({
            where: { id: { not: currentUserId } },
            orderBy: { name: 'asc' },
        });
        const following = await this.prisma.follow.findMany({ where: { followerId: currentUserId } });
        const followingIds = new Set(following.map((f) => f.followingId));
        return users.map((user) => ({ ...user, isFollowing: followingIds.has(user.id) }));
    }
}
