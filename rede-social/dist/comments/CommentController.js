import { PostNotFoundError, ValidationError } from '../shared/errors.js';
export class CommentController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async list(postId, userId) {
        const post = await this.prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
        if (!post) {
            throw new PostNotFoundError(postId);
        }
        const comments = await this.prisma.comment.findMany({
            where: { postId },
            include: {
                author: true,
                likes: { where: { userId }, select: { userId: true } },
                _count: { select: { likes: true } },
            },
            orderBy: [{ likes: { _count: 'desc' } }, { createdAt: 'desc' }],
        });
        return comments.map(({ likes, ...comment }) => ({ ...comment, likedByMe: likes.length > 0 }));
    }
    async create(userId, postId, body) {
        const { content } = (body ?? {});
        if (typeof content !== 'string' || content.trim().length === 0) {
            throw new ValidationError('"content" é obrigatório');
        }
        const post = await this.prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
        if (!post) {
            throw new PostNotFoundError(postId);
        }
        return this.prisma.comment.create({
            data: { content: content.trim(), authorId: userId, postId },
            include: {
                author: true,
                likes: { where: { userId }, select: { userId: true } },
                _count: { select: { likes: true } },
            },
        }).then(({ likes, ...comment }) => ({ ...comment, likedByMe: likes.length > 0 }));
    }
    async update(commentId, body) {
        const { content } = (body ?? {});
        if (typeof content !== 'string' || content.trim().length === 0) {
            throw new ValidationError('"content" é obrigatório');
        }
        return this.prisma.comment.update({ where: { id: commentId }, data: { content: content.trim() } });
    }
    async remove(commentId) {
        await this.prisma.comment.delete({ where: { id: commentId } });
    }
}
