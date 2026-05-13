import multer from 'multer';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const uploadDir = path.join(os.tmpdir(), 'go-hybrid-uploads');
try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (e) { }

export const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
    }),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB limit
});
