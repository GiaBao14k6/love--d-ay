require('dotenv').config();
const SECRET_KEY = process.env.SECRET_KEY;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/love-diary';
const PORT = process.env.PORT || 3000;

const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const USERS = [
  { username: "anhdicthui1405", password: "12092006" },
  { username: "emdaikahn1209", password: "14052006" }
];

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('Kết nối MongoDB thành công!')).catch(err => console.error('Lỗi kết nối MongoDB:', err));

app.use(express.json());
app.use(cors());

// Serve static folders for client and assets
app.use('/assets', express.static(path.join(__dirname, '../assets')));
app.use('/', express.static(path.join(__dirname, '../client')));
app.use('/uploads', express.static(uploadDir));

// JWT authentication middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ message: "Cần đăng nhập" });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ message: "Cần đăng nhập" });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ message: "Token không hợp lệ" });
  }
}

// Login endpoint (POST /api/login)
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ message: "Sai tài khoản hoặc mật khẩu" });
  const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '7d' });
  res.json({ token });
});

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/mov'
];

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});

const fileFilter = (req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
        return cb(new Error('Chỉ cho phép upload ảnh hoặc video!'), false);
    }
    cb(null, true);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: MAX_FILE_SIZE }
});

const commentSchema = new mongoose.Schema({
    author: String,
    content: String,
    createdAt: { type: Date, default: Date.now },
    replies: [{
        author: String,
        content: String,
        createdAt: { type: Date, default: Date.now }
    }]
});
const diarySchema = new mongoose.Schema({
    author: String,
    title: String,
    content: String,
    media: [String],
    date: { type: Date, default: Date.now },
    likes: { type: Number, default: 0 },
    comments: [commentSchema]
});
const DiaryEntry = mongoose.model('DiaryEntry', diarySchema);

async function deleteMediaFiles(mediaFiles) {
    for (const filename of mediaFiles) {
        const filePath = path.join(uploadDir, filename);
        try {
            await fs.promises.unlink(filePath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error(`Không thể xóa file ${filePath}:`, err);
            }
        }
    }
}

function uploadHandler(req, res, next) {
    upload.array('media', 10)(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ message: 'File quá lớn hoặc quá nhiều file!' });
        } else if (err) {
            return res.status(400).json({ message: err.message });
        }
        next();
    });
}

// Get diary entries (public)
app.get('/api/diary', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const total = await DiaryEntry.countDocuments();
        const entries = await DiaryEntry.find().sort({ date: -1 }).skip(skip).limit(limit);
        res.status(200).json({ entries, total, page, totalPages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get single diary entry (public)
app.get('/api/diary/:id', async (req, res) => {
    try {
        const entry = await DiaryEntry.findById(req.params.id);
        if (!entry) {
            return res.status(404).json({ message: 'Không tìm thấy mục nhật ký.' });
        }
        res.json(entry);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create diary entry (protected)
app.post('/api/diary', authMiddleware, uploadHandler, async (req, res) => {
    const filesToDelete = req.files ? req.files.map(f => f.filename) : [];
    const newEntry = new DiaryEntry({
        author: req.body.author,
        title: req.body.title,
        content: req.body.content,
        media: filesToDelete,
        date: req.body.date ? new Date(req.body.date) : new Date()
    });
    try {
        const savedEntry = await newEntry.save();
        res.status(201).json(savedEntry);
    } catch (err) {
        await deleteMediaFiles(filesToDelete);
        res.status(400).json({ message: err.message });
    }
});

// Update diary entry (protected)
app.put('/api/diary/:id', authMiddleware, uploadHandler, async (req, res) => {
    let entry;
    try {
        entry = await DiaryEntry.findById(req.params.id);
        if (!entry) {
            return res.status(404).json({ message: 'Không tìm thấy mục nhật ký.' });
        }
        entry.title = req.body.title || entry.title;
        entry.content = req.body.content || entry.content;
        entry.date = req.body.date ? new Date(req.body.date) : entry.date;

        let mediaToKeep = [];
        if (req.body.mediaToKeep) {
            if (Array.isArray(req.body.mediaToKeep)) mediaToKeep = req.body.mediaToKeep;
            else mediaToKeep = [req.body.mediaToKeep];
        }

        const newMedia = req.files ? req.files.map(f => f.filename) : [];
        const finalMedia = [...mediaToKeep, ...newMedia];

        // Xóa các file media không còn giữ lại
        const toDelete = entry.media.filter(fn => !mediaToKeep.includes(fn));
        if (toDelete.length > 0) await deleteMediaFiles(toDelete);

        entry.media = finalMedia;

        const updatedEntry = await entry.save();
        res.json(updatedEntry);
    } catch (err) {
        // Nếu lỗi, xóa các file mới upload ở lần sửa này
        const filesToDelete = req.files ? req.files.map(f => f.filename) : [];
        if (filesToDelete.length > 0) await deleteMediaFiles(filesToDelete);
        res.status(400).json({ message: err.message });
    }
});

// Delete diary entry (protected)
app.delete('/api/diary/:id', authMiddleware, async (req, res) => {
    try {
        const entry = await DiaryEntry.findById(req.params.id);
        if (!entry) {
            return res.status(404).json({ message: 'Không tìm thấy mục nhật ký.' });
        }
        if (entry.media && entry.media.length > 0) {
            await deleteMediaFiles(entry.media);
        }
        await DiaryEntry.findByIdAndDelete(req.params.id);
        res.json({ message: 'Đã xóa thành công.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Like/dislike/comment routes (public, or add authMiddleware if you want)
app.post('/api/diary/:id/like', async (req, res) => {
    try {
        const entry = await DiaryEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ message: 'Không tìm thấy mục nhật ký.' });
        entry.likes += 1;
        await entry.save();
        res.json({ likes: entry.likes });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/diary/:id/dislike', async (req, res) => {
    try {
        const entry = await DiaryEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ message: 'Không tìm thấy mục nhật ký.' });
        entry.likes = Math.max(0, entry.likes - 1);
        await entry.save();
        res.json({ likes: entry.likes });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Comments
app.post('/api/diary/:id/comment', async (req, res) => {
    try {
        const { author, content } = req.body;
        if (!author || !author.trim() || !content || !content.trim()) {
            return res.status(400).json({ message: 'Tác giả và nội dung không được để trống.' });
        }
        const entry = await DiaryEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ message: 'Không tìm thấy mục nhật ký.' });
        const newComment = { author: author.trim(), content: content.trim() };
        entry.comments.push(newComment);
        await entry.save();
        res.status(201).json(entry.comments[entry.comments.length - 1]);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.post('/api/diary/:id/comment/:commentId/reply', async (req, res) => {
    try {
        const { author, content } = req.body;
        if (!author || !author.trim() || !content || !content.trim()) {
            return res.status(400).json({ message: 'Tác giả và nội dung trả lời không được để trống.' });
        }
        const entry = await DiaryEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ message: 'Không tìm thấy mục nhật ký.' });
        const comment = entry.comments.id(req.params.commentId);
        if (!comment) return res.status(404).json({ message: 'Không tìm thấy bình luận.' });
        comment.replies.push({ author: author.trim(), content: content.trim() });
        await entry.save();
        res.status(201).json(comment.replies[comment.replies.length - 1]);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.put('/api/diary/:id/comment/:commentId', async (req, res) => {
    try {
        const entry = await DiaryEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ message: 'Không tìm thấy mục nhật ký.' });
        const comment = entry.comments.id(req.params.commentId);
        if (!comment) return res.status(404).json({ message: 'Không tìm thấy bình luận.' });
        if (req.body.author && req.body.author.trim()) comment.author = req.body.author.trim();
        if (req.body.content && req.body.content.trim()) comment.content = req.body.content.trim();
        await entry.save();
        res.status(200).json(comment);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.delete('/api/diary/:id/comment/:commentId', async (req, res) => {
    try {
        const entry = await DiaryEntry.findById(req.params.id);
        if (!entry) return res.status(404).json({ message: 'Không tìm thấy mục nhật ký.' });
        const comment = entry.comments.id(req.params.commentId);
        if (!comment) return res.status(404).json({ message: 'Không tìm thấy bình luận.' });
        comment.remove();
        await entry.save();
        res.status(200).json({ message: 'Đã xóa bình luận.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});