import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createServer } from '../../src/server.js';
import { createTestPrismaClient, resetDatabase } from '../helpers/testDb.js';
import { FakeImageStorage } from '../helpers/fakeImageStorage.js';
import { registerAndLogin } from '../helpers/auth.js';

const prisma: PrismaClient = createTestPrismaClient();
const imageStorage = new FakeImageStorage();
const app = createServer(prisma, imageStorage);

beforeEach(async () => {
  await resetDatabase(prisma);
  imageStorage.uploads.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createPost(agent: ReturnType<typeof request.agent>, content = 'Post de teste') {
  await agent.post('/posts').type('form').send({ content });
  return prisma.post.findFirstOrThrow({ where: { content } });
}

describe('curtidas em posts', () => {
  it('exige sessão e cria/remove a curtida com a identidade da sessão', async () => {
    const author = await registerAndLogin(app, prisma, 'autor@exemplo.com');
    const post = await createPost(author.agent);
    const anonymous = await request(app).post(`/posts/${post.id}/like`);
    expect(anonymous.status).toBe(302);

    const user = await registerAndLogin(app, prisma, 'curtidor@exemplo.com');
    const liked = await user.agent.post(`/posts/${post.id}/like`).send({ userId: author.userId });
    expect(liked.status).toBe(200);
    expect(liked.body).toEqual({ liked: true, count: 1 });
    await expect(prisma.like.findUnique({ where: { userId_postId: { userId: user.userId, postId: post.id } } })).resolves.not.toBeNull();

    const removed = await user.agent.delete(`/posts/${post.id}/like`);
    expect(removed.body).toEqual({ liked: false, count: 0 });
  });
});

describe('comentários e autorização', () => {
  it('cria, edita e apaga comentário próprio; bloqueia alterações de outra pessoa', async () => {
    const author = await registerAndLogin(app, prisma, 'autor-comentario@exemplo.com');
    const post = await createPost(author.agent);
    const other = await registerAndLogin(app, prisma, 'outro-comentario@exemplo.com');

    const anonymous = await request(app).post(`/posts/${post.id}/comments`).send({ content: 'Sem sessão' });
    expect(anonymous.status).toBe(302);

    const created = await other.agent.post(`/posts/${post.id}/comments`).send({ content: 'Comentário novo', authorId: author.userId });
    expect(created.status).toBe(201);
    expect(created.body.authorId).toBe(other.userId);
    const commentId = created.body.id;

    expect((await author.agent.patch(`/posts/${post.id}/comments/${commentId}`).send({ content: 'Tentativa' })).status).toBe(403);
    expect((await author.agent.delete(`/posts/${post.id}/comments/${commentId}`)).status).toBe(403);
    expect((await other.agent.patch(`/posts/${post.id}/comments/${commentId}`).send({ content: 'Editado' })).body.content).toBe('Editado');
    expect((await other.agent.delete(`/posts/${post.id}/comments/${commentId}`)).status).toBe(204);
  });

  it('lista comentários ordenados por curtidas e rejeita conteúdo vazio', async () => {
    const author = await registerAndLogin(app, prisma, 'autor-listagem@exemplo.com');
    const post = await createPost(author.agent);
    const firstUser = await registerAndLogin(app, prisma, 'primeiro@exemplo.com');
    const secondUser = await registerAndLogin(app, prisma, 'segundo@exemplo.com');
    const first = await firstUser.agent.post(`/posts/${post.id}/comments`).send({ content: 'Mais curtido' });
    await secondUser.agent.post(`/posts/${post.id}/comments`).send({ content: 'Menos curtido' });
    await secondUser.agent.post(`/comments/${first.body.id}/like`);

    expect((await author.agent.get(`/posts/${post.id}/comments`)).body.map((comment: { content: string }) => comment.content)).toEqual(['Mais curtido', 'Menos curtido']);
    expect((await firstUser.agent.post(`/posts/${post.id}/comments`).send({ content: '   ' })).status).toBe(400);
  });
});

describe('curtidas em comentários', () => {
  it('curte e descurte comentário e rejeita visitante', async () => {
    const author = await registerAndLogin(app, prisma, 'autor-like-comentario@exemplo.com');
    const post = await createPost(author.agent);
    const comment = await author.agent.post(`/posts/${post.id}/comments`).send({ content: 'Comentário' });
    expect((await request(app).post(`/comments/${comment.body.id}/like`)).status).toBe(302);

    const user = await registerAndLogin(app, prisma, 'like-comentario@exemplo.com');
    expect((await user.agent.post(`/comments/${comment.body.id}/like`)).body).toEqual({ liked: true, count: 1 });
    expect((await user.agent.delete(`/comments/${comment.body.id}/like`)).body).toEqual({ liked: false, count: 0 });
  });
});

describe('upload múltiplo e paginação', () => {
  it('salva imagens na ordem recebida através de ImageStorage', async () => {
    const author = await registerAndLogin(app, prisma, 'autor-imagens@exemplo.com');
    const response = await author.agent
      .post('/posts')
      .field('content', 'Post com carrossel')
      .attach('images', Buffer.from('image-one'), { filename: 'um.png', contentType: 'image/png' })
      .attach('images', Buffer.from('image-two'), { filename: 'dois.png', contentType: 'image/png' });

    expect(response.status).toBe(302);
    expect(imageStorage.uploads.map((file) => file.originalname)).toEqual(['um.png', 'dois.png']);
    const post = await prisma.post.findFirstOrThrow({ where: { content: 'Post com carrossel' }, include: { images: { orderBy: { order: 'asc' } } } });
    expect(post.images.map((image) => image.order)).toEqual([0, 1]);
  });

  it('retorna páginas de feed sem repetir posts e exige sessão', async () => {
    const viewer = await registerAndLogin(app, prisma, 'leitor-feed@exemplo.com');
    const author = await registerAndLogin(app, prisma, 'autor-feed@exemplo.com');
    await viewer.agent.post('/follow').type('form').send({ targetId: author.userId });
    for (let index = 1; index <= 3; index += 1) {
      await createPost(author.agent, `Post ${index}`);
    }

    const firstPage = await viewer.agent.get('/api/feed?limit=2');
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.posts).toHaveLength(2);
    expect(firstPage.body.nextCursor).toBeTruthy();
    const secondPage = await viewer.agent.get(`/api/feed?limit=2&cursor=${firstPage.body.nextCursor}`);
    expect(secondPage.body.posts).toHaveLength(1);
    expect(secondPage.body.posts[0].id).not.toBe(firstPage.body.posts[0].id);
    expect(secondPage.body.nextCursor).toBeNull();
    expect((await request(app).get('/api/feed')).status).toBe(302);
  });
});

describe('views do feed e do post', () => {
  it('renderiza carrossel, interações e comentários no feed e no detalhe', async () => {
    const viewer = await registerAndLogin(app, prisma, 'leitor-view@exemplo.com');
    const author = await registerAndLogin(app, prisma, 'autor-view@exemplo.com');
    await viewer.agent.post('/follow').type('form').send({ targetId: author.userId });
    const post = await createPost(author.agent, 'Post visível no feed');
    await author.agent.post(`/posts/${post.id}/comments`).send({ content: 'Comentário visível' });

    const feed = await viewer.agent.get('/');
    expect(feed.status).toBe(200);
    expect(feed.text).toContain('Post visível no feed');
    expect(feed.text).toContain('data-like-post');
    expect(feed.text).toContain('data-comment-form');

    const detail = await viewer.agent.get(`/posts/${post.id}`);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Comentário visível');
    expect(detail.text).toContain('data-like-comment');
  });
});