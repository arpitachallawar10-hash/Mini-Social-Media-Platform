
let mode = "login";
let currentUser = null;

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
    }

    return data;
}

function setMode(value) {
    mode = value;
    document.getElementById("authButton").textContent =
        mode === "login" ? "Login" : "Register";
}

function showMessage(id, message) {
    document.getElementById(id).textContent = message;
}

// Login and registration
document.getElementById("authForm").addEventListener("submit", async function(e) {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {
        const result = await api("/api/" + mode, {
            method: "POST",
            body: JSON.stringify({ username, password })
        });

        currentUser = result.user;
        await enterApp();

    } catch (error) {
        showMessage("authMessage", error.message);
    }
});

// Open application
async function enterApp() {
    document.getElementById("authSection").style.display = "none";
    document.getElementById("appSection").style.display = "block";
    document.getElementById("navbar").style.display = "flex";

    await loadPosts();
    showPage("feed");
}

// Navigation
function showPage(page) {
    ["feedPage", "profilePage", "peoplePage"].forEach(id => {
        document.getElementById(id).style.display = "none";
    });

    document.getElementById(page + "Page").style.display = "block";

    if (page === "feed") loadPosts();
    if (page === "profile") loadProfile();
    if (page === "people") loadPeople();
}

// Create post
async function createPost() {
    const content = document.getElementById("postContent").value.trim();

    if (!content) {
        alert("Please write something!");
        return;
    }

    try {
        await api("/api/posts", {
            method: "POST",
            body: JSON.stringify({ content })
        });

        document.getElementById("postContent").value = "";
        await loadPosts();

    } catch (error) {
        showMessage("message", error.message);
    }
}

// Display posts
async function loadPosts(target = "postsContainer", onlyMine = false) {
    const posts = await api("/api/posts");

    const filtered = onlyMine
        ? posts.filter(post => post.user_id === currentUser.id)
        : posts;

    const container = document.getElementById(target);

    if (filtered.length === 0) {
        container.innerHTML = "<p>No posts available.</p>";
        return;
    }

    container.innerHTML = filtered.map(post => `
        <div class="post-card">
            <h3>${escapeHTML(post.username)}</h3>
            <small>${new Date(post.created_at + "Z").toLocaleString()}</small>

            <p>${escapeHTML(post.content)}</p>

            <div class="post-actions">
                <button onclick="toggleLike(${post.id})">
                    ${post.liked ? "❤️" : "🤍"} ${post.like_count}
                </button>

                <button onclick="loadComments(${post.id})">
                    💬 ${post.comment_count}
                </button>

                ${post.user_id === currentUser.id
                    ? `<button onclick="deletePost(${post.id})">Delete</button>`
                    : ""}
            </div>

            <div class="comments" id="comments-${post.id}"></div>
        </div>
    `).join("");
}

// Like and unlike
async function toggleLike(id) {
    try {
        await api(`/api/posts/${id}/like`, {
            method: "POST"
        });

        await loadPosts();

    } catch (error) {
        showMessage("message", error.message);
    }
}

// Delete post
async function deletePost(id) {
    if (!confirm("Are you sure you want to delete this post?")) {
        return;
    }

    try {
        await api(`/api/posts/${id}`, {
            method: "DELETE"
        });

        await loadPosts();
        await loadProfile();

    } catch (error) {
        showMessage("message", error.message);
    }
}

// Load comments
async function loadComments(id) {
    const comments = await api(`/api/posts/${id}/comments`);
    const box = document.getElementById(`comments-${id}`);

    box.innerHTML = `
        ${comments.map(comment => `
            <div class="comment">
                <strong>${escapeHTML(comment.username)}:</strong>
                ${escapeHTML(comment.content)}
            </div>
        `).join("")}

        <form onsubmit="addComment(event, ${id})">
            <input name="content" placeholder="Write a comment..." maxlength="250" required>
            <button type="submit">Comment</button>
        </form>
    `;
}

// Add comment
async function addComment(event, id) {
    event.preventDefault();

    const content = event.target.elements.content.value;

    try {
        await api(`/api/posts/${id}/comments`, {
            method: "POST",
            body: JSON.stringify({ content })
        });

        await loadPosts();

    } catch (error) {
        showMessage("message", error.message);
    }
}

// Load profile
async function loadProfile() {
    const profile = await api(`/api/users/${currentUser.id}`);

    document.getElementById("profileUsername").textContent =
        profile.username;

    document.getElementById("profileStats").textContent =
        `${profile.followers} Followers | ${profile.following} Following`;

    document.getElementById("bio").value = profile.bio || "";

    await loadPosts("myPosts", true);
}

// Update profile
async function updateProfile() {
    const bio = document.getElementById("bio").value;

    try {
        await api("/api/profile", {
            method: "PUT",
            body: JSON.stringify({ bio })
        });

        alert("Profile updated successfully!");

    } catch (error) {
        showMessage("message", error.message);
    }
}

// Load people
async function loadPeople() {
    const users = await api("/api/users");

    const container = document.getElementById("peopleContainer");

    if (users.length === 0) {
        container.innerHTML = "<p>No other users found.</p>";
        return;
    }

    container.innerHTML = users.map(user => `
        <div class="person-card">
            <h3>${escapeHTML(user.username)}</h3>

            <p>${user.followers} Followers</p>

            <button onclick="toggleFollow(${user.id})">
                ${user.is_following ? "Following" : "Follow"}
            </button>
        </div>
    `).join("");
}

// Follow and unfollow
async function toggleFollow(id) {
    try {
        await api(`/api/users/${id}/follow`, {
            method: "POST"
        });

        await loadPeople();

    } catch (error) {
        showMessage("message", error.message);
    }
}

// Logout
async function logout() {
    await api("/api/logout", {
        method: "POST"
    });

    currentUser = null;

    document.getElementById("authSection").style.display = "block";
    document.getElementById("appSection").style.display = "none";
    document.getElementById("navbar").style.display = "none";

    document.getElementById("authForm").reset();
    setMode("login");
}

// Prevent HTML injection in displayed user content
function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

// Check existing login session
async function checkLogin() {
    try {
        const result = await api("/api/me");

        if (result.user) {
            currentUser = result.user;
            await enterApp();
        }
    } catch (error) {
        console.log("Please log in.");
    }
}

checkLogin();
