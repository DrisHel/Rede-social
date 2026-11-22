import { Prisma } from '@prisma/client';
import { hashPassword, verifyPassword } from './passwords.js';
import { DuplicateEmailError, InvalidCredentialsError, ValidationError } from '../shared/errors.js';
export class AuthController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async register(body, avatarUrl) {
        const { name, email, password } = (body ?? {});
        if (typeof name !== 'string' || name.trim().length === 0) {
            throw new ValidationError('"name" é obrigatório');
        }
        if (typeof email !== 'string' || email.trim().length === 0) {
            throw new ValidationError('"email" é obrigatório');
        }
        if (typeof password !== 'string' || password.length < 6) {
            throw new ValidationError('"password" precisa ter pelo menos 6 caracteres');
        }
        const passwordHash = await hashPassword(password);
        try {
            return await this.prisma.user.create({ data: { name, email, passwordHash, avatarUrl } });
        }
        catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
                throw new DuplicateEmailError(email);
            }
            throw err;
        }
    }
    async login(body) {
        const { email, password } = (body ?? {});
        if (typeof email !== 'string' || typeof password !== 'string') {
            throw new InvalidCredentialsError();
        }
        const user = await this.prisma.user.findUnique({ where: { email } });
        // Mesma mensagem de erro tanto para "e-mail não existe" quanto para
        // "senha errada" — de propósito. Se a mensagem fosse diferente,
        // alguém tentando adivinhar contas descobriria quais e-mails existem
        // no sistema (user enumeration).
        if (!user) {
            throw new InvalidCredentialsError();
        }
        const passwordMatches = await verifyPassword(password, user.passwordHash);
        if (!passwordMatches) {
            throw new InvalidCredentialsError();
        }
        return user;
    }
}
