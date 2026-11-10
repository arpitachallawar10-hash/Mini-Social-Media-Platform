
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const db = new Database("social.db");
const PORT = 3000;

db.pragma("foreign_keys = ON");

// Create database tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        bio TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(post_id) REFERENCES posts(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS likes (
        user_id INTEGER NOT NULL,
        post_id INTEGER NOT NULL,
        PRIMARY KEY(user_id, post_id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(post_id) REFERENCES posts(id)
    );

    CREATE TABLE IF NOT EXISTS follows (
        follower_id INTEGER NOT NULL,
        following_id INTEGER NOT NULL,
        PRIMARY KEY(follower_id, following_id),
        CHECK(follower_id != following_id),
        FOREIGN KEY(follower_id) REFERENCES users(id),
        FOREIGN KEY(following_id) REFERENCES users(id)
    );
`);

// Middleware
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || "social-media-secret-change-before-deployment",
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax"
    }
}));

app.use(express.static(path.join(__dirname, "public")));

function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: "Please login first." });
    }
    next();
}

function getUser(id) {
    return db.prepare(
        "SELECT id, username, bio FROM users WHERE id = ?"
    ).get(id);
}

// REGISTER
app.post("/api/register", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password || username.trim().length < 3 ||
        username.trim().length > 20 ||
        !/^[a-zA-Z0-9_]+$/.test(username.trim())) {
        return res.status(400).json({
            error: "Username must be 3-20 characters using letters, numbers or underscore."
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            error: "Password must contain at least 6 characters."
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = db.prepare(
            "INSERT INTO users (username, password) VALUES (?, ?)"
        ).run(username.trim(), hashedPassword);

        req.session.userId = Number(result.lastInsertRowid);

        res.json({
            user: getUser(req.session.userId)
        });

    } catch (error) {
        res.status(409).json({
            error: "Username already exists."
        });
    }
});

// LOGIN
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;

    const user = db.prepare(
        "SELECT * FROM users WHERE username = ?"
    ).get(String(username || "").trim());

    if (!user || !(await bcrypt.compare(password || "", user.password))) {
        return res.status(400).json({
            error: "Invalid username or password."
        });
    }

    req.session.userId = user.id;

    res.json({
        user: getUser(user.id)
    });
});

// CURRENT USER
app.get("/api/me", (req, res) => {
    res.json({
        user: req.session.userId
            ? getUser(req.session.userId)
            : null
    });
});

// LOGOUT
app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ message: "Logged out successfully." });
    });
});

// CREATE POST
app.post("/api/posts", requireLogin, (req, res) => {
    const content = String(req.body.content || "").trim();

    if (!content || content.length > 500) {
        return res.status(400).json({
            error: "Post must contain 1-500 characters."
        });
    }

    db.prepare(
        "INSERT INTO posts (user_id, content) VALUES (?, ?)"
    ).run(req.session.userId, content);

    res.json({ message: "Post created successfully." });
});

// GET ALL POSTS
app.get("/api/posts", (req, res) => {
    const userId = req.session.userId || 0;

    const posts = db.prepare(`
        SELECT
            p.id,
            p.user_id,
            p.content,
            p.created_at,
            u.username,

            (SELECT COUNT(*) FROM likes
             WHERE post_id = p.id) AS like_count,

            (SELECT COUNT(*) FROM comments
             WHERE post_id = p.id) AS comment_count,

            EXISTS(
                SELECT 1 FROM likes
                WHERE post_id = p.id AND user_id = ?
            ) AS liked

        FROM posts p
        JOIN users u ON p.user_id = u.id
        ORDER BY p.id DESC
    `).all(userId);

    res.json(posts);
});

// DELETE POST
app.delete("/api/posts/:id", requireLogin, (req, res) => {
    const result = db.prepare(
        "DELETE FROM posts WHERE id = ? AND user_id = ?"
    ).run(req.params.id, req.session.userId);

    if (!result.changes) {
        return res.status(404).json({
            error: "Post not found or not yours."
        });
    }

    res.json({ message: "Post deleted." });
});

// LIKE / UNLIKE POST
app.post("/api/posts/:id/like", requireLogin, (req, res) => {
    const postId = Number(req.params.id);
    const userId = req.session.userId;

    const post = db.prepare(
        "SELECT id FROM posts WHERE id = ?"
    ).get(postId);

    if (!post) {
        return res.status(404).json({ error: "Post not found." });
    }

    const exists = db.prepare(
        "SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?"
    ).get(userId, postId);

    if (exists) {
        db.prepare(
            "DELETE FROM likes WHERE user_id = ? AND post_id = ?"
        ).run(userId, postId);
    } else {
        db.prepare(
            "INSERT INTO likes (user_id, post_id) VALUES (?, ?)"
        ).run(userId, postId);
    }

    const count = db.prepare(
        "SELECT COUNT(*) AS total FROM likes WHERE post_id = ?"
    ).get(postId).total;

    res.json({
        liked: !exists,
        like_count: count
    });
});

// ADD COMMENT
app.post("/api/posts/:id/comments", requireLogin, (req, res) => {
    const content = String(req.body.content || "").trim();

    if (!content || content.length > 250) {
        return res.status(400).json({
            error: "Comment must contain 1-250 characters."
        });
    }

    const post = db.prepare(
        "SELECT id FROM posts WHERE id = ?"
    ).get(req.params.id);

    if (!post) {
        return res.status(404).json({
            error: "Post not found."
        });
    }

    db.prepare(
        "INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)"
    ).run(post.id, req.session.userId, content);

    res.json({ message: "Comment added." });
});

// GET COMMENTS
app.get("/api/posts/:id/comments", (req, res) => {
    const comments = db.prepare(`
        SELECT c.id, c.content, c.created_at, u.username
        FROM comments c
        JOIN users u ON c.user_id = u.id
        WHERE c.post_id = ?
        ORDER BY c.id ASC
    `).all(req.params.id);

    res.json(comments);
});

// GET ALL USERS
app.get("/api/users", (req, res) => {
    const userId = req.session.userId || 0;

    const users = db.prepare(`
        SELECT
            u.id,
            u.username,
            u.bio,

            (SELECT COUNT(*) FROM follows
             WHERE following_id = u.id) AS followers,

            (SELECT COUNT(*) FROM follows
             WHERE follower_id = u.id) AS following,

            EXISTS(
                SELECT 1 FROM follows
                WHERE follower_id = ? AND following_id = u.id
            ) AS is_following

        FROM users u
        WHERE u.id != ?
        ORDER BY u.username
    `).all(userId, userId);

    res.json(users);
});

// GET USER PROFILE
app.get("/api/users/:id", (req, res) => {
    const user = db.prepare(`
        SELECT
            u.id,
            u.username,
            u.bio,

            (SELECT COUNT(*) FROM follows
             WHERE following_id = u.id) AS followers,

            (SELECT COUNT(*) FROM follows
             WHERE follower_id = u.id) AS following

        FROM users u
        WHERE u.id = ?
    `).get(req.params.id);

    if (!user) {
        return res.status(404).json({
            error: "User not found."
        });
    }

    res.json(user);
});

// UPDATE PROFILE
app.put("/api/profile", requireLogin, (req, res) => {
    const bio = String(req.body.bio || "").trim().slice(0, 160);

    db.prepare(
        "UPDATE users SET bio = ? WHERE id = ?"
    ).run(bio, req.session.userId);

    res.json({
        message: "Profile updated.",
        user: getUser(req.session.userId)
    });
});

// FOLLOW / UNFOLLOW
app.post("/api/users/:id/follow", requireLogin, (req, res) => {
    const targetId = Number(req.params.id);
    const userId = req.session.userId;

    if (targetId === userId) {
        return res.status(400).json({
            error: "You cannot follow yourself."
        });
    }

    const target = db.prepare(
        "SELECT id FROM users WHERE id = ?"
    ).get(targetId);

    if (!target) {
        return res.status(404).json({
            error: "User not found."
        });
    }

    const exists = db.prepare(
        "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?"
    ).get(userId, targetId);

    if (exists) {
        db.prepare(
            "DELETE FROM follows WHERE follower_id = ? AND following_id = ?"
        ).run(userId, targetId);
    } else {
        db.prepare(
            "INSERT INTO follows (follower_id, following_id) VALUES (?, ?)"
        ).run(userId, targetId);
    }

    res.json({ following: !exists });
});

// START SERVER
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
