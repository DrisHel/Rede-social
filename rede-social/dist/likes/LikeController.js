import { CommentNotFoundError, PostNotFoundError } from '../shared/errors.js';
export class LikeController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async setPostLike(userId, postId, liked) {
        const post = await this.prisma.post.findUnique({ where: { id: postId }, select: { id: true } });
        if (!post) {
            throw new PostNotFoundError(postId);
        }
        if (liked) {
            await this.prisma.like.upsert({
                where: { userId_postId: { userId, postId } },
                create: { userId, postId },
                update: {},
            });
        }
        else {
            await this.prisma.like.deleteMany({ where: { userId, postId } });
        }
        return {
            liked,
            count: await this.prisma.like.count({ where: { postId } }),
        };
    }
    async setCommentLike(userId, commentId, liked) {
        const comment = await this.prisma.comment.findUnique({ where: { id: commentId }, select: { id: true } });
        if (!comment) {
            throw new CommentNotFoundError(commentId);
        }
        if (liked) {
            await this.prisma.commentLike.upsert({
                where: { userId_commentId: { userId, commentId } },
                create: { userId, commentId },
                update: {},
            });
        }
        else {
            await this.prisma.commentLike.deleteMany({ where: { userId, commentId } });
        }
        return {
            liked,
            count: await this.prisma.commentLike.count({ where: { commentId } }),
        };
    }
}
