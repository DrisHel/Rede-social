import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
// Integração real com S3: o `PutObjectCommand` envia o buffer do arquivo
// (que o Multer já deixou em memória — ver src/uploads/upload.ts) para o
// bucket configurado. O nome do arquivo (`Key`) é gerado com um UUID para
// nunca colidir com outro upload, mesmo que dois usuários mandem uma foto
// com o mesmo nome de arquivo original.
export class S3ImageStorage {
    constructor(bucket, region) {
        this.bucket = bucket;
        this.region = region;
        this.client = new S3Client({ region });
    }
    async upload(file) {
        const extension = file.originalname.split('.').pop();
        const key = `posts/${randomUUID()}${extension ? `.${extension}` : ''}`;
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
        }));
        // URL pública "virtual-hosted style" do S3. Só funciona sem mais
        // configuração se o bucket permitir leitura pública do objeto (ACL ou
        // bucket policy) — para um bucket privado, o certo seria gerar uma
        // signed URL sob demanda em vez de montar este endereço fixo.
        return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }
}
