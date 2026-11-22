import type { PrismaClient } from '@prisma/client';
import { PostNotFoundError, ValidationError } from '../shared/errors.js';

export class CommentController {
  constructor(private readonly prisma: PrismaClient) {}

  async list(postId: number, userId: number) {
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

  async create(userId: number, postId: number, body: unknown) {
    const { content } = (body ?? {}) as { content?: unknown };
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

  async update(commentId: number, body: unknown) {
    const { content } = (body ?? {}) as { content?: unknown };
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new ValidationError('"content" é obrigatório');
    }
    return this.prisma.comment.update({ where: { id: commentId }, data: { content: content.trim() } });
  }

  async remove(commentId: number): Promise<void> {
    await this.prisma.comment.delete({ where: { id: commentId } });
  }
}